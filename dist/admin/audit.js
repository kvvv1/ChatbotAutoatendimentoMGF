import mysql from 'mysql2/promise';
async function withPool(instance, fn) {
    const pool = mysql.createPool({
        host: instance.dbHost,
        port: instance.dbPort,
        user: instance.dbUser,
        password: instance.dbPassword,
        database: instance.dbDatabase,
        waitForConnections: true,
        connectionLimit: 3,
        timezone: '-03:00',
    });
    try {
        return await fn(pool);
    }
    finally {
        await pool.end().catch(() => { });
    }
}
export async function queryAudit(instance, query) {
    return withPool(instance, async (pool) => {
        const conditions = [];
        const params = [];
        if (query.from) {
            conditions.push('DATE(created_at) >= ?');
            params.push(query.from);
        }
        if (query.to) {
            conditions.push('DATE(created_at) <= ?');
            params.push(query.to);
        }
        if (query.action) {
            conditions.push('action = ?');
            params.push(query.action);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Number(query.limit ?? 50), 200);
        const offset = Number(query.offset ?? 0);
        const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, params);
        const total = countRows[0].total;
        const [rows] = await pool.execute(`SELECT id, whatsapp_phone, cpf, ligacao_id, action, payload, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`, [...params, limit, offset]);
        return {
            total,
            rows: rows.map(r => ({
                ...r,
                payload: (() => { try {
                    return typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
                }
                catch {
                    return {};
                } })(),
                created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
            })),
        };
    });
}
