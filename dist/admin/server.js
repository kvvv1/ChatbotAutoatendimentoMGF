import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fetch } from 'undici';
import { loadInstances, getInstance } from './instances.js';
import { checkInstance } from './health.js';
import { buildEnvReport } from './env.js';
import { queryAudit } from './audit.js';
import { createApiAuthHook } from '../security/apiAuth.js';
async function bootstrap() {
    const app = Fastify({
        logger: {
            transport: { target: 'pino-pretty' },
        },
    });
    await app.register(fastifyCors, { origin: true });
    app.addHook('preHandler', createApiAuthHook(process.env.ADMIN_API_SECRET, '/admin/api/'));
    app.get('/config.js', async (_request, reply) => {
        reply.type('application/javascript');
        return `window.APP_CONFIG = Object.freeze(${JSON.stringify({ apiSecret: process.env.ADMIN_API_SECRET || '' })});\n`;
    });
    await app.register(fastifyStatic, {
        root: path.join(process.cwd(), 'painel-admin'),
        prefix: '/',
    });
    // ── Instâncias ────────────────────────────────────────────────
    app.get('/admin/api/instances', async () => {
        return loadInstances().map(i => ({
            slug: i.slug,
            nomeAbreviado: i.nomeAbreviado,
            nomeCompleto: i.nomeCompleto,
            port: i.port,
            phoneNumber: i.phoneNumber,
            envFile: i.envFile,
        }));
    });
    // ── Status (Dashboard) ────────────────────────────────────────
    app.get('/admin/api/status', async () => {
        const instances = loadInstances();
        return Promise.all(instances.map(checkInstance));
    });
    app.get('/admin/api/status/:slug', async (req, reply) => {
        const instance = getInstance(req.params.slug);
        if (!instance)
            return reply.code(404).send({ error: 'Entidade não encontrada' });
        return checkInstance(instance);
    });
    // ── QR Code ───────────────────────────────────────────────────
    app.get('/admin/api/qrcode/:slug', async (req, reply) => {
        const instance = getInstance(req.params.slug);
        if (!instance)
            return reply.code(404).send({ error: 'Entidade não encontrada' });
        const url = `${instance.zapiBaseUrl}/instances/${instance.zapiInstanceId}/token/${instance.zapiToken}/qr-code/image`;
        try {
            const res = await fetch(url, {
                headers: { 'Client-Token': instance.zapiClientToken },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                return reply.code(res.status).send({ error: `Z-API: HTTP ${res.status}` });
            }
            const contentType = res.headers.get('content-type') || 'image/png';
            const buffer = Buffer.from(await res.arrayBuffer());
            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-store');
            return reply.send(buffer);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return reply.code(500).send({ error: msg });
        }
    });
    // ── ENV ───────────────────────────────────────────────────────
    app.get('/admin/api/env/:slug', async (req, reply) => {
        const instance = getInstance(req.params.slug);
        if (!instance)
            return reply.code(404).send({ error: 'Entidade não encontrada' });
        return buildEnvReport(instance);
    });
    // ── Auditoria ─────────────────────────────────────────────────
    app.get('/admin/api/audit', async (req, reply) => {
        const { slug, from, to, action, limit, offset } = req.query;
        if (!slug)
            return reply.code(400).send({ error: 'slug obrigatório' });
        const instance = getInstance(slug);
        if (!instance)
            return reply.code(404).send({ error: 'Entidade não encontrada' });
        if (!instance.dbHost)
            return reply.code(422).send({ error: 'DB não configurado para esta entidade' });
        try {
            return await queryAudit(instance, { slug, from, to, action, limit: Number(limit ?? 50), offset: Number(offset ?? 0) });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return reply.code(500).send({ error: msg });
        }
    });
    const port = Number(process.env.ADMIN_PORT ?? 9000);
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`Admin panel disponível em http://localhost:${port}`);
}
bootstrap().catch(err => {
    console.error(err);
    process.exit(1);
});
