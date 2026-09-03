import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { getDb } from './client.js';
import { hashPassword, verifyPassword } from '../human/auth.js';

export type Attendant = {
  id: string;
  name: string;
  email: string;
  active: boolean;
};

export async function createAttendant(
  config: AppConfig,
  params: { name: string; email: string; password: string }
): Promise<Attendant> {
  const pool = getDb(config);
  const id = randomUUID();
  const email = params.email.trim().toLowerCase();
  await pool.query(
    'INSERT INTO human_attendants (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    [id, params.name.trim(), email, hashPassword(params.password)]
  );
  return { id, name: params.name.trim(), email, active: true };
}

export async function verifyAttendantCredentials(
  config: AppConfig,
  email: string,
  password: string
): Promise<Attendant | null> {
  const pool = getDb(config);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, email, password_hash, active FROM human_attendants WHERE email = ? LIMIT 1',
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, name: row.name, email: row.email, active: true };
}

export async function listAttendants(config: AppConfig): Promise<Attendant[]> {
  const pool = getDb(config);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, email, active FROM human_attendants ORDER BY name ASC'
  );
  return rows.map(r => ({ id: r.id, name: r.name, email: r.email, active: !!r.active }));
}

export async function setAttendantActive(config: AppConfig, id: string, active: boolean): Promise<void> {
  const pool = getDb(config);
  await pool.query('UPDATE human_attendants SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
}
