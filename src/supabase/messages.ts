import type { AppConfig } from '../config.js';
import { getSupabaseAdmin } from './client.js';

export async function logMessage(
  config: AppConfig,
  params: { phone: string; direction: 'in' | 'out'; content: string }
): Promise<void> {
  const supabase = getSupabaseAdmin(config);
  const { error } = await supabase.from('messages').insert({
    phone: params.phone,
    direction: params.direction,
    content: params.content
  });
  if (error) throw error;
}

export async function hasActiveHumanTicket(
  config: AppConfig,
  phone: string
): Promise<boolean> {
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
}



