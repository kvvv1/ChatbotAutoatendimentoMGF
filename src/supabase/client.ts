import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';

export function getSupabaseAdmin(config: AppConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}



