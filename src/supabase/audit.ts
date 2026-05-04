import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { getDb } from './client.js';

export type AuditPayload = Record<string, unknown>;

export async function logAudit(
  config: AppConfig,
  params: { whatsappPhone: string; cpf?: string | null; ligacaoId?: string | null; action: string; payload?: AuditPayload }
): Promise<void> {
  try {
    const pool = getDb(config);
    await pool.query(
      'INSERT INTO audit_logs (id, whatsapp_phone, cpf, ligacao_id, action, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        params.whatsappPhone,
        params.cpf ?? null,
        params.ligacaoId ?? null,
        params.action,
        JSON.stringify(params.payload ?? {})
      ]
    );
  } catch {
    // Silenciado
  }
}



