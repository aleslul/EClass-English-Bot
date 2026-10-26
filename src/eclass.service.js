import { EClassClient } from './eclass.client.js';

export class EClassService {
    constructor() {
        this.client = new EClassClient();
    }

    async getCourseStructure(studentId, courseId) {
        const query = `
          query getUnitList($UnitListInput: UnitListInput!) {
            getUnitList(input: $UnitListInput) {
              status { success code name }
              Units {
                id
                name
                progress
                finished
                items {
                  id
                  name
                  type
                  completed
                }
              }
            }
          }
        `;
        const result = await this.client.executeQuery(query, {
            UnitListInput: { studentId: Number(studentId), courseId: Number(courseId) }
        });
        return result.isSuccess ? result.data?.data?.getUnitList?.Units : null;
    }

    isOptionalItem(itemName) {
        const lower = itemName.toLowerCase();
        return (
            lower.includes('extra language') ||
            lower.includes('extra practice') ||
            lower.includes('extra skills') ||
            lower.includes('banco de recursos') ||
            lower.includes('vocabulary practice')
        );
    }

    async processCourse(studentId, courseId) {
        console.log('[*] Obteniendo la estructura del curso...');
        const units = await this.getCourseStructure(studentId, courseId);
        
        if (!units) {
            console.log('[!] Error al obtener las unidades del curso.');
            return;
        }

        for (const unit of units) {
            if (unit.finished || unit.progress === 100 || unit.name.toLowerCase().includes('opcional')) {
                console.log(`\n[✔] Saltando unidad completada u opcional: ${unit.name} [${unit.progress}%]`);
                continue;
            }

            console.log(`\n📁 Analizando Unidad: ${unit.name} [Progreso: ${unit.progress}%]`);
            if (!unit.items || unit.items.length === 0) {
                console.log('    [!] Unidad bloqueada o sin ítems disponibles.');
                continue;
            }

            const pendingItems = unit.items.filter(item => !item.completed && !this.isOptionalItem(item.name));

            if (pendingItems.length === 0) {
                console.log('    [✔] Todos los ítems obligatorios de esta unidad ya están listos.');
                continue;
            }

            for (const item of pendingItems) {
                try {
                    if (item.type === 'ARTICLE') {
                        await this.handleArticle(item, studentId, courseId, unit.id);
                    } else if (item.type === 'EXERCISE_PRACTICE') {
                        await this.handleExercise(item, studentId, courseId, unit.id);
                    } else {
                        console.log(`    [i] Saltando evaluación (${item.type}): ${item.name}`);
                    }
                } catch (itemError) {
                    console.log(`    [!] Excepción en "${item.name}": ${itemError.message}`);
                }
            }
        }
        console.log('\n[#] ¡Proceso finalizado!');
    }

    async handleArticle(item, studentId, courseId, unitId) {
        console.log(`    -> [Artículo] Completando: ${item.name}`);
        const mutation = `
          mutation addResourceProgress($ResourceProgressInput: ResourceProgressInput!) {
            addResourceProgress(input: $ResourceProgressInput) {
              status { success detail }
            }
          }
        `;
        const res = await this.client.executeQuery(mutation, {
            ResourceProgressInput: {
                studentId: Number(studentId),
                courseId: Number(courseId),
                unitId: Number(unitId),
                resourceId: Number(item.id)
            }
        });
        if (res.data?.data?.addResourceProgress?.status?.success) {
            console.log(`       [✔] Artículo completado.`);
        }
    }

