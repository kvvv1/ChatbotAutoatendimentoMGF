import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Lê o .env manualmente
const envFile = process.argv[2] ?? '.env';
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', envFile);
const lines = readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of lines) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM } = env;
const testTo = process.argv[3] ?? SMTP_USER;

console.log('=== TESTE DE ENVIO SMTP ===');
console.log(`Host   : ${SMTP_HOST}:${SMTP_PORT}`);
console.log(`Seguro : ${SMTP_SECURE}`);
console.log(`Usuário: ${SMTP_USER}`);
console.log(`De     : ${SMTP_FROM}`);
console.log(`Para   : ${testTo}`);
console.log('');

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('ERRO: SMTP não configurado no arquivo .env informado.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT ?? 587),
  secure: SMTP_SECURE === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

console.log('Verificando conexão com o servidor...');
try {
  await transporter.verify();
  console.log('✅ Conexão OK — servidor SMTP respondeu.');
} catch (err) {
  console.error('❌ ERRO na conexão:', err.message);
  process.exit(1);
}

console.log(`\nEnviando e-mail de teste para ${testTo}...`);
try {
  const info = await transporter.sendMail({
    from: SMTP_FROM ?? SMTP_USER,
    to: testTo,
    subject: 'Teste SMTP — Autoatendimento',
    text: 'Este é um e-mail de teste enviado pelo script de diagnóstico do chatbot.\n\nSe chegou aqui, o SMTP está funcionando corretamente.',
  });
  console.log('✅ E-mail enviado com sucesso!');
  console.log('   Message ID:', info.messageId);
  console.log('   Resposta  :', info.response);
} catch (err) {
  console.error('❌ ERRO ao enviar:', err.message);
  process.exit(1);
}
