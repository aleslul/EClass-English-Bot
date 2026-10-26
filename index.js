import { EClassService } from './src/eclass.service.js';
import 'dotenv/config';

async function main() {
    const studentId = process.env.STUDENT_ID;
    const courseId = process.env.COURSE_ID;

    if (!studentId || !courseId || !process.env.ECLASS_TOKEN) {
        console.log('[!] Error: Faltan variables en el archivo .env (STUDENT_ID, COURSE_ID o ECLASS_TOKEN).');
        return;
    }

    const service = new EClassService();
    await service.processCourse(studentId, courseId);
}

main();