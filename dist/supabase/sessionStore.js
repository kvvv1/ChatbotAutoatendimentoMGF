import { getSupabaseAdmin } from './client.js';
export class SupabaseSessionStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async getByPhone(phone) {
        const supabase = getSupabaseAdmin(this.config);
        const { data, error } = await supabase
            .from('sessions')
            .select('phone, state, updated_at')
            .eq('phone', phone)
            .maybeSingle();
        if (error)
            throw error;
        if (!data)
            return null;
        return {
            phone: data.phone,
            state: data.state,
            updatedAt: data.updated_at
        };
    }
    async save(session) {
        const supabase = getSupabaseAdmin(this.config);
        const { error } = await supabase.rpc('upsert_session', {
            p_phone: session.phone,
            p_state: session.state
        });
        if (error)
            throw error;
    }
    async delete(phone) {
        const supabase = getSupabaseAdmin(this.config);
        const { error } = await supabase
            .from('sessions')
            .delete()
            .eq('phone', phone);
        if (error)
            throw error;
    }
    async deleteAll() {
        const supabase = getSupabaseAdmin(this.config);
        const { error } = await supabase
            .from('sessions')
            .delete()
            .neq('phone', ''); // Delete all (condition always true)
        if (error)
            throw error;
    }
}
