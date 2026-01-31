import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { ZapiClient } from './client.js';
import { SupabaseSessionStore } from '../supabase/sessionStore.js';
import { logAudit } from '../supabase/audit.js';
import { hasActiveHumanTicket, logMessage } from '../supabase/messages.js';
import { processMessage } from '../bot/flow.js';

const zapiWebhookSchema = z.object({
  event: z.string().optional(),
  // formato flexível; extrairemos manualmente
  message: z.any().optional(),
  from: z.any().optional(),
  phone: z.any().optional(),
  phoneNumber: z.any().optional(),
  text: z.any().optional(),
  // Campos adicionais variam conforme Z-API; manter flexível
  instanceId: z.string().optional()
}).passthrough();

export async function registerZapiRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const zapi = new ZapiClient(config);
  const sessionStore = new SupabaseSessionStore(config);

  // Estruturas em memória para antiflood e dedupe
  const userLocks = new Map<string, boolean>();
  const userQueues = new Map<string, string[]>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const lastMessageIds = new Map<string, Map<string, number>>(); // phone -> (id/hash -> ts)
  const DEBOUNCE_MS = 1200;
  const DEDUPE_TTL_MS = 5 * 60 * 1000;

  function getRecentSet(phone: string): Map<string, number> {
    if (!lastMessageIds.has(phone)) {
      lastMessageIds.set(phone, new Map<string, number>());
    }
    return lastMessageIds.get(phone)!;
  }
  function sweepOldIds(phone: string): void {
    const map = getRecentSet(phone);
    const now = Date.now();
    for (const [id, ts] of map.entries()) {
      if (now - ts > DEDUPE_TTL_MS) map.delete(id);
    }
  }
  function simpleHash(input: string): string {
    try {
      let h = 2166136261;
      for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      }
      return String(h >>> 0);
    } catch {
      return String(Math.random());
    }
  }

  const handler = async (request: FastifyRequest, reply: any) => {
    let payload: z.infer<typeof zapiWebhookSchema>;
    try {
      payload = zapiWebhookSchema.parse(request.body);
    } catch (err) {
      request.log.error({ err }, 'Payload inválido do webhook Z-API');
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    // Responder rápido para não estourar timeout da Z-API
    reply.code(200).send({ ok: true });

    // Processamento assíncrono
    try {
      // Ignora mensagens enviadas pelo próprio bot para evitar loop
      const fromMe =
        (payload as any)?.fromMe === true ||
        (payload as any)?.message?.fromMe === true ||
        (payload as any)?.key?.fromMe === true ||
        (payload as any)?.owner === true;
      if (fromMe) {
        request.log.info('Mensagem do próprio bot detectada. Ignorando.');
        return;
      }

      // Extração robusta de telefone e texto
      const userPhoneRaw =
        (payload as any)?.from ||
        (payload as any)?.phone ||
        (payload as any)?.phoneNumber ||
        (payload as any)?.message?.from;
      const phone = typeof userPhoneRaw === 'string' ? userPhoneRaw.replace(/\D/g, '') : undefined;

      // Captura seleção interativa (botões/listas) em múltiplos formatos suportados pela Z-API
      const selectedIdCandidates: Array<unknown> = [
        (payload as any)?.selectedId,
        (payload as any)?.message?.button?.id,
        (payload as any)?.button?.id,
        (payload as any)?.message?.listResponse?.id,
        (payload as any)?.listResponse?.id,
        (payload as any)?.interactive?.buttonId,
        (payload as any)?.message?.interactive?.buttonId,
        // List replies (variações camelCase/snake_case)
        (payload as any)?.interactive?.listReply?.id,
        (payload as any)?.interactive?.list_reply?.id,
        (payload as any)?.message?.interactive?.listReply?.id,
        (payload as any)?.message?.interactive?.list_reply?.id,
        // Option list replies
        (payload as any)?.message?.optionListResponse?.id,
        (payload as any)?.optionListResponse?.id,
        (payload as any)?.message?.optionListResponse?.selected?.id,
        (payload as any)?.optionListResponse?.selected?.id,
        (payload as any)?.message?.optionListResponse?.option?.id,
        (payload as any)?.optionListResponse?.option?.id,
        (payload as any)?.messages?.[0]?.optionListResponse?.id,
        (payload as any)?.messages?.[0]?.optionListResponse?.selected?.id,
        (payload as any)?.messages?.[0]?.interactive?.listReply?.id,
        (payload as any)?.messages?.[0]?.listResponse?.id,
        (payload as any)?.optionSelectedId,
        (payload as any)?.selected?.id
      ];
      const selectedId = selectedIdCandidates.find(v => typeof v === 'string' && v.trim().length > 0) as string | undefined;

      const textRaw =
        (payload as any)?.text?.message ||
        (payload as any)?.message?.text ||
        (payload as any)?.text?.body ||
        (payload as any)?.message?.text?.body ||
        (payload as any)?.text ||
        (typeof (payload as any)?.message === 'string' ? (payload as any).message : null) ||
        (payload as any)?.message?.conversation ||
        (payload as any)?.body ||
        (payload as any)?.messages?.[0]?.text?.body ||
        (payload as any)?.messages?.[0]?.conversation;

      // Também tenta extrair título/nome da opção selecionada
      const selectedTitleCandidates: Array<unknown> = [
        (payload as any)?.interactive?.listReply?.title,
        (payload as any)?.interactive?.list_reply?.title,
        (payload as any)?.message?.interactive?.listReply?.title,
        (payload as any)?.message?.interactive?.list_reply?.title,
        (payload as any)?.message?.optionListResponse?.title,
        (payload as any)?.optionListResponse?.title,
        (payload as any)?.selected?.title,
        (payload as any)?.message?.selected?.title,
        (payload as any)?.message?.optionListResponse?.selected?.title,
        (payload as any)?.optionListResponse?.selected?.title,
        (payload as any)?.message?.optionListResponse?.option?.title,
        (payload as any)?.optionListResponse?.option?.title,
        (payload as any)?.messages?.[0]?.optionListResponse?.selected?.title,
        (payload as any)?.messages?.[0]?.interactive?.listReply?.title,
        (payload as any)?.listResponse?.title,
        (payload as any)?.message?.listResponse?.title
      ];
      const selectedTitle = selectedTitleCandidates.find(v => typeof v === 'string' && v.trim().length > 0) as string | undefined;

      function normalize(s: string): string {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      }
      function mapTitleToCommand(title: string): string | undefined {
        const t = normalize(title);
        if (/^\d+/.test(t)) {
          // Se começar com número (ex.: "0) Video explicativo"), tenta capturar
          const m = t.match(/^(\d+)/);
          if (m) {
            const num = m[1];
            // Caso especial: "0) Vídeo explicativo" usamos id interno "10"
            if (num === '0' && t.includes('video') && t.includes('explic')) return '10';
            return num;
          }
        }
        if (t.includes('minhas ligacoes') || t === 'minhas ligacoes') return '1';
        if (t.includes('debitos') && t.includes('faturas')) return '2';
        if (t.includes('solicitar religacao') || t.includes('religacao')) return '3';
        if (t.includes('acompanhar servico') || t.includes('acompanhar')) return '4';
        if (t.includes('consumo') && t.includes('leituras')) return '5';
        if (t.includes('dados cadastrais') || t.includes('cadastrais')) return '6';
        if (t.includes('atendimento presencial') || t.includes('presencial')) return '7';
        if (t.includes('video explicativo')) return '10';
        return undefined;
      }

      let text = typeof selectedId === 'string' ? selectedId.trim() : '';
      if (!text && typeof selectedTitle === 'string') {
        const mapped = mapTitleToCommand(selectedTitle);
        if (mapped) text = mapped;
      }
      if (!text && typeof textRaw === 'string') {
        text = textRaw.trim();
      }
      // Heurística: varre o payload procurando um título conhecido quando id/título/texto não vieram nos campos padrão
      if (!text) {
        const knownLabels: Array<{ label: string; id: string }> = [
          { label: 'Minhas ligações', id: '1' },
          { label: 'Débitos e faturas', id: '2' },
          { label: 'Solicitar religação', id: '3' },
          { label: 'Acompanhar serviço', id: '4' },
          { label: 'Consumo e leituras', id: '5' },
          { label: 'Dados cadastrais', id: '6' },
          { label: 'Atendimento presencial', id: '7' },
          { label: '0) Vídeo explicativo', id: '10' },
          { label: 'Vídeo explicativo', id: '10' }
        ];
        const flatStrings: string[] = [];
        const visited = new Set<any>();
        function collectStrings(node: any, depth = 0): void {
          if (!node || depth > 5 || visited.has(node)) return;
          visited.add(node);
          if (typeof node === 'string') {
            flatStrings.push(node);
            return;
          }
          if (Array.isArray(node)) {
            for (const item of node) collectStrings(item, depth + 1);
            return;
          }
          if (typeof node === 'object') {
            for (const k of Object.keys(node)) collectStrings(node[k], depth + 1);
          }
        }
        collectStrings(payload);
        const flatNorm = flatStrings.map(s => normalize(s));
        for (const { label, id } of knownLabels) {
          const n = normalize(label);
          if (flatNorm.some(s => s.includes(n))) {
            text = id;
            break;
          }
        }
      }
      if (!phone || !text) {
        // Loga chaves principais para diagnóstico rápido (sem payload completo)
        try {
          const msg = (payload as any)?.message ?? {};
          const keys = Object.keys(payload as any || {});
          const msgKeys = Object.keys(msg || {});
          request.log.warn({ phone, text, keys, msgKeys }, 'Mensagem inválida');
        } catch {
          request.log.warn({ phone, text }, 'Mensagem inválida');
        }
        return;
      }

      await logAudit(config, {
        whatsappPhone: phone,
        action: 'message_received',
        payload: { payload }
      });
      // Log opcional de mensagem de entrada
      try {
        await logMessage(config, { phone, direction: 'in', content: text });
      } catch (e) {
        request.log.warn({ err: e }, 'Falha ao logar mensagem de entrada');
      }

      // Silenciar se houver atendimento humano ativo
      try {
        if (await hasActiveHumanTicket(config, phone)) {
          request.log.info({ phone }, 'Atendimento humano ativo. Bot silenciado.');
          return;
        }
      } catch (e) {
        request.log.warn({ err: e }, 'Falha na checagem de atendimento humano');
      }

      // Idempotência / dedupe
      const providerId =
        (payload as any)?.id ||
        (payload as any)?.messageId ||
        (payload as any)?.key?.id;
      const dedupeKey = providerId ? String(providerId) : `${phone}:${simpleHash(text)}:${(payload as any)?.timestamp || (payload as any)?.t || ''}`;
      const recent = getRecentSet(phone);
      sweepOldIds(phone);
      if (recent.has(dedupeKey)) {
        request.log.info({ phone, dedupeKey }, 'Duplicata detectada; ignorando.');
        return;
      }
      recent.set(dedupeKey, Date.now());

      // Enfileirar e aplicar debounce por usuário
      if (!userQueues.has(phone)) userQueues.set(phone, []);
      userQueues.get(phone)!.push(text);

      if (debounceTimers.has(phone)) clearTimeout(debounceTimers.get(phone)!);
      debounceTimers.set(phone, setTimeout(async () => {
        const queue = userQueues.get(phone) || [];
        userQueues.set(phone, []);
        const latestMessage = queue.length > 0 ? queue[queue.length - 1] : text;

        if (userLocks.get(phone)) {
          // já processando; re-agenda breve
          userQueues.get(phone)!.push(latestMessage);
          debounceTimers.set(phone, setTimeout(() => {}, DEBOUNCE_MS));
          return;
        }

        userLocks.set(phone, true);
        try {
          const replies = await processMessage(config, phone, latestMessage, sessionStore);
          for (const out of replies) {
            if (typeof out === 'string') {
              await zapi.sendText({ phone, message: out });
              try { await logMessage(config, { phone, direction: 'out', content: out }); } catch {}
            } else if ((out as any).type === 'buttons') {
              const buttonsOut = out as any;
              try {
                request.log.info({ phone, buttons: buttonsOut.buttons, text: buttonsOut.text }, 'Enviando botões');
                await zapi.sendButtons({ phone, text: buttonsOut.text, buttons: buttonsOut.buttons, footer: buttonsOut.footer });
                request.log.info({ phone }, 'Botões enviados com sucesso');
                try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
              } catch (err: any) {
                request.log.error({ err, phone, buttons: buttonsOut.buttons, text: buttonsOut.text }, 'Erro ao enviar botões, tentando enviar como texto');
                // Fallback: envia como texto se botões falharem
                const buttonsText = buttonsOut.buttons.map((b: any, idx: number) => `${idx + 1} - ${b.text}`).join('\n');
                await zapi.sendText({ 
                  phone, 
                  message: `${buttonsOut.text}\n\n${buttonsText}\n\nDigite o número correspondente ou use os botões acima.` 
                });
              }
            } else if ((out as any).type === 'list') {
              const listOut = out as any;
              // Converte lista com sections para optionList (send-option-list), que é o recomendado pela Z-API
              const options = ([] as Array<{ id?: string; title: string; description?: string }>)
                .concat(...(listOut.sections || []).map((s: any) => s.rows || []))
                .map((r: any) => ({ id: r.id, title: r.title, description: r.description }));
              await zapi.sendOptionList({
                phone,
                message: listOut.text,
                optionList: {
                  title: (listOut.sections && listOut.sections[0]?.title) || 'Opções disponíveis',
                  buttonLabel: listOut.buttonText || 'Abrir lista',
                  options
                }
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'link') {
              const linkOut = out as any;
              await zapi.sendLink({
                phone,
                message: linkOut.message,
                image: linkOut.image,
                linkUrl: linkOut.linkUrl,
                title: linkOut.title,
                linkDescription: linkOut.linkDescription
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'video') {
              const videoOut = out as any;
              await zapi.sendVideo({
                phone,
                video: videoOut.video,
                caption: videoOut.caption,
                viewOnce: videoOut.viewOnce
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'buttonActions') {
              const actionsOut = out as any;
              await zapi.sendButtonActions({
                phone,
                message: actionsOut.message,
                buttonActions: actionsOut.buttonActions
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            }
          }
        } catch (err) {
          request.log.error({ err }, 'Erro no processamento debounced');
        } finally {
          userLocks.set(phone, false);
        }
      }, DEBOUNCE_MS));
    } catch (err) {
      request.log.error({ err }, 'Erro ao processar webhook Z-API');
    }
  };

  // Suporta ambos os caminhos para evitar 404 por inversão de segmentos
  app.post('/webhook/zapi', handler);
  app.post('/zapi/webhook', handler);
  app.post('/webhook', handler);
}


