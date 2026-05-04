import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { loadConfig } from './config.js';
import { registerZapiRoutes } from './zapi/webhook.js';
import { ZapiClient } from './zapi/client.js';
import { registerHumanRoutes } from './human/routes.js';
import { getDb } from './supabase/client.js';
import { runMigrations } from './db/migrate.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  // Executa migrations automaticamente ao iniciar
  const db = getDb(config);
  await runMigrations(db);

  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === 'production' ? undefined : {
        target: 'pino-pretty'
      }
    }
  });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // Redireciona raiz para o painel, preservando query string (?token= etc)
  app.get('/', async (request, reply) => {
    const qs = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    return reply.redirect(302, `/painel-atendimento/${qs}`);
  });

  // Arquivos estáticos do painel de atendimento humano
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'painel-atendimento'),
    prefix: '/painel-atendimento/'
  });

  await registerZapiRoutes(app, config);
  await registerHumanRoutes(app, config);

  // Endpoint auxiliar para testes manuais de envio via Z-API
  app.post('/test/send', async (request, reply) => {
    const body = request.body as { phone?: string; message?: string } | null;
    const phone = body?.phone;
    const message = body?.message ?? 'Mensagem de teste';
    if (!phone) {
      return reply.code(400).send({ error: 'phone_required' });
    }
    const zapi = new ZapiClient(config);
    await zapi.sendText({ phone, message });
    return { ok: true };
  });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`Servidor iniciado na porta ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();

