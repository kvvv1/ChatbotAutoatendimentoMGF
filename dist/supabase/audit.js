import { randomUUID } from 'node:crypto';
import { getDb } from './client.js';
export async function logAudit(config, params) {
    try {
        const pool = getDb(config);
        await pool.query('INSERT INTO audit_logs (id, whatsapp_phone, cpf, ligacao_id, action, payload) VALUES (?, ?, ?, ?, ?, ?)', [
            randomUUID(),
            params.whatsappPhone,
            params.cpf ?? null,
            params.ligacaoId ?? null,
            params.action,
            JSON.stringify(params.payload ?? {})
        ]);
    }
    catch {
        // Silenciado
    }
}
