import { getSupabaseAdmin } from './client.js';
export async function logAudit(config, params) {
    const supabase = getSupabaseAdmin(config);
    const { error } = await supabase.rpc('log_audit', {
        p_whatsapp_phone: params.whatsappPhone,
        p_cpf: params.cpf ?? null,
        p_ligacao_id: params.ligacaoId ?? null,
        p_action: params.action,
        p_payload: (params.payload ?? {})
    });
    if (error)
        throw error;
}