    /**
     * Genera candidatos de payload inicial (sondeo) según el ItemType de eClass
     */
    buildProbeCandidates(itemTypeId, rawAnswer, rawContent) {
        let parsedAns = null;
        let parsedContent = null;
        try { parsedAns = rawAnswer ? JSON.parse(rawAnswer) : null; } catch (e) {}
        try { parsedContent = rawContent ? JSON.parse(rawContent) : null; } catch (e) {}

        // TIPO 12: Text and Multimedia (Botón "Marcar como leído" / Wordwall)
        if (itemTypeId === 12) {
            return [
                "",
                "[]",
                "true",
                "1",
                JSON.stringify([{ value: "" }]),
                JSON.stringify({ completed: true })
            ];
        }

        // TIPO 14: Multiple Choice (Requiere conservar el answerId de cada sub-pregunta)
        if (itemTypeId === 14 && Array.isArray(parsedAns)) {
            const candidate1 = JSON.stringify(parsedAns.map((item, idx) => {
                const firstOpt = parsedContent?.[idx]?.options?.[0];
                return {
                    answerId: item.answerId,
                    value: 0,
                    text: firstOpt?.value ?? ""
                };
            }));
            const candidate2 = JSON.stringify(parsedAns.map(item => ({
                answerId: item.answerId,
                value: 0
            })));
            const candidate3 = JSON.stringify(parsedAns.map((item, idx) => {
                const firstOpt = parsedContent?.[idx]?.options?.[0];
                return {
                    answerId: item.answerId,
                    text: firstOpt?.tag ?? "A)",
                    value: firstOpt?.value ?? "0"
                };
            }));
            return [candidate1, candidate2, candidate3];
        }

        // TIPO 21: Reorder (Usa los códigos "code" de las opciones arrastrables)
        if (itemTypeId === 21 && Array.isArray(parsedContent)) {
            // Candidate 1: Array de objetos con array de codes o string separado por comas
            const codesPerBlock = parsedContent.map(block =>
                (block.options || []).map(opt => opt.code)
            );
            return [
                JSON.stringify(codesPerBlock.map(codes => ({ value: codes }))),
                JSON.stringify(codesPerBlock.map(codes => ({ value: codes.join(',') }))),
                JSON.stringify(codesPerBlock.flat().map(code => ({ value: code }))),
                JSON.stringify(codesPerBlock)
            ];
        }

        const count = (Array.isArray(parsedAns) && parsedAns.length > 0)
            ? parsedAns.length
            : (Array.isArray(parsedContent?.inputs) && parsedContent.inputs.length > 0)
                ? parsedContent.inputs.length
                : 1;

        // TIPO 17: Type in (Escribir texto)
        if (itemTypeId === 17) {
            return [JSON.stringify(Array(count).fill(0).map(() => ({ value: "a" })))];
        }

        // TIPO 18: Select in the blank (y por defecto)
        return [JSON.stringify(Array(count).fill(0).map(() => ({ value: 0 })))];
    }

    /**
     * Extrae la respuesta ganadora desde feedback.hint según el ItemType
     */
    extractWinningResponse(itemTypeId, rawHint, rawAnswer, rawContent) {
        if (!rawHint) return null;
        let parsedHint = null;
        let parsedAns = null;
        let parsedContent = null;
        try { parsedHint = typeof rawHint === 'string' ? JSON.parse(rawHint) : rawHint; } catch (e) { return null; }
        try { parsedAns = rawAnswer ? JSON.parse(rawAnswer) : null; } catch (e) {}
        try { parsedContent = rawContent ? JSON.parse(rawContent) : null; } catch (e) {}

        if (!Array.isArray(parsedHint)) return null;

        // TIPO 14: Multiple Choice
        if (itemTypeId === 14 && Array.isArray(parsedAns)) {
            const win = parsedAns.map((ansSlot, idx) => {
                const hintSlot = parsedHint[idx];
                const values = hintSlot?.values || hintSlot?.options || [];
                const correctIdx = values.findIndex(v => v.correct === true);
                const correctObj = values[correctIdx >= 0 ? correctIdx : 0];
                return {
                    answerId: ansSlot.answerId,
                    value: correctIdx >= 0 ? correctIdx : 0,
                    text: correctObj?.text ?? correctObj?.value ?? ""
                };
            });
            return JSON.stringify(win);
        }

        // TIPO 21: Reorder
        if (itemTypeId === 21) {
            // Revisamos cómo viene el hint en Reorder
            const win = parsedHint.map((slot, idx) => {
                if (Array.isArray(slot.values)) {
                    // Si el hint trae las palabras ordenadas con su code o text
                    const orderedCodes = slot.values.map(v => {
                        if (v.code) return v.code;
                        // Buscar el code en parsedContent por su texto
                        const opts = parsedContent?.[idx]?.options || [];
                        const found = opts.find(o => o.text === v.text);
                        return found ? found.code : v.text;
                    });
                    return { value: orderedCodes };
                }
                return { value: slot.value ?? slot };
            });
            return JSON.stringify(win);
        }

        // TIPO 17 y 18
        const standardWin = parsedHint.map((slot) => {
            if (Array.isArray(slot.values)) {
                if (itemTypeId === 17) {
                    const correctObj = slot.values.find(v => v.correct === true) || slot.values[0];
                    return { value: correctObj?.text ?? "a" };
                }
                const idx = slot.values.findIndex(v => v.correct === true);
                return { value: idx >= 0 ? idx : 0 };
            }
            if (slot.text !== undefined) {
                return { value: slot.text };
            }
            return { value: 0 };
        });

        return JSON.stringify(standardWin);
    }

