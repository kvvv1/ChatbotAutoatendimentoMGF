#!/usr/bin/env node

import { getSupabaseAdmin } from '../supabase/client.js';
import { loadConfig } from '../config.js';

async function resetSessions() {
  try {
    const config = loadConfig();
    const supabase = getSupabaseAdmin(config);
    const phone = process.argv[2]; // Optional phone argument

    if (phone) {
      // Delete specific session
      console.log(`🗑️  Deletando sessão do telefone: ${phone}...`);
      const { error, count } = await supabase
        .from('sessions')
        .delete({ count: 'exact' })
        .eq('phone', phone);
      
      if (error) {
        console.error('❌ Erro ao deletar sessão:', error.message);
        process.exit(1);
      }
      
      if (count && count > 0) {
        console.log(`✅ Sessão do telefone ${phone} deletada com sucesso!`);
      } else {
        console.log(`ℹ️  Nenhuma sessão encontrada para o telefone ${phone}.`);
      }
    } else {
      // Delete all sessions
      console.log('🗑️  Deletando todas as sessões...');
      
      // First, get count
      const { count: totalCount } = await supabase
        .from('sessions')
        .select('*', { count: 'exact', head: true });
      
      if (totalCount === 0) {
        console.log('ℹ️  Nenhuma sessão encontrada para deletar.');
        return;
      }
      
      const { error, count } = await supabase
        .from('sessions')
        .delete({ count: 'exact' })
        .neq('phone', ''); // Delete all (condition always true)
      
      if (error) {
        console.error('❌ Erro ao deletar todas as sessões:', error.message);
        process.exit(1);
      }
      
      console.log(`✅ ${count || 0} sessão(ões) deletada(s) com sucesso!`);
    }
  } catch (err: any) {
    console.error('❌ Erro:', err?.message || err);
    process.exit(1);
  }
}

resetSessions();

