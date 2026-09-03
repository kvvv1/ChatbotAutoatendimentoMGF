import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { ZapiClient } from '../zapi/client.js';
import {
  listHumanTickets,
  getHumanTicketById,
  getMessagesByPhone,
  updateHumanTicketStatus,
  updateHumanTicketAssignee,
  updateHumanTicketCustomerName,
  listHumanTicketNotes,
  addHumanTicketNote,
  getCustomerByPhone,
  listLigacoesByCustomerId,
  listUserMediaByPhone,
  type HumanTicketStatus
} from '../supabase/humanTickets.js';
import { logMessage } from '../supabase/messages.js';
import { fetchClienteByCpf, loginByIdEletronico } from '../company/cliente.js';
import { fetchLigacoesByCpf } from '../company/ligacoes.js';
import { fetchDadosCadastraisByImovelId, fetchDadosCadastraisByLigacao } from '../company/cadastro.js';
import { publishHumanEvent, subscribeHumanEvents } from './events.js';
import { getDb } from '../supabase/client.js';
import { verifyAttendantCredentials } from '../supabase/attendants.js';
import { signAttendantToken } from './auth.js';

const statusSchema = z.enum(['pendente', 'em_atendimento', 'finalizado', 'cancelado', 'abertos']);

export async function registerHumanRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const zapi = new ZapiClient(config);

  // Login do atendente — só disponível quando ATTENDANT_AUTH_SECRET/API_SECRET está configurado
  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.attendantAuthSecret) {
      return reply.code(501).send({ error: 'attendant_auth_not_configured' });
    }

    const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    const attendant = await verifyAttendantCredentials(config, parsed.data.email, parsed.data.password);
    if (!attendant) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const token = signAttendantToken(
      { sub: attendant.id, nome: attendant.name, email: attendant.email },
      config.attendantAuthSecret
    );
    return { token, attendant: { id: attendant.id, nome: attendant.name, email: attendant.email } };
  });

  function extractIdEletronicoFromText(value: string): string | null {
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
    } catch (err) {
      app.log.error({ err }, 'Falha ao carregar painel de atendimento');
      return reply.code(500).send('Painel de atendimento indisponvel.');
    }
  });

  // Listagem de tickets (JSON)
  app.get('/api/human-tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    const querySchema = z
      .object({ status: statusSchema.optional() })
      .partial();

    const parse = querySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }

    const status = parse.data.status;
    const tickets = await listHumanTickets(config, { status: status as HumanTicketStatus | 'abertos' | undefined });
    return { data: tickets };
  });

  // Detalhe de ticket + mensagens (JSON)
  app.get('/api/human-tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const send = (payload: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
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
      } catch {
        // noop
      }
    });
  });

  // Perfil da conversa (cliente, ligacoes e midias do usuario)
  app.get('/api/human-tickets/:id/profile', async (request: FastifyRequest, reply: FastifyReply) => {
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

    let apiProfile: {
      idEletronico: string | null;
      cliente: { cpf: string; nome?: string | null; email?: string | null } | null;
      ligacoes: Array<{
        id: string;
        label: string;
        description?: string;
        cadastro?: {
          numeroLigacao?: string;
          nomeTitular?: string;
          numeroHidrometro?: string;
          situacaoAbastecimento?: string;
          enderecoImovel?: string;
          enderecoCorrespondencia?: string;
          categoria?: string;
          dataAtivacao?: string;
        } | null;
      }>;
    } | null = null;

    let idEletronico: string | null = null;
    try {
      const recent = await getMessagesByPhone(config, ticket.phone, { limit: 120 });
      for (let i = recent.length - 1; i >= 0; i -= 1) {
        const raw = String(recent[i]?.content || '');
        const parsed = raw.trim().startsWith('{') ? (() => {
          try { return JSON.parse(raw); } catch { return null; }
        })() : null;
        const candidates: string[] = [];
        if (raw) candidates.push(raw);
        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, unknown>;
          for (const k of ['message', 'text', 'caption', 'title']) {
            if (typeof p[k] === 'string') candidates.push(String(p[k]));
          }
        }
        for (const c of candidates) {
          const found = extractIdEletronicoFromText(c);
          if (found) {
            idEletronico = found;
            break;
          }
        }
        if (idEletronico) break;
      }
    } catch {
      // noop
    }

    const cpf = (customer?.cpf || '').replace(/\D/g, '');
    if (cpf && cpf.length === 11) {
      try {
        const clienteApi = await fetchClienteByCpf(config, cpf).catch(() => null);
        const ligacoesApi = await fetchLigacoesByCpf(config, cpf).catch(() => []);
        const ligacoesComCadastro = await Promise.all(
          ligacoesApi.slice(0, 5).map(async (lig) => {
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
          })
        );
        apiProfile = {
          idEletronico,
          cliente: clienteApi,
          ligacoes: ligacoesComCadastro
        };
      } catch {
        apiProfile = null;
      }
    }

    if ((!apiProfile || !apiProfile.ligacoes.length) && idEletronico) {
      try {
        const login = await loginByIdEletronico(config, idEletronico);
        const ligacoesById = await Promise.all(
          (login.imoveis || []).slice(0, 5).map(async (imovel) => {
            const cadastro = await fetchDadosCadastraisByImovelId(config, imovel.ImovelID).catch(() => null);
            return {
              id: String(imovel.ImovelID),
              label: `Imóvel ${imovel.ImovelID}`,
              description: imovel.Endereco || undefined,
              cadastro
            };
          })
        );
        apiProfile = {
          idEletronico,
          cliente: apiProfile?.cliente || null,
          ligacoes: ligacoesById
        };
      } catch {
        if (!apiProfile) {
          apiProfile = {
            idEletronico,
            cliente: null,
            ligacoes: []
          };
        }
      }
    }

    // Se o ticket ainda não tem nome, tenta resolver pelo titular da ligação ou nome do cliente da API
    if (!ticket.customer_name) {
      let resolvedName: string | null = null;
      if (apiProfile?.ligacoes?.length) {
        const nomeTitular = apiProfile.ligacoes
          .map((l) => l.cadastro?.nomeTitular)
          .find((n) => typeof n === 'string' && n.trim().length > 0);
        if (nomeTitular) resolvedName = nomeTitular.trim();
      }
      if (!resolvedName && apiProfile?.cliente?.nome) {
        resolvedName = String(apiProfile.cliente.nome).trim() || null;
      }
      if (resolvedName) {
        await updateHumanTicketCustomerName(config, ticket.id, resolvedName);
        ticket.customer_name = resolvedName;
        publishHumanEvent({ type: 'ticket_update', phone: ticket.phone, at: new Date().toISOString() });
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
  app.patch('/api/human-tickets/:id/assignee', async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.patch('/api/human-tickets/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/api/human-tickets/:id/send-message', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({ message: z.string().min(1), attendant: z.string().trim().min(1).optional() });

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
    } catch (err) {
      request.log.error({ err, phone }, 'Erro ao enviar mensagem do atendente');
      return reply.code(500).send({ error: 'send_failed' });
    }

    // Opcionalmente já marca como "em_atendimento" se ainda estiver pendente
    if (ticket.status === 'pendente') {
      await updateHumanTicketStatus(config, ticket.id, 'em_atendimento');
    }

    // Atribui o ticket a quem respondeu primeiro, sem sobrescrever atribuição existente.
    // Prefere a identidade verificada pelo token de login; só usa o nome enviado no corpo
    // (não verificável) como fallback pra instâncias que ainda não migraram pro login.
    const verifiedAttendantName = (request as any).attendant?.nome as string | undefined;
    const attendantName = verifiedAttendantName || bodyParse.data.attendant;
    if (!ticket.assigned_attendant && attendantName) {
      await updateHumanTicketAssignee(config, ticket.id, attendantName);
    }

    publishHumanEvent({ type: 'message', phone: ticket.phone, at: new Date().toISOString() });

    return { ok: true };
  });

  // Listar anotacoes internas do ticket
  app.get('/api/human-tickets/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/api/human-tickets/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
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

  // ── Feature flags ─────────────────────────────────────────────────────────
  app.get('/api/features', async () => ({
    enableContacts: config.enableContacts ?? false,
  }));

  // ── Agenda de Contatos (apenas quando ENABLE_CONTACTS=true) ───────────────
  const { randomUUID } = await import('node:crypto');
  const db = getDb(config);

  if (config.enableContacts) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        description VARCHAR(500),
        created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)
      )
    `);

    app.get('/api/contacts', async () => {
      const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
        'SELECT id, name, phone, description, created_at FROM contacts ORDER BY name ASC'
      );
      return { contacts: rows };
    });

    app.post('/api/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string; phone?: string; description?: string } | null;
      const name = body?.name?.trim();
      const phone = body?.phone?.replace(/\D/g, '');
      const description = body?.description?.trim() ?? null;
      if (!name || !phone) return reply.code(400).send({ error: 'name_e_phone_obrigatorios' });
      const id = randomUUID();
      await db.query(
        'INSERT INTO contacts (id, name, phone, description) VALUES (?, ?, ?, ?)',
        [id, name, phone, description]
      );
      const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
        'SELECT id, name, phone, description, created_at FROM contacts WHERE id = ?', [id]
      );
      return reply.code(201).send({ contact: (rows as any[])[0] });
    });

    app.delete('/api/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      await db.query('DELETE FROM contacts WHERE id = ?', [id]);
      return { ok: true };
    });

    app.post('/api/contacts/send', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { phone?: string; message?: string } | null;
      const phone = body?.phone?.replace(/\D/g, '');
      const message = body?.message?.trim();
      if (!phone || !message) return reply.code(400).send({ error: 'phone_e_message_obrigatorios' });
      try {
        await zapi.sendText({ phone, message });
        await logMessage(config, { phone, direction: 'out', content: message });
      } catch (err) {
        request.log.error({ err, phone }, 'Erro ao enviar mensagem de contato');
        return reply.code(500).send({ error: 'send_failed' });
      }
      return { ok: true };
    });

    app.get('/api/contacts/messages', async (request: FastifyRequest, reply: FastifyReply) => {
      const { phone } = request.query as { phone?: string };
      if (!phone) return reply.code(400).send({ error: 'phone_obrigatorio' });
      const messages = await getMessagesByPhone(config, phone.replace(/\D/g, ''), { limit: 100 });
      return { messages };
    });
  }

  // ── Respostas Rápidas ─────────────────────────────────────────────────────

  app.get('/api/quick-replies', async (_request, reply: FastifyReply) => {
    const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT id, titulo, conteudo, created_at, updated_at FROM quick_replies ORDER BY titulo ASC'
    );
    return { quickReplies: rows };
  });

  app.post('/api/quick-replies', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { titulo?: string; conteudo?: string } | null;
    const titulo = body?.titulo?.trim();
    const conteudo = body?.conteudo?.trim();
    if (!titulo || !conteudo) return reply.code(400).send({ error: 'titulo_e_conteudo_obrigatorios' });
    const id = randomUUID();
    await db.query(
      'INSERT INTO quick_replies (id, titulo, conteudo) VALUES (?, ?, ?)',
      [id, titulo, conteudo]
    );
    const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT id, titulo, conteudo, created_at, updated_at FROM quick_replies WHERE id = ?', [id]
    );
    return reply.code(201).send({ quickReply: (rows as any[])[0] });
  });

  app.put('/api/quick-replies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { titulo?: string; conteudo?: string } | null;
    const titulo = body?.titulo?.trim();
    const conteudo = body?.conteudo?.trim();
    if (!titulo || !conteudo) return reply.code(400).send({ error: 'titulo_e_conteudo_obrigatorios' });
    await db.query(
      'UPDATE quick_replies SET titulo = ?, conteudo = ?, updated_at = NOW(6) WHERE id = ?',
      [titulo, conteudo, id]
    );
    const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT id, titulo, conteudo, created_at, updated_at FROM quick_replies WHERE id = ?', [id]
    );
    if (!(rows as any[]).length) return reply.code(404).send({ error: 'not_found' });
    return { quickReply: (rows as any[])[0] };
  });

  app.delete('/api/quick-replies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await db.query('DELETE FROM quick_replies WHERE id = ?', [id]);
    return { ok: true };
  });
}
