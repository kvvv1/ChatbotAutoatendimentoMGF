#!/usr/bin/env node

/**
 * Cria (ou atualiza a senha de) uma conta de atendente pra login no painel.
 * Uso: ENV_FILE=.env.itabira node dist/scripts/create-attendant.js "Nome" email@dominio.com senha123
 */

import { getDb } from '../supabase/client.js';
import { loadConfig } from '../config.js';
import { createAttendant } from '../supabase/attendants.js';
import { hashPassword } from '../human/auth.js';

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Uso: node dist/scripts/create-attendant.js "Nome Completo" email@dominio.com senha123');
    process.exit(1);
  }

  const config = loadConfig();
  const pool = getDb(config);

  try {
    const [existing] = await pool.query(
      'SELECT id FROM human_attendants WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if ((existing as any[]).length > 0) {
      await pool.query('UPDATE human_attendants SET name = ?, password_hash = ? WHERE email = ?', [
        name.trim(),
        hashPassword(password),
        email.trim().toLowerCase()
      ]);
      console.log(`Senha atualizada para atendente existente: ${email}`);
    } else {
      const attendant = await createAttendant(config, { name, email, password });
      console.log(`Atendente criado: ${attendant.name} <${attendant.email}> (id: ${attendant.id})`);
    }
    await pool.end();
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('Erro:', e?.message || err);
    process.exit(1);
  }
}

main();
