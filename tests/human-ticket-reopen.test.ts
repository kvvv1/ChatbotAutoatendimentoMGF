import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import Fastify from 'fastify';
import mysql from 'mysql2/promise';
import type { AppConfig } from '../src/config.js';
import { isSeteLagoas, loadConfig } from '../src/config.js';
import { closeDb } from '../src/supabase/client.js';
import { ensureOpenHumanTicket, reopenFinalizedHumanTicket, type HumanTicket } from '../src/supabase/humanTickets.js';
import { routeIncomingHumanMessage } from '../src/human/incoming.js';
import { subscribeHumanEvents, type HumanRealtimeEvent } from '../src/human/events.js';
import { registerHumanRoutes } from '../src/human/routes.js';
import { registerZapiRoutes } from '../src/zapi/webhook.js';
import { registerEvolutionRoutes } from '../src/evolution/webhook.js';
import { registerMetaRoutes } from '../src/meta/webhook.js';
import { ZapiClient } from '../src/zapi/client.js';
import { EvolutionClient } from '../src/evolution/client.js';
import { MetaClient } from '../src/meta/client.js';
import { messages } from '../src/bot/menus.js';
import { MemorySessionStore } from '../src/state/memorySessionStore.js';

const phone = '5531999999999';
const ticketId = 'a39d1138-3667-4da4-b58c-75ae878dc2ba';
const config = {
  municipio: 'sete-lagoas',
  zapiBaseUrl: 'https://whatsapp.invalid',
  zapiInstanceId: 'test-instance',
  zapiToken: 'test-token', entidadeNome: 'SAAE',
  businessDayStart: 1, businessDayEnd: 5,
  businessHoursStart: '08:00', businessHoursEnd: '16:30',
  businessSaturdayEnabled: true, businessSaturdayStart: '07:00', businessSaturdayEnd: '18:30'
} as AppConfig;

function ticket(overrides: Partial<HumanTicket> = {}): HumanTicket {
  return {
    id: ticketId, phone, status: 'finalizado', assigned_attendant: 'Operador anterior',
    customer_name: 'Cliente de teste', created_at: '2026-10-01 10:00:00',
    updated_at: '2026-10-01 10:30:00', ...overrides
  };
}

