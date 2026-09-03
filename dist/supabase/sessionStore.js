import { getDb } from './client.js';
export class SupabaseSessionStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async getByPhone(phone) {
        const pool = getDb(this.config);
        const [rows] = await pool.query('SELECT phone, state, updated_at FROM sessions WHERE phone = ?', [phone]);
        const list = rows;
        if (list.length === 0)
            return null;
        const row = list[0];
        const stateVal = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        return {
            phone: row.phone,
            state: stateVal,
            updatedAt: row.updated_at
        };
    }
    async save(session) {
        const pool = getDb(this.config);
        await pool.query(`INSERT INTO sessions (phone, state) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = NOW(6)`, [session.phone, JSON.stringify(session.state)]);
    }
    async delete(phone) {
        const pool = getDb(this.config);
        await pool.query('DELETE FROM sessions WHERE phone = ?', [phone]);
    }
    async deleteAll() {
        const pool = getDb(this.config);
        await pool.query('DELETE FROM sessions');
    }
}
