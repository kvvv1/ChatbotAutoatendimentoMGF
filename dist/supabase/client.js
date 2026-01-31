import { createClient } from '@supabase/supabase-js';
export function getSupabaseAdmin(config) {
    return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}