// Substitui somente a persistência: rotas, regras e eventos executam o código real.
class TestDatabase {
  tickets: HumanTicket[] = [ticket()];
  messages: unknown[][] = [];
  audits: unknown[][] = [];
  events: HumanRealtimeEvent[] = [];
  outbound: Array<{ phone: string; message: string }> = [];
  connections = 0;
  releases = 0;
  commits = 0;
  rollbacks = 0;
  failReadAfterUpdate = false;
  private locked: Promise<void> = Promise.resolve();

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown[]]> {
    if (sql.startsWith('INSERT INTO messages')) {
      this.messages.push(values);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      this.audits.push(values);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM human_tickets WHERE phone')) {
      const rows = this.tickets.filter(t => t.phone === values[0]
        && (!sql.includes('status IN') || ['pendente', 'em_atendimento'].includes(t.status)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return [structuredClone(rows), []];
    }
    if (sql.includes('SELECT status FROM human_tickets')) {
      return [this.tickets.filter(t => t.phone === values[0] && ['pendente', 'em_atendimento'].includes(t.status)), []];
    }
    if (sql.startsWith("UPDATE human_tickets SET status = 'pendente'")) {
      const found = this.tickets.find(t => t.id === values[0] && t.status === 'finalizado');
      if (found) {
        found.status = 'pendente';
        found.updated_at = '2026-10-13 11:00:00';
      }
      return [{ affectedRows: found ? 1 : 0 }, []];
    }
    if (sql.startsWith('UPDATE human_tickets SET status = ?')) {
      const found = this.tickets.find(t => t.id === values[1]);
      if (found) found.status = values[0] as HumanTicket['status'];
      return [{ affectedRows: found ? 1 : 0 }, []];
    }
    if (sql.startsWith('UPDATE human_tickets SET customer_name = ?')) {
      const found = this.tickets.find(t => t.id === values[1]);
      if (found) found.customer_name = values[0] as string;
      return [{ affectedRows: found ? 1 : 0 }, []];
    }
    if (sql.startsWith('INSERT INTO human_tickets')) {
      this.tickets.push(ticket({ id: values[0] as string, phone: values[1] as string,
        status: values[2] as HumanTicket['status'], customer_name: values[3] as string | null,
        assigned_attendant: null, created_at: '2026-10-14 12:00:00' }));
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM human_tickets WHERE id')) {
      if (this.failReadAfterUpdate) throw new Error('simulated database failure');
      return [structuredClone(this.tickets.filter(t => t.id === values[0])), []];
    }
    throw new Error('Unexpected database query: ' + sql);
  }

  async getConnection() {
    this.connections++;
    let unlock = () => {};
    let snapshot: HumanTicket[];
    return {
      beginTransaction: async () => {
        const previous = this.locked;
        this.locked = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
        snapshot = structuredClone(this.tickets);
      },
      query: this.query.bind(this),
      commit: async () => { this.commits++; unlock(); },
      rollback: async () => { this.rollbacks++; this.tickets = snapshot; unlock(); },
      release: () => { this.releases++; }
    };
  }

  async end() {}
}

let db: TestDatabase;
let unsubscribe: () => void;
beforeEach(() => {
  db = new TestDatabase();
  mock.method(mysql, 'createPool', () => db);
  for (const client of [ZapiClient, EvolutionClient, MetaClient]) {
    mock.method(client.prototype, 'sendText', async (payload: { phone: string; message: string }) => {
      db.outbound.push(payload);
    });
    mock.method(client.prototype, 'sendOptionList', async () => {});
  }
  unsubscribe = subscribeHumanEvents(event => db.events.push(event));
});
afterEach(async () => {
  unsubscribe();
  await closeDb();
  mock.restoreAll();
});

test('MUNICIPIO é carregado e os dois identificadores de Sete Lagoas habilitam a regra', () => {
  const env = {
    MUNICIPIO: ' SETE-LAGOAS ', DB_SERVER: 'test', DB_USER: 'test', DB_PASSWORD: 'test',
    DB_DATABASE: 'test', ZAPI_BASE_URL: 'https://whatsapp.invalid', ZAPI_INSTANCE_ID: 'test', ZAPI_TOKEN: 'test'
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    const loaded = loadConfig();
    assert.equal(loaded.municipio, 'sete-lagoas');
    assert.equal(isSeteLagoas(loaded), true);
    assert.equal(isSeteLagoas({ municipio: ' 7LAGOAS ' }), true);
    process.env.MUNICIPIO = '7lagoas';
    assert.equal(loadConfig().municipio, '7lagoas');
    assert.equal(isSeteLagoas({ ...loaded, municipio: 'formiga' }), false);
    assert.equal(isSeteLagoas({ ...loaded, municipio: undefined }), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('mensagem comum após finalizar segue o bot sem reabrir o ticket nos dois identificadores', async () => {
  for (const municipio of ['7lagoas', 'sete-lagoas']) {
    assert.equal(await routeIncomingHumanMessage({ ...config, municipio }, phone), false);
    assert.equal(db.tickets[0].status, 'finalizado');
  }
  assert.equal(db.connections, 0);
  assert.equal(db.events.length, 0);
});

test('7lagoas reabre atendimentos ao solicitar atendimento humano', async () => {
  assert.equal((await ensureOpenHumanTicket({ ...config, municipio: '7lagoas' }, phone))?.id, ticketId);
  assert.equal(db.tickets[0].status, 'pendente');
  assert.equal(db.audits[0][4], 'human_ticket_reopened');
});

test('solicitação humana reabre o mesmo ticket, preservando responsável e histórico', async () => {
  const existingMessage = ['history'];
  db.messages.push(existingMessage);
  assert.equal((await ensureOpenHumanTicket(config, phone))?.id, ticketId);
  assert.equal(db.tickets.length, 1);
  assert.equal(db.tickets[0].id, ticketId);
  assert.equal(db.tickets[0].status, 'pendente');
  assert.equal(db.tickets[0].assigned_attendant, 'Operador anterior');
  assert.equal(db.tickets[0].customer_name, 'Cliente de teste');
  assert.equal(db.tickets[0].updated_at, '2026-10-13 11:00:00');
  assert.deepEqual(db.messages, [existingMessage]);
  assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 1);
  assert.equal(db.audits[0][4], 'human_ticket_reopened');
  assert.equal(db.connections, db.releases);
});

test('duas solicitações humanas simultâneas reabrem uma única vez', async () => {
  const results = await Promise.all([
    ensureOpenHumanTicket(config, phone), ensureOpenHumanTicket(config, phone)
  ]);
  assert.deepEqual(results.map(result => result?.id), [ticketId, ticketId]);
  assert.equal(db.tickets.length, 1);
  assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 1);
  assert.equal(db.audits.length, 1);
  assert.equal(db.connections, db.releases);
});

test('solicitação humana reutiliza atendimento ativo sem reabrir um finalizado antigo', async () => {
  db.tickets = [ticket(), ticket({ id: 'active', status: 'pendente', created_at: '2026-10-12 10:00:00' })];
  assert.equal((await ensureOpenHumanTicket(config, phone))?.id, 'active');
  assert.equal(db.tickets[0].status, 'finalizado');
  assert.equal(db.tickets.length, 2);
  assert.equal(db.audits.length, 0);
});

test('nova solicitação após cancelamento cria outro ticket sem reabrir o histórico', async () => {
  db.tickets = [ticket(), ticket({ id: 'cancelled', status: 'cancelado', created_at: '2026-10-12 10:00:00' })];
  const created = await ensureOpenHumanTicket(config, phone, 'Novo cliente');
  assert.equal(created?.status, 'pendente');
  assert.equal(created?.customer_name, 'Novo cliente');
  assert.equal(created?.assigned_attendant, null);
  assert.equal(db.tickets.length, 3);
  assert.deepEqual(db.tickets.slice(0, 2).map(ticket => ticket.status), ['finalizado', 'cancelado']);
  assert.equal(db.audits.length, 0);
});

test('outras cidades criam novo atendimento em vez de reabrir o finalizado', async () => {
  const created = await ensureOpenHumanTicket({ ...config, municipio: 'formiga' }, phone);
  assert.notEqual(created?.id, ticketId);
  assert.equal(created?.status, 'pendente');
  assert.equal(db.tickets[0].status, 'finalizado');
  assert.equal(db.tickets.length, 2);
  assert.equal(db.connections, 0);
});

test('solicitação sem histórico cria ticket e reabertura preenche apenas nome ausente', async () => {
  db.tickets = [];
  assert.equal((await ensureOpenHumanTicket(config, phone, 'Cliente'))?.status, 'pendente');
  assert.equal(db.tickets.length, 1);
  db.tickets = [ticket({ customer_name: null })];
  assert.equal((await ensureOpenHumanTicket(config, phone, 'Cliente identificado'))?.customer_name, 'Cliente identificado');
  assert.equal(db.tickets[0].customer_name, 'Cliente identificado');
});

test('outras cidades e instâncias sem MUNICIPIO não reabrem tickets', async () => {
  for (const municipio of ['formiga', 'oliveira', 'itabira', undefined]) {
    assert.equal(await routeIncomingHumanMessage({ ...config, municipio }, phone), false);
    assert.equal(db.tickets[0].status, 'finalizado');
  }
  assert.equal(db.connections, 0);
  assert.equal(db.events.length, 0);
});

test('API habilita a busca melhorada somente para Sete Lagoas', async () => {
  for (const municipio of ['sete-lagoas', '7lagoas', 'formiga', undefined]) {
    const app = Fastify();
    try {
      await registerHumanRoutes(app, { ...config, municipio });
      const response = await app.inject({ method: 'GET', url: '/api/features' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().enhancedConversationSearch, municipio === 'sete-lagoas' || municipio === '7lagoas');
    } finally {
      await app.close();
    }
  }
});

test('não reabre cancelados nem um finalizado antigo quando o último foi cancelado', async () => {
  db.tickets = [ticket(), ticket({ id: 'newer', status: 'cancelado', created_at: '2026-10-12 10:00:00' })];
  assert.equal(await routeIncomingHumanMessage(config, phone), false);
  assert.deepEqual(db.tickets.map(t => t.status), ['finalizado', 'cancelado']);
});

test('não reabre outro ticket quando já há atendimento ativo', async () => {
  for (const status of ['pendente', 'em_atendimento'] as const) {
    db.tickets = [ticket({ status }), ticket({ id: 'newer', created_at: '2026-10-12 10:00:00' })];
    assert.equal(await routeIncomingHumanMessage(config, phone), true);
    assert.equal(db.tickets[1].status, 'finalizado');
  }
  assert.equal(db.events.length, 0);
});

test('cliente sem atendimento anterior segue o bot e não cria ticket', async () => {
  db.tickets = [];
  assert.equal(await routeIncomingHumanMessage(config, phone), false);
  assert.deepEqual(db.tickets, []);
});

test('falha na transação desfaz reabertura e libera a conexão', async () => {
  db.failReadAfterUpdate = true;
  await assert.rejects(reopenFinalizedHumanTicket(config, phone), /simulated database failure/);
  assert.equal(db.tickets[0].status, 'finalizado');
  assert.equal(db.rollbacks, 1);
  assert.equal(db.connections, db.releases);
  assert.equal(db.events.length, 0);
});

const providers = [
  {
    name: 'Z-API', register: registerZapiRoutes, url: '/webhook/zapi',
    payload: (id: string, media = false, text = 'oi') => ({ phone, fromMe: false, id,
      ...(media ? { image: { imageUrl: 'https://media.invalid/test.png' } } : { text: { message: text } }) })
  },
  {
    name: 'Evolution', register: registerEvolutionRoutes, url: '/webhook/evolution',
    payload: (id: string, media = false, text = 'oi') => ({ event: 'messages.upsert', data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id },
      messageType: media ? 'imageMessage' : 'conversation',
      message: media ? { imageMessage: { url: 'https://media.invalid/test.png' } } : { conversation: text }
    } })
  },
  {
    name: 'Meta', register: registerMetaRoutes, url: '/webhook/meta',
    payload: (id: string, media = false, text = 'oi') => ({ entry: [{ changes: [{ value: { messages: [{
      from: phone, id, type: media ? 'image' : 'text',
      ...(media ? { image: { id: 'media-test' } } : { text: { body: text } })
    }] } }] }] })
  }
];

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Webhook não completou o processamento esperado');
}

test('Z-API preserva o ID correto do botão quando o título contém os dígitos do telefone', async () => {
  db.tickets = [];
  let saved: any;
  mock.method(MemorySessionStore.prototype, 'getByPhone', async () => ({
    phone, updatedAt: new Date().toISOString(), state: {
      name: 'awaiting_identity_verification', idEletronico: '123@A', nomeCliente: 'Cliente',
      challenge: { field: 'phone', question: 'Selecione os 4 últimos dígitos do seu telefone:',
        correctId: 'ident_correct', options: [{ id: 'ident_correct', text: '1287' }, { id: 'ident_wrong_1', text: '6024' }] },
      secondaryChallenge: { field: 'nome', question: 'Selecione o primeiro nome do titular do cadastro:',
        correctId: 'ident_correct', options: [{ id: 'ident_correct', text: 'Cliente' }] },
      step: 'primary', attemptsLeft: 3
    }
  }));
  mock.method(MemorySessionStore.prototype, 'save', async (session: any) => { saved = session; });
  mock.method(ZapiClient.prototype, 'sendText', async () => {});
  mock.method(ZapiClient.prototype, 'sendButtonList', async () => {});
  const app = Fastify();
  try {
    await registerZapiRoutes(app, config);
    for (const [buttonId, expectedStep] of [['ident_correct', 'secondary'], [undefined, 'secondary'], ['ident_wrong_1', 'primary']] as const) {
      saved = undefined;
      const response = await app.inject({ method: 'POST', url: '/webhook/zapi', payload: {
        phone, id: `identity-button-${buttonId ?? 'label'}`, buttonsResponseMessage: { buttonId, text: '1287' }
      } });
      assert.equal(response.statusCode, 200);
      await waitUntil(() => Boolean(saved));
      assert.equal(saved.state.step, expectedStep);
      assert.equal(saved.state.challenge.field, expectedStep === 'secondary' ? 'nome' : 'phone');
      assert.equal(saved.state.attemptsLeft, expectedStep === 'secondary' ? 3 : 2);
    }
  } finally {
    await app.close();
  }
});

for (const provider of providers) {
  for (const media of [false, true]) {
    test(`${provider.name}: finalizar no painel e receber ${media ? 'imagem' : 'oi'} mantém finalizado e libera o bot`, async () => {
      const app = Fastify();
      try {
        await registerHumanRoutes(app, config);
        await provider.register(app, config);
        db.tickets[0].status = 'em_atendimento';
        const finalized = await app.inject({ method: 'PATCH', url: `/api/human-tickets/${ticketId}/status`, payload: { status: 'finalizado' } });
        assert.equal(finalized.statusCode, 200);
        assert.equal(finalized.json().ticket.status, 'finalizado');

        const response = await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('new-message', media) });
        assert.equal(response.statusCode, 200);
        await waitUntil(() => media ? db.messages.length === 1 : db.messages.length === 3);
        assert.equal(db.tickets[0].status, 'finalizado');
        assert.equal(db.tickets[0].id, ticketId);
        assert.equal(db.messages.length, media ? 1 : 3);
        assert.equal(db.messages[0][2], 'in');
        assert.deepEqual(db.outbound.map(out => out.message), media ? [] : [messages.welcome(config.entidadeNome), messages.askIdEletronico(false)]);
        assert.equal(db.audits.filter(a => a[4] === 'human_ticket_reopened').length, 0);
        assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 1);
      } finally {
        await app.close();
      }
    });
  }

  test(`${provider.name}: reentrega da mesma mensagem não reabre depois de nova finalização`, async () => {
    const app = Fastify();
    try {
      await provider.register(app, config);
      const payload = provider.payload('same-message', true);
      await app.inject({ method: 'POST', url: provider.url, payload });
      await waitUntil(() => db.messages.length === 1);
      await ensureOpenHumanTicket(config, phone);
      db.tickets[0].status = 'finalizado';
      await app.inject({ method: 'POST', url: provider.url, payload });
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(db.tickets[0].status, 'finalizado');
      assert.equal(db.messages.length, 1);
      assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 1);
    } finally {
      await app.close();
    }
  });

  test(`${provider.name}: oi após finalizar volta ao bot; opção 0 reabre e nova finalização libera novamente`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T12:00:00-03:00') });
    let session: any = { phone, state: { name: 'idle' }, updatedAt: new Date().toISOString() };
    mock.method(MemorySessionStore.prototype, 'getByPhone', async () => session);
    mock.method(MemorySessionStore.prototype, 'save', async (saved: any) => { session = saved; });
    const app = Fastify();
    try {
      const instance = { ...config, municipio: '7lagoas' };
      await registerHumanRoutes(app, instance);
      await provider.register(app, instance);
      await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('return-to-bot') });
      await waitUntil(() => db.messages.length === 3);
      assert.equal(db.tickets[0].status, 'finalizado');
      assert.equal(session.state.name, 'awaiting_login_id');

      // Representa o cliente identificado que escolhe "Falar com atendente" no menu.
      session.state = { name: 'main_menu', idEletronico: '123@A', nomeCliente: 'Cliente', imovelId: 123 };
      await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('human-request', false, '0') });
      await waitUntil(() => db.messages.length === 5);
      assert.equal(db.tickets[0].status, 'pendente');
      assert.equal(db.tickets.length, 1);
      assert.equal(db.tickets[0].id, ticketId);
      assert.equal(session.state.name, 'idle');
      assert.ok(db.outbound[2].message.includes(messages.humanContact));
      assert.equal(db.audits.filter(a => a[4] === 'human_ticket_reopened').length, 1);

      await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('while-pending') });
      await waitUntil(() => db.messages.length === 6);
      assert.equal(db.outbound.length, 3);
      const finalized = await app.inject({ method: 'PATCH', url: `/api/human-tickets/${ticketId}/status`, payload: { status: 'finalizado' } });
      assert.equal(finalized.statusCode, 200);
      // Reentregar a opção 0 antiga não deve reabrir o atendimento após finalizar.
      await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('human-request', false, '0') });
      await app.inject({ method: 'POST', url: provider.url, payload: provider.payload('return-again') });
      await waitUntil(() => db.messages.length === 9);
      assert.equal(db.tickets[0].status, 'finalizado');
      assert.equal(session.state.name, 'awaiting_login_id');
      assert.equal(db.outbound.length, 5);
    } finally {
      await app.close();
    }
  });
}

