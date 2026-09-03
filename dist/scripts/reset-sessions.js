#!/usr/bin/env node
import { getDb } from '../supabase/client.js';
import { loadConfig } from '../config.js';
async function resetSessions() {
    try {
        const config = loadConfig();
        const pool = getDb(config);
        const phone = process.argv[2];
        if (phone) {
            console.log(`Deletando sessao do telefone: ${phone}...`);
            await pool.query('DELETE FROM sessions WHERE phone = ?', [phone]);
            console.log(`Sessao do telefone ${phone} deletada.`);
        }
        else {
            console.log('Deletando todas as sessoes...');
            await pool.query('DELETE FROM sessions');
            console.log('Todas as sessoes deletadas.');
        }
        await pool.end();
    }
    catch (err) {
        const e = err;
        console.error('Erro:', e?.message || err);
        process.exit(1);
    }
}
resetSessions();
