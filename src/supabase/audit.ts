import type { AppConfig } from '../config.js';
import { getSupabaseAdmin } from './client.js';

export type AuditPayload = Record<string, unknown>;

/**
 * Registra ação de auditoria no Supabase.
 * Falhas são silenciadas para não interromper o fluxo principal.
 */
export async function logAudit(
  config: AppConfig,
  params: { whatsappPhone: string; cpf?: string | null; ligacaoId?: string | null; action: string; payload?: AuditPayload }
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin(config);
    await supabase.rpc('log_audit', {
      p_whatsapp_phone: params.whatsappPhone,
      p_cpf: params.cpf ?? null,
      p_ligacao_id: params.ligacaoId ?? null,
      p_action: params.action,
      p_payload: (params.payload ?? {}) as Record<string, unknown>
    });
    // Ignora erros silenciosamente
  } catch {
    // Silenciado - Supabase não disponível
  }
}



