import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { getDb } from '../supabase/client.js';
import { sendOtpEmail } from '../email/smtp.js';
import { logAudit } from '../supabase/audit.js';

function generateOtpCode(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

export async function createAndSendOtp(
  config: AppConfig,
  params: { phone?: string; cpf: string; email: string }
): Promise<void> {
  if (config.otpMock) {
    await logAudit(config, {
      whatsappPhone: params.phone ?? '',
      cpf: params.cpf,
      action: 'otp_sent_mock',
      payload: { email: params.email }
    });
    return;
  }

  const pool = getDb(config);
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + config.otpExpiresMinutes * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  await pool.query(
    'INSERT INTO otp_codes (id, phone, cpf, email, code, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), params.phone ?? null, params.cpf, params.email, code, expiresAt]
  );

  await sendOtpEmail(config, { to: params.email, code, cpf: params.cpf });
  await logAudit(config, {
    whatsappPhone: params.phone ?? '',
    cpf: params.cpf,
    action: 'otp_sent',
    payload: { email: params.email }
  });
}

export async function verifyOtp(
  config: AppConfig,
  params: { cpf: string; email: string; code: string }
): Promise<boolean> {
  if (config.otpMock) {
    await logAudit(config, {
      whatsappPhone: '',
      cpf: params.cpf,
      action: 'otp_verified_mock',
      payload: { email: params.email, code: params.code }
    });
    return true;
  }

  const pool = getDb(config);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code, expires_at, used_at, attempts FROM otp_codes
     WHERE cpf = ? AND email = ?
     ORDER BY created_at DESC LIMIT 1`,
    [params.cpf, params.email]
  );
  const list = rows as RowDataPacket[];
  if (list.length === 0) return false;

  const record = list[0] as { id: string; code: string; expires_at: string | Date; used_at: string | Date | null; attempts: number };
  const now = new Date();

  if (record.used_at) return false;
  if (new Date(record.expires_at).getTime() < now.getTime()) return false;
  if ((record.attempts ?? 0) >= config.otpMaxAttempts) return false;

  const isValid = String(record.code) === String(params.code);
  const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');

  if (isValid) {
    await pool.query(
      'UPDATE otp_codes SET used_at = ?, attempts = ? WHERE id = ?',
      [nowStr, (record.attempts ?? 0) + 1, record.id]
    );
    await logAudit(config, { whatsappPhone: '', cpf: params.cpf, action: 'otp_verified', payload: { email: params.email } });
    return true;
  } else {
    await pool.query(
      'UPDATE otp_codes SET attempts = ? WHERE id = ?',
      [(record.attempts ?? 0) + 1, record.id]
    );
    return false;
  }
}

