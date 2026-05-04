import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { getDb } from './client.js';

export async function logMessage(
  config: AppConfig,
  params: { phone: string; direction: 'in' | 'out'; content: string }
): Promise<void> {
  try {
    const pool = getDb(config);
    await pool.query(
      'INSERT INTO messages (id, phone, direction, content) VALUES (?, ?, ?, ?)',
      [randomUUID(), params.phone, params.direction, params.content]
    );
  } catch {
    // Silenciado
  }
}

export async function hasActiveHumanTicket(
  config: AppConfig,
  phone: string
): Promise<boolean> {
  try {
    const pool = getDb(config);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM human_tickets
       WHERE phone = ? AND status IN ('pendente', 'em_atendimento')
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    return (rows as RowDataPacket[]).length > 0;
  } catch {
    return false;
  }
}