for (const authenticated of [false, true]) {
  test(`Evolution: opção 0 ${authenticated ? 'fora do horário' : 'sem identificação'} não reabre atendimento em 7lagoas`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(authenticated ? '2026-10-18T12:00:00-03:00' : '2026-10-14T12:00:00-03:00') });
    mock.method(MemorySessionStore.prototype, 'getByPhone', async () => ({ phone, updatedAt: new Date().toISOString(),
      state: authenticated ? { name: 'main_menu', idEletronico: '123@A', imovelId: 123 } : { name: 'idle' }
    }));
    const app = Fastify();
    try {
      await registerEvolutionRoutes(app, { ...config, municipio: '7lagoas' });
      await app.inject({ method: 'POST', url: '/webhook/evolution', payload: providers[1].payload('human-request', false, '0') });
      await waitUntil(() => db.outbound.length > 0);
      assert.equal(db.tickets[0].status, 'finalizado');
      assert.equal(db.tickets.length, 1);
      assert.equal(db.audits.filter(a => a[4] === 'human_ticket_reopened').length, 0);
      assert.ok(authenticated ? db.outbound[0].message.includes('Fora desse horário') : db.outbound[0].message === messages.welcome(config.entidadeNome));
    } finally {
      await app.close();
    }
  });
}

