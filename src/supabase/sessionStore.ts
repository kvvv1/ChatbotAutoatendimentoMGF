import type { Session, SessionStore } from '../state/session.js';
import type { AppConfig } from '../config.js';
import { getSupabaseAdmin } from './client.js';

export class SupabaseSessionStore implements SessionStore {
  private readonly config: AppConfig;
  constructor(config: AppConfig) {
    this.config = config;
  }

  async getByPhone(phone: string): Promise<Session | null> {
    const supabase = getSupabaseAdmin(this.config);
    const { data, error } = await supabase
      .from('sessions')
      .select('phone, state, updated_at')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      phone: data.phone,
      state: data.state as Session['state'],
      updatedAt: data.updated_at as string
    };
  }

  async save(session: Session): Promise<void> {
    const supabase = getSupabaseAdmin(this.config);
    const { error } = await supabase.rpc('upsert_session', {
      p_phone: session.phone,
      p_state: session.state as unknown as Record<string, unknown>
    });
    if (error) throw error;
  }

  async delete(phone: string): Promise<void> {
    const supabase = getSupabaseAdmin(this.config);
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('phone', phone);
    if (error) throw error;
  }

  async deleteAll(): Promise<void> {
    const supabase = getSupabaseAdmin(this.config);
    const { error } = await supabase
      .from('sessions')
      .delete()
      .neq('phone', ''); // Delete all (condition always true)
    if (error) throw error;
  }
}


