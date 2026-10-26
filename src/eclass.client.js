import axios from 'axios';
import 'dotenv/config';

export class EClassClient {
    constructor() {
        this.token = process.env.ECLASS_TOKEN;
        this.api = axios.create({
            baseURL: 'https://api-lb.eclass.com',
            timeout: 10000, // Timeout de 10 segundos para evitar congelamientos indefinidos
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://plataformav8.eclass.com',
                'Referer': 'https://plataformav8.eclass.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0',
                'Authorization': `Bearer ${this.token?.trim()}`
            }
        });
    }

    async executeQuery(query, variables) {
        try {
            const response = await this.api.post('/graphql', {
                query,
                variables
            });
            return { isSuccess: true, data: response.data };
        } catch (error) {
            return { isSuccess: false, error: error.message };
        }
    }
}