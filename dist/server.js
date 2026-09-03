import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { loadConfig } from './config.js';
import { registerZapiRoutes } from './zapi/webhook.js';
import { ZapiClient } from './zapi/client.js';
import { registerMetaRoutes } from './meta/webhook.js';
import { registerHumanRoutes } from './human/routes.js';
import { registerBiRoutes } from './bi/routes.js';
import { getDb } from './supabase/client.js';
import { runMigrations } from './db/migrate.js';
import { createApiAuthHook } from './security/apiAuth.js';
import { createAttendantAuthHook } from './human/auth.js';
async function bootstrap() {
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
    await app.register(fastifyCors, { origin: true });
    // Exige API_SECRET (se configurado) para acessar as rotas de dados do painel
    app.addHook('preHandler', createApiAuthHook(config.apiSecret, ['/api/', '/test/']));
    // Exige login individual do atendente (se ATTENDANT_AUTH_SECRET configurado) nas
    // rotas do painel de atendimento humano — fecha a lacuna do token não-verificado antigo.
    app.addHook('preHandler', createAttendantAuthHook(config, ['/api/human-tickets', '/api/quick-replies', '/api/contacts', '/api/human/stream']));
    app.get('/health', async () => {
        return { status: 'ok' };
    });
    // Não redireciona mais pro painel — evita que a raiz do domínio vaze a existência
    // do painel de atendimento pra quem só conhece o link base.
    app.get('/', async (_request, reply) => {
        return reply.code(404).send({ error: 'not_found' });
    });
    // Config.js gerado dinamicamente (nunca versionado) para o frontend do painel conhecer a chave de API desta instância
    app.get('/painel-atendimento/config.js', async (_request, reply) => {
        reply.type('application/javascript');
        return `window.APP_CONFIG = Object.freeze(${JSON.stringify({
            apiSecret: config.apiSecret || '',
            attendantAuthEnabled: !!config.attendantAuthSecret
        })});\n`;
    });
    // Arquivos estáticos do painel de atendimento humano
    await app.register(fastifyStatic, {
        root: path.join(process.cwd(), 'painel-atendimento'),
        prefix: '/painel-atendimento/'
    });
    // Arquivos estáticos de assets (vídeos, áudios, etc.)
    await app.register(fastifyStatic, {
        root: path.join(process.cwd(), 'assets'),
        prefix: '/assets/',
        decorateReply: false
    });
    await registerZapiRoutes(app, config);
    await registerHumanRoutes(app, config);
    await registerBiRoutes(app, config);
    // Cloud API oficial da Meta — só ativa quando a instância tiver WHATSAPP_PROVIDER=meta
    // e as credenciais configuradas. Não afeta instâncias existentes rodando Z-API.
    if (config.whatsappProvider === 'meta' && config.metaAccessToken && config.metaPhoneNumberId) {
        await registerMetaRoutes(app, config);
        app.log.info('Rotas da WhatsApp Cloud API (Meta) registradas em /webhook/meta');
    }
    // Endpoint auxiliar para testes manuais de envio via Z-API
    app.post('/test/send', async (request, reply) => {
        const body = request.body;
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
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
bootstrap();
