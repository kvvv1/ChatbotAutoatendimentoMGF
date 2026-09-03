import { randomUUID } from 'node:crypto';
import { getDb } from './client.js';
export async function logMessage(config, params) {
    try {
        const pool = getDb(config);
        await pool.query('INSERT INTO messages (id, phone, direction, content) VALUES (?, ?, ?, ?)', [randomUUID(), params.phone, params.direction, params.content]);
    }
    catch {
        // Silenciado
    }
}
export async function hasActiveHumanTicket(config, phone) {
    try {
        const pool = getDb(config);
        const [rows] = await pool.query(`SELECT status FROM human_tickets
       WHERE phone = ? AND status IN ('pendente', 'em_atendimento')
       ORDER BY created_at DESC LIMIT 1`, [phone]);
        return rows.length > 0;
    }
    catch {
        return false;
    }
}