test('mensagens do próprio bot e callbacks de status não reabrem conversas', async () => {
  const zapiApp = Fastify();
  const evolutionApp = Fastify();
  const metaApp = Fastify();
  try {
    await registerZapiRoutes(zapiApp, config);
    await registerEvolutionRoutes(evolutionApp, config);
    await registerMetaRoutes(metaApp, config);
    await zapiApp.inject({ method: 'POST', url: '/webhook/zapi', payload: { ...providers[0].payload('outbound'), fromMe: true } });
    await zapiApp.inject({ method: 'POST', url: '/webhook/zapi', payload: { phone, id: 'status', status: 'DELIVERED' } });
    const evolution = providers[1].payload('outbound') as any;
    evolution.data.key.fromMe = true;
    await evolutionApp.inject({ method: 'POST', url: '/webhook/evolution', payload: evolution });
    await metaApp.inject({ method: 'POST', url: '/webhook/meta', payload: { entry: [{ changes: [{ value: { statuses: [{ id: 'sent', status: 'delivered' }] } }] }] } });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(db.connections, 0);
    assert.equal(db.tickets[0].status, 'finalizado');
    assert.equal(db.events.length, 0);
  } finally {
    await Promise.all([zapiApp.close(), evolutionApp.close(), metaApp.close()]);
  }
});
