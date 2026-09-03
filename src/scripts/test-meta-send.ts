#!/usr/bin/env node

/**
 * Testa o MetaClient real contra a WhatsApp Cloud API, sem precisar subir o servidor
 * inteiro (nem banco de dados). Uso:
 *
 *   META_ACCESS_TOKEN=xxx META_PHONE_NUMBER_ID=xxx node dist/scripts/test-meta-send.js 5537999999999
 *
 * O número de destino precisa estar na lista de destinatários de teste verificados
 * no painel da Meta (API Setup > "Para"), enquanto estiver usando o número sandbox.
 */

import { MetaClient } from '../meta/client.js';
import type { AppConfig } from '../config.js';

async function main() {
  const [toPhone] = process.argv.slice(2);
  if (!toPhone) {
    console.error('Uso: node dist/scripts/test-meta-send.js <telefone-destino>');
    process.exit(1);
  }
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) {
    console.error('Defina META_ACCESS_TOKEN e META_PHONE_NUMBER_ID como variáveis de ambiente antes de rodar.');
    process.exit(1);
  }

  const config = {
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID,
    metaApiVersion: process.env.META_API_VERSION || 'v21.0'
  } as AppConfig;

  const meta = new MetaClient(config);

  console.log(`Enviando mensagem de teste para ${toPhone}...`);
  await meta.sendText({
    phone: toPhone,
    message: 'Teste de integração — WhatsApp Cloud API oficial da Meta 🎉'
  });
  console.log('Mensagem enviada com sucesso!');
}

main().catch((err) => {
  console.error('Erro ao enviar:', err);
  process.exit(1);
});
