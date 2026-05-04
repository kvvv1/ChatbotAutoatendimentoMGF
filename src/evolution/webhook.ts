import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { EvolutionClient } from './client.js';
import { MemorySessionStore } from '../state/memorySessionStore.js';
import { logAudit } from '../supabase/audit.js';
import { hasActiveHumanTicket, logMessage } from '../supabase/messages.js';
import { ensureOpenHumanTicket } from '../supabase/humanTickets.js';
import { processMessage } from '../bot/flow.js';
import { publishHumanEvent } from '../human/events.js';

const evolutionWebhookSchema = z.object({
  event: z.string().optional(),
  instance: z.string().optional(),
  data: z.any().optional()
}).passthrough();

export async function registerEvolutionRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const evolution = new EvolutionClient(config);
  const sessionStore = new MemorySessionStore();

  const userLocks = new Map<string, boolean>();
  const userQueues = new Map<string, string[]>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const lastMessageIds = new Map<string, Map<string, number>>();
  const DEBOUNCE_MS = 1200;
  const DEDUPE_TTL_MS = 5 * 60 * 1000;

  function getRecentSet(phone: string): Map<string, number> {
    if (!lastMessageIds.has(phone)) lastMessageIds.set(phone, new Map<string, number>());
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
    let payload: z.infer<typeof evolutionWebhookSchema>;
    try {
      payload = evolutionWebhookSchema.parse(request.body);
    } catch (err) {
      request.log.error({ err }, 'Payload inválido do webhook Evolution API');
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    reply.code(200).send({ ok: true });

    try {
      const data = (payload as any)?.data ?? {};
      const key = data?.key ?? {};
      const message = data?.message ?? {};
      const messageType: string = (data?.messageType ?? '').toLowerCase();

      // Ignora mensagens enviadas pelo próprio bot
      if (key?.fromMe === true) {
        request.log.info({ id: key?.id }, 'Mensagem do próprio bot detectada. Ignorando.');
        return;
      }

      // Ignora eventos que não são mensagens recebidas
      const event = String(payload?.event ?? '');
      if (event && !event.includes('messages')) return;

      // Extrai telefone do remoteJid (formato: 5531999999999@s.whatsapp.net)
      const remoteJid: string = String(key?.remoteJid ?? '');
      const phone = remoteJid.replace(/@.+$/, '').replace(/\D/g, '') || undefined;

      // Extrai texto da mensagem
      const textRaw: string | undefined =
        message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        message?.documentMessage?.caption;

      // Extrai seleção de botão
      const selectedButtonId: string | undefined =
        message?.buttonsResponseMessage?.selectedButtonId ||
        message?.templateButtonReplyMessage?.selectedId;

      // Extrai seleção de lista
      const selectedRowId: string | undefined =
        message?.listResponseMessage?.singleSelectReply?.selectedRowId;

      const selectedDisplayText: string | undefined =
        message?.buttonsResponseMessage?.selectedDisplayText ||
        message?.listResponseMessage?.title;

      function normalize(s: string): string {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      }
      function isHumanRequestText(value: unknown): boolean {
        if (typeof value !== 'string') return false;
        const t = normalize(value);
        if (!t) return false;
        return t === '0' || t.includes('falar com atendente') || t.includes('com atendente') || t.includes('atendimento humano') || t.includes('atendente');
      }
      function mapTitleToCommand(title: string): string | undefined {
        const t = normalize(title);
        if (t.includes('@')) return undefined;
        if (/^\d+/.test(t)) {
          const m = t.match(/^(\d+)/);
          if (m) {
            const num = m[1];
            const n = parseInt(num, 10);
            if (num === '0' && t.includes('video') && t.includes('explic')) return '10';
            if (n >= 0 && n <= 10) return num;
          }
        }
        if (t.includes('minhas ligacoes') || t === 'minhas ligacoes') return '2';
        if (t.includes('emissao') && (t.includes('2a') || t.includes('2 via') || t.includes('2a via') || t.includes('via'))) return '4';
        if (t.includes('debitos') && (t.includes('faturas') || t.includes('2a') || t.includes('2 via') || t.includes('2a via') || t.includes('via'))) return '4';
        if (t.includes('enviar fatura')) return '4';
        if (t.includes('solicitar servicos') || (t.includes('servicos') && t.includes('religacao')) || t.includes('religacao')) return '5';
        if (t.includes('acompanhar') && (t.includes('solicitacoes') || t.includes('pedido') || t.includes('protocolo'))) return '6';
        if (t.includes('consumo') && t.includes('leituras')) return '3';
        if (t.includes('dados cadastrais') || t.includes('cadastrais') || t.includes('atualizar dados')) return '7';
        if (t.includes('atendimento presencial') || (t.includes('localizacao') && t.includes('presencial'))) return '8';
        if (t.includes('video') && (t.includes('orientativo') || t.includes('explicativo'))) return '1';
        if (t.includes('falar com atendente') || t.includes('atendente')) return '0';
        return undefined;
      }

      // Resolve o texto final para o bot
      let text = '';
      if (selectedButtonId) {
        text = selectedButtonId.trim();
      } else if (selectedRowId) {
        text = selectedRowId.trim();
      } else if (selectedDisplayText) {
        const mapped = mapTitleToCommand(selectedDisplayText);
        text = mapped ?? selectedDisplayText.trim();
      }
      if (!text && typeof textRaw === 'string') {
        const mapped = mapTitleToCommand(textRaw.trim());
        text = mapped ?? textRaw.trim();
      }

      const mediaPlaceholder =
        messageType.includes('audio') ? '[Audio recebido]' :
        messageType.includes('image') ? '[Imagem recebida]' :
        messageType.includes('video') ? '[Vídeo recebido]' :
        messageType.includes('document') ? '[Documento recebido]' :
        messageType.includes('sticker') ? '[Sticker recebido]' :
        messageType.includes('location') ? '[Localização recebida]' :
        '[Mensagem recebida]';

      if (!phone) {
        request.log.warn({ remoteJid, event, messageType }, 'Mensagem sem telefone válido. Ignorando.');
        return;
      }

      await logAudit(config, { whatsappPhone: phone, action: 'message_received', payload: { payload } });

      const displayContent = selectedDisplayText?.trim() || textRaw?.trim() || text || mediaPlaceholder;
      try {
        await logMessage(config, { phone, direction: 'in', content: displayContent });
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

      try {
        if (isHumanRequestText(selectedDisplayText) || isHumanRequestText(textRaw) || isHumanRequestText(text)) {
          await ensureOpenHumanTicket(config, phone);
        }
      } catch (e) {
        request.log.warn({ err: e, phone }, 'Falha ao garantir ticket humano pelo webhook');
      }

      if (!text) {
        request.log.info({ phone, messageType }, 'Mensagem registrada sem conteúdo textual para o bot.');
        return;
      }

      // Idempotência / dedupe
      const providerId = key?.id;
      const dedupeKey = providerId ? String(providerId) : `${phone}:${simpleHash(text)}:${data?.messageTimestamp ?? ''}`;
      const recent = getRecentSet(phone);
      sweepOldIds(phone);
      if (recent.has(dedupeKey)) {
        request.log.info({ phone, dedupeKey }, 'Duplicata detectada; ignorando.');
        return;
      }
      recent.set(dedupeKey, Date.now());

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
            if (typeof out === 'string') {
              await evolution.sendText({ phone, message: out });
              try { await logMessage(config, { phone, direction: 'out', content: out }); } catch {}
              publishHumanEvent({ type: 'message', phone, at: new Date().toISOString() });
            } else if ((out as any).type === 'buttons') {
              const buttonsOut = out as any;
              try {
                await evolution.sendButtonList({
                  phone,
                  message: buttonsOut.text,
                  buttons: (buttonsOut.buttons || []).map((b: any) => ({ id: b.id, label: b.text }))
                });
                try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
              } catch (err: any) {
                request.log.error({ err, phone }, 'Erro ao enviar buttons, usando fallback texto');
                const buttonsText = (buttonsOut.buttons || [])
                  .map((b: any, idx: number) => `${idx + 1} - ${b.text}`)
                  .join('\n');
                await evolution.sendText({
                  phone,
                  message: `${buttonsOut.text}\n\n${buttonsText}\n\nDigite o número correspondente ou use os botões acima.`
                });
              }
            } else if ((out as any).type === 'list') {
              const listOut = out as any;
              const options = ([] as Array<{ id?: string; title: string; description?: string }>)
                .concat(...(listOut.sections || []).map((s: any) => s.rows || []))
                .map((r: any) => ({ id: r.id, title: r.title, description: r.description }));
              await evolution.sendOptionList({
                phone,
                message: listOut.text,
                optionList: {
                  title: (listOut.sections && listOut.sections[0]?.title) || 'Opções disponíveis',
                  buttonLabel: listOut.buttonText || 'Abrir lista',
                  options
                }
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'copyCode') {
              const codeOut = out as any;
              await evolution.sendTextWithCode({
                phone,
                message: codeOut.message,
                code: codeOut.code,
                image: codeOut.image,
                buttonText: codeOut.buttonText
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'link') {
              const linkOut = out as any;
              await evolution.sendLink({
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
              await evolution.sendVideo({
                phone,
                video: videoOut.video,
                caption: videoOut.caption,
                viewOnce: videoOut.viewOnce
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'audio') {
              const audioOut = out as any;
              if (!audioOut.audioUrl) continue;
              await evolution.sendAudio({
                phone,
                audio: audioOut.audioUrl,
                viewOnce: audioOut.viewOnce,
                waveform: audioOut.waveform,
                delayTypingSeconds: audioOut.delayTypingSeconds
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'buttonActions') {
              const actionsOut = out as any;
              await evolution.sendButtonActions({
                phone,
                message: actionsOut.message,
                buttonActions: actionsOut.buttonActions
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'document') {
              const docOut = out as any;
              if (!docOut.document) continue;
              await evolution.sendDocument({
                phone,
                document: docOut.document,
                extension: docOut.extension || 'pdf',
                fileName: docOut.fileName,
                caption: docOut.caption
              });
              try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
            } else if ((out as any).type === 'location') {
              const locOut = out as any;
              await evolution.sendLocation({
                phone,
                title: locOut.title,
                address: locOut.address,
                latitude: locOut.latitude,
                longitude: locOut.longitude
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
      request.log.error({ err }, 'Erro ao processar webhook Evolution API');
    }
  };

  app.post('/webhook/evolution', handler);
  app.post('/webhook', handler);
}
