import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { MetaClient } from './client.js';
import { MemorySessionStore } from '../state/memorySessionStore.js';
import { hasActiveHumanTicket, logMessage } from '../supabase/messages.js';
import { processMessage } from '../bot/flow.js';
import { publishHumanEvent } from '../human/events.js';

/**
 * Webhook da WhatsApp Cloud API oficial da Meta.
 *
 * Diferente do Z-API, o payload aqui é estruturado e documentado pela própria Meta
 * (entry[0].changes[0].value.messages[0]), então a extração de telefone/texto/id de
 * interação não precisa das heurísticas usadas em src/zapi/webhook.ts.
 */
export async function registerMetaRoutes(rootApp: FastifyInstance, config: AppConfig): Promise<void> {
  const meta = new MetaClient(config);
  const sessionStore = new MemorySessionStore();

  // Registro em contexto isolado (plugin encapsulado do Fastify) — o content-type
  // parser customizado abaixo só vale pras rotas /webhook/meta, sem afetar as
  // rotas de Z-API/painel que já usam o parser JSON padrão na instância raiz.
  await rootApp.register(async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      const raw = body as Buffer;
      (_request as any).rawBody = raw;
      done(null, raw.length ? JSON.parse(raw.toString('utf8')) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const userLocks = new Map<string, boolean>();
  const userQueues = new Map<string, string[]>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const processedMessageIds = new Map<string, number>();
  const DEBOUNCE_MS = 1200;
  const DEDUPE_TTL_MS = 5 * 60 * 1000;

  function sweepOldIds(): void {
    const now = Date.now();
    for (const [id, ts] of processedMessageIds.entries()) {
      if (now - ts > DEDUPE_TTL_MS) processedMessageIds.delete(id);
    }
  }

  // ── Handshake de verificação (GET) exigido pela Meta ao configurar o webhook ──
  app.get('/webhook/meta', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token && config.metaVerifyToken && token === config.metaVerifyToken) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send('Forbidden');
  });

  // ── Recebimento de mensagens (POST) ──────────────────────────────────────────
  app.post('/webhook/meta', async (request: FastifyRequest, reply) => {
    // Valida a assinatura HMAC (X-Hub-Signature-256), se META_APP_SECRET configurado
    if (config.metaAppSecret) {
      const signature = request.headers['x-hub-signature-256'];
      const rawBody: Buffer = (request as any).rawBody ?? Buffer.from(JSON.stringify(request.body));
      const expected = 'sha256=' + crypto.createHmac('sha256', config.metaAppSecret).update(rawBody).digest('hex');
      const valid = typeof signature === 'string' &&
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) {
        request.log.warn('Assinatura inválida no webhook Meta — requisição rejeitada.');
        return reply.code(401).send({ error: 'invalid_signature' });
      }
    }

    reply.code(200).send({ ok: true });

    try {
      const body = request.body as any;
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      if (!value) return;

      // Callbacks de status de entrega (sent/delivered/read) não têm mensagem do usuário — ignora
      if (!value.messages || value.messages.length === 0) return;

      const message = value.messages[0];
      const phone = String(message.from || '').trim();
      if (!phone) return;

      const messageId = String(message.id || '');
      sweepOldIds();
      if (messageId && processedMessageIds.has(messageId)) {
        request.log.info({ phone, messageId }, 'Duplicata detectada; ignorando.');
        return;
      }
      if (messageId) processedMessageIds.set(messageId, Date.now());

      // Extrai o texto conforme o tipo da mensagem
      let text = '';
      if (message.type === 'text') {
        text = message.text?.body || '';
      } else if (message.type === 'interactive') {
        const interactive = message.interactive;
        if (interactive?.type === 'button_reply') {
          text = interactive.button_reply?.id || interactive.button_reply?.title || '';
        } else if (interactive?.type === 'list_reply') {
          text = interactive.list_reply?.id || interactive.list_reply?.title || '';
        }
      } else if (message.type === 'button') {
        // Botão de quick-reply de Template
        text = message.button?.payload || message.button?.text || '';
      }

      try {
        await logMessage(config, { phone, direction: 'in', content: text || `[${message.type}]` });
        publishHumanEvent({ type: 'message', phone, at: new Date().toISOString() });
      } catch (e) {
        request.log.warn({ err: e }, 'Falha ao logar mensagem de entrada');
      }

      try {
        if (await hasActiveHumanTicket(config, phone)) {
          request.log.info({ phone }, 'Atendimento humano ativo. Bot silenciado.');
          return;
        }
      } catch (e) {
        request.log.warn({ err: e }, 'Falha na checagem de atendimento humano');
      }

      if (!text) {
        request.log.info({ phone, type: message.type }, 'Mensagem sem conteúdo textual utilizável pelo bot.');
        return;
      }

      // Enfileira e aplica debounce por usuário — mesmo padrão do webhook Z-API
      if (!userQueues.has(phone)) userQueues.set(phone, []);
      userQueues.get(phone)!.push(text);

      if (debounceTimers.has(phone)) clearTimeout(debounceTimers.get(phone)!);
      debounceTimers.set(phone, setTimeout(async () => {
        const queue = userQueues.get(phone) || [];
        userQueues.set(phone, []);
        const latestMessage = queue.length > 0 ? queue[queue.length - 1] : text;

        if (userLocks.get(phone)) {
          userQueues.get(phone)!.push(latestMessage);
          debounceTimers.set(phone, setTimeout(() => {}, DEBOUNCE_MS));
          return;
        }

        userLocks.set(phone, true);
        try {
          const replies = await processMessage(config, phone, latestMessage, sessionStore);
          for (const out of replies) {
            try {
              if (typeof out === 'string') {
                await meta.sendText({ phone, message: out });
              } else if ((out as any).type === 'buttons') {
                const o = out as any;
                try {
                  await meta.sendButtons({ phone, text: o.text, buttons: o.buttons });
                } catch (err) {
                  request.log.error({ err, phone }, 'Erro ao enviar reply buttons, tentando fallback em texto numerado');
                  const buttonsText = (o.buttons || []).map((b: any, idx: number) => `${idx + 1} - ${b.text}`).join('\n');
                  await meta.sendText({ phone, message: `${o.text}\n\n${buttonsText}\n\nDigite o número correspondente.` });
                }
              } else if ((out as any).type === 'list') {
                const o = out as any;
                const options = ([] as Array<{ id?: string; title: string; description?: string }>)
                  .concat(...(o.sections || []).map((s: any) => s.rows || []))
                  .map((r: any) => ({ id: r.id, title: r.title, description: r.description }));
                await meta.sendOptionList({
                  phone,
                  message: o.text,
                  optionList: { title: (o.sections?.[0]?.title) || 'Opções disponíveis', buttonLabel: o.buttonText || 'Abrir lista', options }
                });
              } else if ((out as any).type === 'copyCode') {
                const o = out as any;
                await meta.sendTextWithCode({ phone, message: o.message, code: o.code });
              } else if ((out as any).type === 'link') {
                const o = out as any;
                await meta.sendLink({ phone, message: o.message, linkUrl: o.linkUrl });
              } else if ((out as any).type === 'video') {
                const o = out as any;
                await meta.sendVideo({ phone, video: o.video, caption: o.caption });
              } else if ((out as any).type === 'audio') {
                const o = out as any;
                if (!o.audioUrl) continue;
                await meta.sendAudio({ phone, audio: o.audioUrl });
              } else if ((out as any).type === 'buttonActions') {
                const o = out as any;
                await meta.sendButtonActions({ phone, message: o.message, buttonActions: o.buttonActions });
              } else if ((out as any).type === 'document') {
                const o = out as any;
                if (!o.document) continue;
                await meta.sendDocument({ phone, document: o.document, fileName: o.fileName, caption: o.caption });
              } else if ((out as any).type === 'location') {
                const o = out as any;
                await meta.sendLocation({ phone, title: o.title, address: o.address, latitude: o.latitude, longitude: o.longitude });
              }
              try { await logMessage(config, { phone, direction: 'out', content: typeof out === 'string' ? out : JSON.stringify(out) }); } catch {}
            } catch (err) {
              request.log.error({ err, phone, out }, 'Erro ao enviar um item da resposta; seguindo para o próximo');
            }
          }
        } catch (err) {
          request.log.error({ err }, 'Erro no processamento debounced (Meta)');
        } finally {
          userLocks.set(phone, false);
        }
      }, DEBOUNCE_MS));
    } catch (err) {
      request.log.error({ err }, 'Erro ao processar webhook da Meta');
    }
  });
  }); // fim do contexto encapsulado do plugin
}
