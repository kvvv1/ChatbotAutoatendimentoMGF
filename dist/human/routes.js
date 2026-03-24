import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { ZapiClient } from '../zapi/client.js';
import { listHumanTickets, getHumanTicketById, getMessagesByPhone, updateHumanTicketStatus, updateHumanTicketAssignee, listHumanTicketNotes, addHumanTicketNote, getCustomerByPhone, listLigacoesByCustomerId, listUserMediaByPhone } from '../supabase/humanTickets.js';
import { logMessage } from '../supabase/messages.js';
import { fetchClienteByCpf, loginByIdEletronico } from '../company/cliente.js';
import { fetchLigacoesByCpf } from '../company/ligacoes.js';
import { fetchDadosCadastraisByImovelId, fetchDadosCadastraisByLigacao } from '../company/cadastro.js';
import { publishHumanEvent, subscribeHumanEvents } from './events.js';
const statusSchema = z.enum(['pendente', 'em_atendimento', 'finalizado', 'cancelado', 'abertos']);
export async function registerHumanRoutes(app, config) {
    const zapi = new ZapiClient(config);
    function extractIdEletronicoFromText(value) {
        const m = String(value || '').match(/\b\d+@[A-Za-z0-9]+\b/);
        return m ? m[0].trim() : null;
    }
    // Página HTML simples do painel
    app.get('/human-tickets', async (_request, reply) => {
        try {
            const panelPath = path.join(process.cwd(), 'painel-atendimento', 'index.html');
            const html = await fs.promises.readFile(panelPath, 'utf-8');
            reply.type('text/html; charset=utf-8');
            return reply.send(html);
        }
        catch (err) {
            app.log.error({ err }, 'Falha ao carregar painel de atendimento');
            return reply.code(500).send('Painel de atendimento indisponvel.');
        }
    });
    // Listagem de tickets (JSON)
    app.get('/api/human-tickets', async (request, reply) => {
        const querySchema = z
            .object({ status: statusSchema.optional() })
            .partial();
        const parse = querySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.code(400).send({ error: 'invalid_query' });
        }
        const status = parse.data.status;
        const tickets = await listHumanTickets(config, { status: status });
        return { data: tickets };
    });
    // Detalhe de ticket + mensagens (JSON)
    app.get('/api/human-tickets/:id', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const parse = paramsSchema.safeParse(request.params);
        if (!parse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const ticket = await getHumanTicketById(config, parse.data.id);
        if (!ticket) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        const [messages, notes] = await Promise.all([
            getMessagesByPhone(config, ticket.phone),
            listHumanTicketNotes(config, ticket.id)
        ]);
        return { ticket, messages, notes };
    });
    // Stream SSE para atualização em tempo real do painel
    app.get('/api/human/stream', async (request, reply) => {
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders?.();
        const send = (payload) => {
            try {
                reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
            }
            catch {
                // noop
            }
        };
        send({ type: 'connected', at: new Date().toISOString() });
        const unsubscribe = subscribeHumanEvents((event) => {
            send(event);
        });
        const ping = setInterval(() => {
            send({ type: 'ping', at: new Date().toISOString() });
        }, 25000);
        request.raw.on('close', () => {
            clearInterval(ping);
            unsubscribe();
            try {
                reply.raw.end();
            }
            catch {
                // noop
            }
        });
    });
    // Perfil da conversa (cliente, ligacoes e midias do usuario)
    app.get('/api/human-tickets/:id/profile', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const parse = paramsSchema.safeParse(request.params);
        if (!parse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const ticket = await getHumanTicketById(config, parse.data.id);
        if (!ticket) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        const customer = await getCustomerByPhone(config, ticket.phone);
        const [ligacoes, media] = await Promise.all([
            customer?.id ? listLigacoesByCustomerId(config, customer.id) : Promise.resolve([]),
            listUserMediaByPhone(config, ticket.phone)
        ]);
        let apiProfile = null;
        let idEletronico = null;
        try {
            const recent = await getMessagesByPhone(config, ticket.phone, { limit: 120 });
            for (let i = recent.length - 1; i >= 0; i -= 1) {
                const raw = String(recent[i]?.content || '');
                const parsed = raw.trim().startsWith('{') ? (() => {
                    try {
                        return JSON.parse(raw);
                    }
                    catch {
                        return null;
                    }
                })() : null;
                const candidates = [];
                if (raw)
                    candidates.push(raw);
                if (parsed && typeof parsed === 'object') {
                    const p = parsed;
                    for (const k of ['message', 'text', 'caption', 'title']) {
                        if (typeof p[k] === 'string')
                            candidates.push(String(p[k]));
                    }
                }
                for (const c of candidates) {
                    const found = extractIdEletronicoFromText(c);
                    if (found) {
                        idEletronico = found;
                        break;
                    }
                }
                if (idEletronico)
                    break;
            }
        }
        catch {
            // noop
        }
        const cpf = (customer?.cpf || '').replace(/\D/g, '');
        if (cpf && cpf.length === 11) {
            try {
                const clienteApi = await fetchClienteByCpf(config, cpf).catch(() => null);
                const ligacoesApi = await fetchLigacoesByCpf(config, cpf).catch(() => []);
                const ligacoesComCadastro = await Promise.all(ligacoesApi.slice(0, 5).map(async (lig) => {
                    const cadastro = await fetchDadosCadastraisByLigacao(config, {
                        cpf,
                        ligacaoId: lig.id
                    }).catch(() => null);
                    return {
                        id: lig.id,
                        label: lig.label,
                        description: lig.description,
                        cadastro
                    };
                }));
                apiProfile = {
                    idEletronico,
                    cliente: clienteApi,
                    ligacoes: ligacoesComCadastro
                };
            }
            catch {
                apiProfile = null;
            }
        }
        if ((!apiProfile || !apiProfile.ligacoes.length) && idEletronico) {
            try {
                const login = await loginByIdEletronico(config, idEletronico);
                const ligacoesById = await Promise.all((login.imoveis || []).slice(0, 5).map(async (imovel) => {
                    const cadastro = await fetchDadosCadastraisByImovelId(config, imovel.ImovelID).catch(() => null);
                    return {
                        id: String(imovel.ImovelID),
                        label: `Imóvel ${imovel.ImovelID}`,
                        description: imovel.Endereco || undefined,
                        cadastro
                    };
                }));
                apiProfile = {
                    idEletronico,
                    cliente: apiProfile?.cliente || null,
                    ligacoes: ligacoesById
                };
            }
            catch {
                if (!apiProfile) {
                    apiProfile = {
                        idEletronico,
                        cliente: null,
                        ligacoes: []
                    };
                }
            }
        }
        return {
            ticket,
            customer,
            ligacoes,
            media,
            api: apiProfile
        };
    });
    // Transferir ticket para outro atendente
    app.patch('/api/human-tickets/:id/assignee', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({ assignedAttendant: z.string().trim().min(1) });
        const paramsParse = paramsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const bodyParse = bodySchema.safeParse(request.body);
        if (!bodyParse.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const updated = await updateHumanTicketAssignee(config, paramsParse.data.id, bodyParse.data.assignedAttendant);
        if (!updated) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        publishHumanEvent({ type: 'ticket_update', phone: updated.phone, at: new Date().toISOString() });
        return { ticket: updated };
    });
    // Atualizar status do ticket
    app.patch('/api/human-tickets/:id/status', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({ status: z.enum(['pendente', 'em_atendimento', 'finalizado', 'cancelado']) });
        const paramsParse = paramsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const bodyParse = bodySchema.safeParse(request.body);
        if (!bodyParse.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const updated = await updateHumanTicketStatus(config, paramsParse.data.id, bodyParse.data.status);
        if (!updated) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        publishHumanEvent({ type: 'ticket_update', phone: updated.phone, at: new Date().toISOString() });
        return { ticket: updated };
    });
    // Enviar mensagem ao usuário a partir do painel humano
    app.post('/api/human-tickets/:id/send-message', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({ message: z.string().min(1) });
        const paramsParse = paramsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const bodyParse = bodySchema.safeParse(request.body);
        if (!bodyParse.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const ticket = await getHumanTicketById(config, paramsParse.data.id);
        if (!ticket) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        const phone = ticket.phone;
        const text = bodyParse.data.message;
        try {
            await zapi.sendText({ phone, message: text });
            await logMessage(config, { phone, direction: 'out', content: text });
        }
        catch (err) {
            request.log.error({ err, phone }, 'Erro ao enviar mensagem do atendente');
            return reply.code(500).send({ error: 'send_failed' });
        }
        // Opcionalmente já marca como "em_atendimento" se ainda estiver pendente
        if (ticket.status === 'pendente') {
            await updateHumanTicketStatus(config, ticket.id, 'em_atendimento');
        }
        publishHumanEvent({ type: 'message', phone: ticket.phone, at: new Date().toISOString() });
        return { ok: true };
    });
    // Listar anotacoes internas do ticket
    app.get('/api/human-tickets/:id/notes', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const paramsParse = paramsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const ticket = await getHumanTicketById(config, paramsParse.data.id);
        if (!ticket) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        const notes = await listHumanTicketNotes(config, ticket.id);
        return { data: notes };
    });
    // Criar anotacao interna (nao enviada ao cliente)
    app.post('/api/human-tickets/:id/notes', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({
            note: z.string().trim().min(1),
            author: z.string().trim().min(1).default('Equipe')
        });
        const paramsParse = paramsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return reply.code(400).send({ error: 'invalid_id' });
        }
        const bodyParse = bodySchema.safeParse(request.body);
        if (!bodyParse.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const ticket = await getHumanTicketById(config, paramsParse.data.id);
        if (!ticket) {
            return reply.code(404).send({ error: 'ticket_not_found' });
        }
        const created = await addHumanTicketNote(config, {
            ticketId: ticket.id,
            author: bodyParse.data.author,
            note: bodyParse.data.note
        });
        if (!created) {
            return reply.code(500).send({ error: 'note_create_failed' });
        }
        publishHumanEvent({ type: 'ticket_update', phone: ticket.phone, at: new Date().toISOString() });
        return { note: created };
    });
}
