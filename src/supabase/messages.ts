import type { AppConfig } from '../config.js';
import { getSupabaseAdmin } from './client.js';

/**
 * Registra mensagem no Supabase.
 * Falhas são silenciadas para não interromper o fluxo principal.
 */
export async function logMessage(
  config: AppConfig,
  params: { phone: string; direction: 'in' | 'out'; content: string }
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin(config);
    await supabase.from('messages').insert({
      phone: params.phone,
      direction: params.direction,
      content: params.content
    });
    // Ignora erros silenciosamente
  } catch {
    // Silenciado - Supabase não disponível
  }
}

/**
 * Verifica se há ticket humano ativo para o telefone.
 * Retorna false em caso de erro de conexão.
 */
export async function hasActiveHumanTicket(
  config: AppConfig,
  phone: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
      .from('human_tickets')
      .select('status')
      .eq('phone', phone)
      .in('status', ['pendente', 'em_atendimento'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}



