import { getSupabaseAdmin } from './client.js';
/**
 * Registra ação de auditoria no Supabase.
 * Falhas são silenciadas para não interromper o fluxo principal.
 */
export async function logAudit(config, params) {
    try {
        const supabase = getSupabaseAdmin(config);
        await supabase.rpc('log_audit', {
            p_whatsapp_phone: params.whatsappPhone,
            p_cpf: params.cpf ?? null,
            p_ligacao_id: params.ligacaoId ?? null,
            p_action: params.action,
            p_payload: (params.payload ?? {})
        });
        // Ignora erros silenciosamente
    }
    catch {
        // Silenciado - Supabase não disponível
    }
}
