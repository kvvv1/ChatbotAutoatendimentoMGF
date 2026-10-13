import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import Fastify from 'fastify';
import mysql from 'mysql2/promise';
import type { AppConfig } from '../src/config.js';
import { isSeteLagoas, loadConfig } from '../src/config.js';
import { closeDb } from '../src/supabase/client.js';
import { reopenFinalizedHumanTicket, type HumanTicket } from '../src/supabase/humanTickets.js';
import { routeIncomingHumanMessage } from '../src/human/incoming.js';
import { subscribeHumanEvents, type HumanRealtimeEvent } from '../src/human/events.js';
import { registerHumanRoutes } from '../src/human/routes.js';
import { registerZapiRoutes } from '../src/zapi/webhook.js';
import { registerEvolutionRoutes } from '../src/evolution/webhook.js';
import { registerMetaRoutes } from '../src/meta/webhook.js';

const phone = '5531999999999';
const ticketId = 'a39d1138-3667-4da4-b58c-75ae878dc2ba';
const config = {
  municipio: 'sete-lagoas',
  zapiBaseUrl: 'https://whatsapp.invalid',
  zapiInstanceId: 'test-instance',
  zapiToken: 'test-token'
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
      const rows = this.tickets.filter(t => t.phone === values[0])
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
  unsubscribe = subscribeHumanEvents(event => db.events.push(event));
});
afterEach(async () => {
  unsubscribe();
  await closeDb();
  mock.restoreAll();
});

test('MUNICIPIO é carregado e somente sete-lagoas habilita a regra', () => {
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
    assert.equal(isSeteLagoas({ ...loaded, municipio: 'formiga' }), false);
    assert.equal(isSeteLagoas({ ...loaded, municipio: undefined }), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('reabre o mesmo ticket como pendente, preservando responsável e histórico', async () => {
  const existingMessage = ['history'];
  db.messages.push(existingMessage);
  assert.equal(await routeIncomingHumanMessage(config, phone), true);
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

test('duas mensagens simultâneas reabrem uma única vez', async () => {
  const results = await Promise.all([
    routeIncomingHumanMessage(config, phone), routeIncomingHumanMessage(config, phone)
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 1);
  assert.equal(db.audits.length, 1);
  assert.equal(db.connections, db.releases);
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
  for (const municipio of ['sete-lagoas', 'formiga', undefined]) {
    const app = Fastify();
    try {
      await registerHumanRoutes(app, { ...config, municipio });
      const response = await app.inject({ method: 'GET', url: '/api/features' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().enhancedConversationSearch, municipio === 'sete-lagoas');
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
    payload: (id: string, media = false) => ({ phone, fromMe: false, id,
      ...(media ? { image: { imageUrl: 'https://media.invalid/test.png' } } : { text: { message: 'Voltei para o atendimento' } }) })
  },
  {
    name: 'Evolution', register: registerEvolutionRoutes, url: '/webhook/evolution',
    payload: (id: string, media = false) => ({ event: 'messages.upsert', data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id },
      messageType: media ? 'imageMessage' : 'conversation',
      message: media ? { imageMessage: { url: 'https://media.invalid/test.png' } } : { conversation: 'Voltei para o atendimento' }
    } })
  },
  {
    name: 'Meta', register: registerMetaRoutes, url: '/webhook/meta',
    payload: (id: string, media = false) => ({ entry: [{ changes: [{ value: { messages: [{
      from: phone, id, type: media ? 'image' : 'text',
      ...(media ? { image: { id: 'media-test' } } : { text: { body: 'Voltei para o atendimento' } })
    }] } }] }] })
  }
];

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Webhook não completou o processamento esperado');
}

for (const provider of providers) {
  for (const media of [false, true]) {
    test(`${provider.name}: finalizar no painel e receber ${media ? 'imagem' : 'texto'} reabre como pendente`, async () => {
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
        await waitUntil(() => db.audits.some(a => a[4] === 'human_ticket_reopened'));
        assert.equal(db.tickets[0].status, 'pendente');
        assert.equal(db.tickets[0].id, ticketId);
        assert.equal(db.messages.length, 1);
        assert.equal(db.messages[0][2], 'in');
        assert.equal(db.events.filter(e => e.type === 'ticket_update').length, 2);
      } finally {
        await app.close();
      }
    });
  }

  test(`${provider.name}: reentrega da mesma mensagem não reabre depois de nova finalização`, async () => {
    const app = Fastify();
    try {
      await provider.register(app, config);
      const payload = provider.payload('same-message');
      await app.inject({ method: 'POST', url: provider.url, payload });
      await waitUntil(() => db.audits.some(a => a[4] === 'human_ticket_reopened'));
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