    async handleExercise(item, studentId, courseId, unitId) {
        console.log(`    -> [Ejercicio] Resolviendo: ${item.name} (ID: ${item.id})`);

        const getAnswerQuery = `
          query ExerciseGetAnswer($ExerciseGetAnswerInput: ExerciseGetAnswerInput!) {
            ExerciseGetAnswer(input: $ExerciseGetAnswerInput) {
              token
              status { success code detail }
              Answer {
                answered
                answer
                content
                config {
                  id
                  name
                  ItemType { id name }
                  indicator { obtained max }
                }
              }
              Evaluation {
                config { id testId }
                Levels {
                  Stages {
                    Answers {
                      state
                      config { id }
                    }
                  }
                }
              }
            }
          }
        `;

        const baseInput = {
            studentId: Number(studentId),
            courseId: Number(courseId),
            unitId: Number(unitId),
            resourceId: Number(item.id),
            programId: Number(process.env.PROGRAM_ID || 2102),
            calcMenu: false
        };

        const initialRes = await this.client.executeQuery(getAnswerQuery, {
            ExerciseGetAnswerInput: baseInput
        });

        const initialData = initialRes.data?.data?.ExerciseGetAnswer;
        if (!initialRes.isSuccess || !initialData || !initialData.token) {
            console.log(`       [!] No se pudo abrir "${item.name}"`);
            return;
        }

        const realEvaluationId = Number(initialData.Evaluation?.config?.id || 0);
        const realTestId = Number(initialData.Evaluation?.config?.testId || 0);

        let answersList = [];
        const stages = initialData.Evaluation?.Levels?.[0]?.Stages || [];
        for (const stage of stages) {
            for (const ans of (stage.Answers || [])) {
                if (ans.config?.id) {
                    answersList.push({ id: ans.config.id, state: ans.state });
                }
            }
        }

        const evaluationMutation = `
          mutation EvaluationAnswer($EvaluationAnswerInput: EvaluationAnswerInput!) {
            EvaluationAnswer(input: $EvaluationAnswerInput) {
              status { success code name detail }
              CallToAction { href }
              Answer {
                answer
                config {
                  id
                  ItemType { id name }
                  indicator { name obtained max }
                }
                feedback { hint }
              }
            }
          }
        `;

        for (const ansItem of answersList) {
            const answerId = ansItem.id;

            const qRes = await this.client.executeQuery(getAnswerQuery, {
                ExerciseGetAnswerInput: { ...baseInput, answerId: Number(answerId) }
            });

            const qData = qRes.data?.data?.ExerciseGetAnswer;
            if (!qData || !qData.token) continue;

            const currentToken = qData.token;
            const itemType = qData.Answer?.config?.ItemType;
            const itemTypeId = Number(itemType?.id || 0);
            const qName = qData.Answer?.config?.name || answerId;
            const curObtained = qData.Answer?.config?.indicator?.obtained ?? 0;
            const curMax = qData.Answer?.config?.indicator?.max ?? 0;

            // Si ya está respondida con el máximo de estrellas (3/3), la saltamos
            if (qData.Answer?.answered && (curMax === 0 || curObtained === curMax)) {
                console.log(`       [✔] "${qName}" ya está lista (${curObtained}/${curMax} estrellas).`);
                continue;
            }

            const candidates = this.buildProbeCandidates(itemTypeId, qData.Answer?.answer, qData.Answer?.content);

            let probeEval = null;
            let workingResponseStr = candidates[0];

            // Probamos los formatos candidatos hasta que el servidor acepte uno (code 200)
            for (const candidateStr of candidates) {
                const evalPayloadBase = {
                    token: currentToken,
                    programId: Number(process.env.PROGRAM_ID || 2102),
                    studentId: Number(studentId),
                    courseId: Number(courseId),
                    unitId: Number(unitId),
                    resourceId: Number(item.id),
                    evaluationId: realEvaluationId,
                    testId: realTestId,
                    testTypeId: 0,
                    answerId: Number(answerId),
                    isRepetition: Boolean(qData.Answer?.answered),
                    response: candidateStr
                };

                const probeRes = await this.client.executeQuery(evaluationMutation, {
                    EvaluationAnswerInput: evalPayloadBase
                });

                const currentEval = probeRes.data?.data?.EvaluationAnswer;
                if (currentEval && currentEval.status?.success) {
                    probeEval = currentEval;
                    workingResponseStr = candidateStr;
                    break;
                }
            }

            if (!probeEval) {
                console.log(`       [!] Ningún formato funcionó en "${qName}" (Tipo ${itemTypeId} - ${itemType?.name})`);
                console.log(`           -> FULL CONTENT:`, qData.Answer?.content);
                continue;
            }

            const obtainedProbe = probeEval.Answer?.config?.indicator?.obtained ?? 0;
            const maxProbe = probeEval.Answer?.config?.indicator?.max ?? 0;

            if (maxProbe === 0 || obtainedProbe === maxProbe) {
                console.log(`       [★] "${qName}" (${itemType?.name}) -> ¡Completada a la primera! (${obtainedProbe}/${maxProbe})`);
                continue;
            }

            const rawHint = probeEval.Answer?.feedback?.hint;
            const winningStr = this.extractWinningResponse(itemTypeId, rawHint, qData.Answer?.answer, qData.Answer?.content);

            if (!winningStr) {
                console.log(`       [!] Sin hint claro en "${qName}" (Tipo ${itemTypeId}):`, rawHint);
                continue;
            }

            const finalRes = await this.client.executeQuery(evaluationMutation, {
                EvaluationAnswerInput: {
                    token: currentToken,
                    programId: Number(process.env.PROGRAM_ID || 2102),
                    studentId: Number(studentId),
                    courseId: Number(courseId),
                    unitId: Number(unitId),
                    resourceId: Number(item.id),
                    evaluationId: realEvaluationId,
                    testId: realTestId,
                    testTypeId: 0,
                    answerId: Number(answerId),
                    isRepetition: true,
                    response: winningStr
                }
            });

            const finalEval = finalRes.data?.data?.EvaluationAnswer;
            const finalInd = finalEval?.Answer?.config?.indicator;
            if (finalEval?.status?.success) {
                console.log(`       [★] "${qName}" (${itemType?.name}) -> Estrellas: ${finalInd?.name || `${finalInd?.obtained}/${finalInd?.max}`}`);
            } else {
                console.log(`       [!] Falló reintento en "${qName}" (${itemType?.name}): ${finalEval?.status?.detail}`);
                console.log(`           -> HINT RECIBIDO:`, rawHint);
                console.log(`           -> RESPUESTA ENVIADA:`, winningStr);
            }
        }
    }
}