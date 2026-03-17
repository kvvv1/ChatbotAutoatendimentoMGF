import { z } from 'zod';
import { ZapiClient } from './client.js';
import { MemorySessionStore } from '../state/memorySessionStore.js';
import { logAudit } from '../supabase/audit.js';
import { hasActiveHumanTicket, logMessage } from '../supabase/messages.js';
import { ensureOpenHumanTicket } from '../supabase/humanTickets.js';
import { processMessage } from '../bot/flow.js';
import { publishHumanEvent } from '../human/events.js';
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
export async function registerZapiRoutes(app, config) {
    const zapi = new ZapiClient(config);
    // Usa SessionStore em memória (não depende do Supabase)
    const sessionStore = new MemorySessionStore();
    // Estruturas em memória para antiflood e dedupe
    const userLocks = new Map();
    const userQueues = new Map();
    const debounceTimers = new Map();
    const lastMessageIds = new Map(); // phone -> (id/hash -> ts)
    const DEBOUNCE_MS = 1200;
    const DEDUPE_TTL_MS = 5 * 60 * 1000;
    function getRecentSet(phone) {
        if (!lastMessageIds.has(phone)) {
            lastMessageIds.set(phone, new Map());
        }
        return lastMessageIds.get(phone);
    }
    function sweepOldIds(phone) {
        const map = getRecentSet(phone);
        const now = Date.now();
        for (const [id, ts] of map.entries()) {
            if (now - ts > DEDUPE_TTL_MS)
                map.delete(id);
        }
    }
    function simpleHash(input) {
        try {
            let h = 2166136261;
            for (let i = 0; i < input.length; i++) {
                h ^= input.charCodeAt(i);
                h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
            }
            return String(h >>> 0);
        }
        catch {
            return String(Math.random());
        }
    }
    const handler = async (request, reply) => {
        let payload;
        try {
            payload = zapiWebhookSchema.parse(request.body);
        }
        catch (err) {
            request.log.error({ err }, 'Payload inválido do webhook Z-API');
            return reply.code(400).send({ error: 'invalid_payload' });
        }
        // Responder rápido para não estourar timeout da Z-API
        reply.code(200).send({ ok: true });
        // Processamento assíncrono
        try {
            // Ignora mensagens enviadas pelo próprio bot para evitar loop
            const fromMe = payload?.fromMe === true ||
                payload?.message?.fromMe === true ||
                payload?.key?.fromMe === true;
            if (fromMe) {
                request.log.info({
                    fromMe: payload?.fromMe,
                    messageFromMe: payload?.message?.fromMe,
                    keyFromMe: payload?.key?.fromMe,
                    owner: payload?.owner,
                    event: payload?.event
                }, 'Mensagem do próprio bot detectada. Ignorando.');
                return;
            }
            // Extração robusta de telefone e texto
            const userPhoneRaw = payload?.from ||
                payload?.phone ||
                payload?.phoneNumber ||
                payload?.message?.from ||
                payload?.sender?.phone ||
                payload?.sender?.id ||
                payload?.messages?.[0]?.from ||
                payload?.messages?.[0]?.phone ||
                payload?.messages?.[0]?.phoneNumber ||
                payload?.messages?.[0]?.message?.from ||
                payload?.messages?.[0]?.key?.remoteJid;
            const phone = typeof userPhoneRaw === 'string' ? userPhoneRaw.replace(/\D/g, '') : undefined;
            // Captura seleção interativa (botões/listas) em múltiplos formatos suportados pela Z-API
            const selectedIdCandidates = [
                payload?.selectedId,
                payload?.message?.button?.id,
                payload?.button?.id,
                payload?.message?.listResponse?.id,
                payload?.listResponse?.id,
                // Resposta de lista específica da Z-API
                payload?.listResponseMessage?.id,
                payload?.listResponseMessage?.selectedRowId,
                payload?.listResponseMessage?.singleSelectReply?.selectedRowId,
                payload?.listResponseMessage?.selected?.id,
                payload?.listResponseMessage?.option?.id,
                payload?.interactive?.buttonId,
                payload?.message?.interactive?.buttonId,
                // Resposta de botões específica da Z-API
                payload?.buttonsResponseMessage?.id,
                payload?.buttonsResponseMessage?.buttonId,
                payload?.buttonsResponseMessage?.selectedId,
                payload?.buttonsResponseMessage?.button?.id,
                // List replies (variações camelCase/snake_case)
                payload?.interactive?.listReply?.id,
                payload?.interactive?.list_reply?.id,
                payload?.message?.interactive?.listReply?.id,
                payload?.message?.interactive?.list_reply?.id,
                // Option list replies
                payload?.message?.optionListResponse?.id,
                payload?.optionListResponse?.id,
                payload?.message?.optionListResponse?.selected?.id,
                payload?.optionListResponse?.selected?.id,
                payload?.message?.optionListResponse?.option?.id,
                payload?.optionListResponse?.option?.id,
                payload?.messages?.[0]?.optionListResponse?.id,
                payload?.messages?.[0]?.optionListResponse?.selected?.id,
                payload?.messages?.[0]?.interactive?.listReply?.id,
                payload?.messages?.[0]?.listResponse?.id,
                payload?.optionSelectedId,
                payload?.selected?.id
            ];
            const rawSelectedId = selectedIdCandidates.find(v => {
                if (typeof v === 'string')
                    return v.trim().length > 0;
                if (typeof v === 'number')
                    return String(v).trim().length > 0;
                return false;
            });
            const selectedId = rawSelectedId !== undefined ? String(rawSelectedId).trim() : undefined;
            const textRaw = payload?.text?.message ||
                payload?.message?.text ||
                payload?.text?.body ||
                payload?.message?.text?.body ||
                payload?.message?.body ||
                payload?.message?.extendedTextMessage?.text ||
                payload?.message?.extendedText?.text ||
                payload?.message?.conversation ||
                payload?.text ||
                (typeof payload?.message === 'string' ? payload.message : null) ||
                payload?.body ||
                payload?.messages?.[0]?.text?.body ||
                payload?.messages?.[0]?.message?.text ||
                payload?.messages?.[0]?.message?.text?.body ||
                payload?.messages?.[0]?.message?.body ||
                payload?.messages?.[0]?.message?.conversation ||
                payload?.messages?.[0]?.message?.extendedTextMessage?.text ||
                payload?.messages?.[0]?.message?.extendedText?.text ||
                payload?.messages?.[0]?.conversation;
            // Também tenta extrair título/nome da opção selecionada
            const selectedTitleCandidates = [
                payload?.interactive?.listReply?.title,
                payload?.interactive?.list_reply?.title,
                payload?.message?.interactive?.listReply?.title,
                payload?.message?.interactive?.list_reply?.title,
                payload?.message?.optionListResponse?.title,
                payload?.optionListResponse?.title,
                // Título/label de resposta de lista da Z-API
                payload?.listResponseMessage?.title,
                payload?.listResponseMessage?.singleSelectReply?.title,
                payload?.listResponseMessage?.selected?.title,
                payload?.listResponseMessage?.option?.title,
                // Título/label da resposta de botões da Z-API
                payload?.buttonsResponseMessage?.title,
                payload?.buttonsResponseMessage?.label,
                payload?.buttonsResponseMessage?.text,
                payload?.selected?.title,
                payload?.message?.selected?.title,
                payload?.message?.optionListResponse?.selected?.title,
                payload?.optionListResponse?.selected?.title,
                payload?.message?.optionListResponse?.option?.title,
                payload?.optionListResponse?.option?.title,
                payload?.messages?.[0]?.optionListResponse?.selected?.title,
                payload?.messages?.[0]?.interactive?.listReply?.title,
                payload?.listResponse?.title,
                payload?.message?.listResponse?.title
            ];
            const selectedTitle = selectedTitleCandidates.find(v => typeof v === 'string' && v.trim().length > 0);
            function normalize(s) {
                return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            }
            function isHumanRequestText(value) {
                if (typeof value !== 'string')
                    return false;
                const t = normalize(value);
                if (!t)
                    return false;
                return t === '0' || t.includes('falar com atendente') || t.includes('com atendente') || t.includes('atendimento humano') || t.includes('atendente');
            }
            function mapTitleToCommand(title) {
                const t = normalize(title);
                if (/^\d+/.test(t)) {
                    // Se começar com número (ex.: "0) Video explicativo"), tenta capturar
                    const m = t.match(/^(\d+)/);
                    if (m) {
                        const num = m[1];
                        // Caso especial: "0) Vídeo explicativo" usamos id interno "10"
                        if (num === '0' && t.includes('video') && t.includes('explic'))
                            return '10';
                        return num;
                    }
                }
                // 2 - Minhas ligações
                if (t.includes('minhas ligacoes') || t === 'minhas ligacoes')
                    return '2';
                // 4 - Emissão de 2ª via (antes: débitos / 2ª via / enviar fatura)
                if (t.includes('emissao') &&
                    (t.includes('2a') || t.includes('2 via') || t.includes('2a via') || t.includes('via')))
                    return '4';
                if (t.includes('debitos') &&
                    (t.includes('faturas') || t.includes('2a') || t.includes('2 via') || t.includes('2a via') || t.includes('via')))
                    return '4';
                if (t.includes('enviar fatura'))
                    return '4';
                // 5 - Solicitar serviços (religação)
                if (t.includes('solicitar servicos') ||
                    (t.includes('servicos') && t.includes('religacao')) ||
                    t.includes('religacao'))
                    return '5';
                // 6 - Acompanhar solicitações
                if (t.includes('acompanhar') &&
                    (t.includes('solicitacoes') || t.includes('pedido') || t.includes('protocolo')))
                    return '6';
                // 3 - Histórico de consumo e leituras
                if (t.includes('consumo') && t.includes('leituras'))
                    return '3';
                // 7 - Atualizar dados cadastrais
                if (t.includes('dados cadastrais') || t.includes('cadastrais') || t.includes('atualizar dados'))
                    return '7';
                // 8 - Localização para atendimento presencial
                if (t.includes('atendimento presencial') || (t.includes('localizacao') && t.includes('presencial')))
                    return '8';
                // 1 - Vídeo orientativo/explicativo
                if (t.includes('video') && (t.includes('orientativo') || t.includes('explicativo')))
                    return '1';
                // 0 - Falar com atendente
                if (t.includes('falar com atendente') || t.includes('atendente'))
                    return '0';
                return undefined;
            }
            let text = '';
            if (typeof selectedTitle === 'string') {
                const mapped = mapTitleToCommand(selectedTitle);
                if (mapped)
                    text = mapped;
            }
            if (!text && typeof selectedId === 'string') {
                text = selectedId.trim();
            }
            if (!text && typeof textRaw === 'string') {
                const textRawTrimmed = textRaw.trim();
                const mappedFromText = mapTitleToCommand(textRawTrimmed);
                text = mappedFromText || textRawTrimmed;
            }
            // Heurística: varre o payload procurando um título conhecido quando id/título/texto não vieram nos campos padrão
            if (!text) {
                const knownLabels = [
                    // Espelha exatamente os títulos usados em MENU_ITEMS em src/bot/flow.ts
                    { label: 'Vídeo orientativo', id: '1' },
                    { label: 'Minhas ligações', id: '2' },
                    { label: 'Histórico de consumo e leituras', id: '3' },
                    { label: 'Emissão de 2ª via', id: '4' },
                    { label: 'Solicitar serviços (ex.: religação)', id: '5' },
                    { label: 'Acompanhar solicitações', id: '6' },
                    { label: 'Dados cadastrais da ligação', id: '7' },
                    { label: 'Localização para atendimento presencial', id: '8' },
                    { label: 'Falar com atendente', id: '0' }
                ];
                const flatStrings = [];
                const visited = new Set();
                function collectStrings(node, depth = 0) {
                    if (!node || depth > 5 || visited.has(node))
                        return;
                    visited.add(node);
                    if (typeof node === 'string') {
                        flatStrings.push(node);
                        return;
                    }
                    if (Array.isArray(node)) {
                        for (const item of node)
                            collectStrings(item, depth + 1);
                        return;
                    }
                    if (typeof node === 'object') {
                        for (const k of Object.keys(node))
                            collectStrings(node[k], depth + 1);
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
            if (!phone) {
                // Loga chaves principais para diagnóstico rápido (sem payload completo)
                try {
                    const msg = payload?.message ?? {};
                    const listResp = payload?.listResponseMessage;
                    const optionResp = payload?.optionListResponse;
                    const keys = Object.keys(payload || {});
                    const msgKeys = Object.keys(msg || {});
                    request.log.warn({ phone, text, keys, msgKeys, listResponseMessage: listResp, optionListResponse: optionResp }, 'Mensagem inválida');
                }
                catch {
                    request.log.warn({ phone, text }, 'Mensagem inválida');
                }
                return;
            }
            const messageType = String(payload?.message?.type ||
                payload?.type ||
                payload?.messages?.[0]?.message?.type ||
                '').toLowerCase();
            const mediaPlaceholder = messageType.includes('audio') ? '[Audio recebido]' :
                messageType.includes('image') ? '[Imagem recebida]' :
                    messageType.includes('video') ? '[Vídeo recebido]' :
                        messageType.includes('document') ? '[Documento recebido]' :
                            messageType.includes('sticker') ? '[Sticker recebido]' :
                                messageType.includes('location') ? '[Localização recebida]' :
                                    '[Mensagem recebida]';
            await logAudit(config, {
                whatsappPhone: phone,
                action: 'message_received',
                payload: { payload }
            });
            // Log opcional de mensagem de entrada (preferindo título/texto exibido ao usuário)
            const displayContent = (typeof selectedTitle === 'string' && selectedTitle.trim().length > 0)
                ? selectedTitle.trim()
                : (typeof textRaw === 'string' && textRaw.trim().length > 0)
                    ? textRaw.trim()
                    : text || mediaPlaceholder;
            try {
                await logMessage(config, { phone, direction: 'in', content: displayContent });
                publishHumanEvent({ type: 'message', phone, at: new Date().toISOString() });
            }
            catch (e) {
                request.log.warn({ err: e }, 'Falha ao logar mensagem de entrada');
            }
            // Silenciar se houver atendimento humano ativo
            try {
                if (await hasActiveHumanTicket(config, phone)) {
                    request.log.info({ phone }, 'Atendimento humano ativo. Bot silenciado.');
                    return;
                }
            }
            catch (e) {
                request.log.warn({ err: e }, 'Falha na checagem de atendimento humano');
            }
            // Fallback simples: se o payload indicar pedido de atendente, garante ticket aberto.
            try {
                if (isHumanRequestText(selectedTitle) || isHumanRequestText(textRaw) || isHumanRequestText(text)) {
                    await ensureOpenHumanTicket(config, phone);
                }
            }
            catch (e) {
                request.log.warn({ err: e, phone }, 'Falha ao garantir ticket humano pelo webhook');
            }
            // Sem texto/interação utilizável para bot: apenas registra no painel e encerra.
            if (!text) {
                request.log.info({ phone, messageType }, 'Mensagem registrada sem conteúdo textual para o bot.');
                return;
            }
            // Idempotência / dedupe
            const providerId = payload?.id ||
                payload?.messageId ||
                payload?.key?.id;
            const dedupeKey = providerId ? String(providerId) : `${phone}:${simpleHash(text)}:${payload?.timestamp || payload?.t || ''}`;
            const recent = getRecentSet(phone);
            sweepOldIds(phone);
            if (recent.has(dedupeKey)) {
                request.log.info({ phone, dedupeKey }, 'Duplicata detectada; ignorando.');
                return;
            }
            recent.set(dedupeKey, Date.now());
            // Enfileirar e aplicar debounce por usuário
            if (!userQueues.has(phone))
                userQueues.set(phone, []);
            userQueues.get(phone).push(text);
            if (debounceTimers.has(phone))
                clearTimeout(debounceTimers.get(phone));
            debounceTimers.set(phone, setTimeout(async () => {
                const queue = userQueues.get(phone) || [];
                userQueues.set(phone, []);
                const latestMessage = queue.length > 0 ? queue[queue.length - 1] : text;
                if (userLocks.get(phone)) {
                    // já processando; re-agenda breve
                    userQueues.get(phone).push(latestMessage);
                    debounceTimers.set(phone, setTimeout(() => { }, DEBOUNCE_MS));
                    return;
                }
                userLocks.set(phone, true);
                try {
                    const replies = await processMessage(config, phone, latestMessage, sessionStore);
                    for (const out of replies) {
                        if (typeof out === 'string') {
                            await zapi.sendText({ phone, message: out });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: out });
                            }
                            catch { }
                            publishHumanEvent({ type: 'message', phone, at: new Date().toISOString() });
                        }
                        else if (out.type === 'buttons') {
                            const buttonsOut = out;
                            try {
                                // Usa o endpoint /send-button-list da Z-API (atributo buttonList)
                                request.log.info({ phone, buttons: buttonsOut.buttons, text: buttonsOut.text }, 'Enviando button-list');
                                await zapi.sendButtonList({
                                    phone,
                                    message: buttonsOut.text,
                                    buttons: (buttonsOut.buttons || []).map((b) => ({ id: b.id, label: b.text }))
                                });
                                request.log.info({ phone }, 'Button-list enviada com sucesso');
                                try {
                                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                                }
                                catch { }
                            }
                            catch (err) {
                                request.log.error({ err, phone, buttons: buttonsOut.buttons, text: buttonsOut.text }, 'Erro ao enviar button-list, tentando fallback em texto numerado');
                                // Fallback: envia como texto com opções numeradas para o usuário digitar 1, 2, etc.
                                const buttonsText = (buttonsOut.buttons || [])
                                    .map((b, idx) => `${idx + 1} - ${b.text}`)
                                    .join('\n');
                                await zapi.sendText({
                                    phone,
                                    message: `${buttonsOut.text}\n\n${buttonsText}\n\nDigite o número correspondente ou use os botões acima.`
                                });
                            }
                        }
                        else if (out.type === 'list') {
                            const listOut = out;
                            // Converte lista com sections para optionList (send-option-list), que é o recomendado pela Z-API
                            const options = []
                                .concat(...(listOut.sections || []).map((s) => s.rows || []))
                                .map((r) => ({ id: r.id, title: r.title, description: r.description }));
                            await zapi.sendOptionList({
                                phone,
                                message: listOut.text,
                                optionList: {
                                    title: (listOut.sections && listOut.sections[0]?.title) || 'Opções disponíveis',
                                    buttonLabel: listOut.buttonText || 'Abrir lista',
                                    options
                                }
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'copyCode') {
                            const codeOut = out;
                            await zapi.sendTextWithCode({
                                phone,
                                message: codeOut.message,
                                code: codeOut.code,
                                image: codeOut.image,
                                buttonText: codeOut.buttonText
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'link') {
                            const linkOut = out;
                            await zapi.sendLink({
                                phone,
                                message: linkOut.message,
                                image: linkOut.image,
                                linkUrl: linkOut.linkUrl,
                                title: linkOut.title,
                                linkDescription: linkOut.linkDescription
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'video') {
                            const videoOut = out;
                            await zapi.sendVideo({
                                phone,
                                video: videoOut.video,
                                caption: videoOut.caption,
                                viewOnce: videoOut.viewOnce
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'audio') {
                            const audioOut = out;
                            if (!audioOut.audioUrl)
                                continue;
                            await zapi.sendAudio({
                                phone,
                                audio: audioOut.audioUrl,
                                viewOnce: audioOut.viewOnce,
                                waveform: audioOut.waveform,
                                delayTypingSeconds: audioOut.delayTypingSeconds
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'buttonActions') {
                            const actionsOut = out;
                            await zapi.sendButtonActions({
                                phone,
                                message: actionsOut.message,
                                buttonActions: actionsOut.buttonActions
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'document') {
                            const docOut = out;
                            if (!docOut.document)
                                continue;
                            await zapi.sendDocument({
                                phone,
                                document: docOut.document,
                                extension: docOut.extension || 'pdf',
                                fileName: docOut.fileName,
                                caption: docOut.caption
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                        else if (out.type === 'location') {
                            const locOut = out;
                            await zapi.sendLocation({
                                phone,
                                title: locOut.title,
                                address: locOut.address,
                                latitude: locOut.latitude,
                                longitude: locOut.longitude
                            });
                            try {
                                await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                            }
                            catch { }
                        }
                    }
                }
                catch (err) {
                    request.log.error({ err }, 'Erro no processamento debounced');
                }
                finally {
                    userLocks.set(phone, false);
                }
            }, DEBOUNCE_MS));
        }
        catch (err) {
            request.log.error({ err }, 'Erro ao processar webhook Z-API');
        }
    };
    // Suporta ambos os caminhos para evitar 404 por inversão de segmentos
    app.post('/webhook/zapi', handler);
    app.post('/zapi/webhook', handler);
    app.post('/webhook', handler);
}
