import type { RowDataPacket } from 'mysql2/promise';
import type { Session, SessionStore } from '../state/session.js';
import type { AppConfig } from '../config.js';
import { getDb } from './client.js';

export class SupabaseSessionStore implements SessionStore {
  private readonly config: AppConfig;
  constructor(config: AppConfig) {
    this.config = config;
  }

  async getByPhone(phone: string): Promise<Session | null> {
    const pool = getDb(this.config);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT phone, state, updated_at FROM sessions WHERE phone = ?',
      [phone]
    );
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    const row = list[0];
    const stateVal = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
    return {
      phone: row.phone as string,
      state: stateVal as Session['state'],
      updatedAt: row.updated_at as string
    };
  }

  async save(session: Session): Promise<void> {
    const pool = getDb(this.config);
    await pool.query(
      `INSERT INTO sessions (phone, state) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = NOW(6)`,
      [session.phone, JSON.stringify(session.state)]
    );
  }

  async delete(phone: string): Promise<void> {
    const pool = getDb(this.config);
    await pool.query('DELETE FROM sessions WHERE phone = ?', [phone]);
  }

  async deleteAll(): Promise<void> {
    const pool = getDb(this.config);
    await pool.query('DELETE FROM sessions');
  }
}


