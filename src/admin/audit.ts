import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import type { Instance } from './instances.js';

export type AuditRow = {
  id: string;
  whatsapp_phone: string;
  cpf: string | null;
  ligacao_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AuditQuery = {
  slug?: string;
  from?: string;
  to?: string;
  action?: string;
  limit?: number;
  offset?: number;
};

async function withPool<T>(instance: Instance, fn: (pool: mysql.Pool) => Promise<T>): Promise<T> {
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
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function queryAudit(instance: Instance, query: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  return withPool(instance, async pool => {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

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

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
      params
    );
    const total = (countRows[0] as { total: number }).total;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, whatsapp_phone, cpf, ligacao_id, action, payload, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      total,
      rows: (rows as Array<Omit<AuditRow, 'created_at'> & { created_at: string | Date }>).map(r => ({
        ...r,
        payload: (() => { try { return typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload; } catch { return {}; } })(),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
    };
  });
}
