import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppConfig } from '../src/config.js';
import { processMessage } from '../src/bot/flow.js';
import { mainMenu, messages } from '../src/bot/menus.js';
import { buildChallenges } from '../src/bot/identityChallenge.js';
import type { LinkDadosCadastrais } from '../src/company/linkApi.js';
import { MemorySessionStore } from '../src/state/memorySessionStore.js';
import type { ConversationState, IdentityChallengeState } from '../src/state/session.js';

const phone = '5531999999999';
const config = { municipio: 'sete-lagoas', entidadeNome: 'SAAE', sessionMaxInactivityMinutes: 60, sessionMaxAgeHours: 24 } as AppConfig;
const authenticated: ConversationState = {
  name: 'main_menu', idEletronico: '123@A', cpf: '12345678900', email: 'test@example.invalid',
  nomeCliente: 'Cliente', imovelId: 123, ligacaoId: '123', menuAudioPlayed: true
};

async function storeWith(state: ConversationState) {
  const store = new MemorySessionStore();
  await store.save({ phone, state, updatedAt: new Date().toISOString() });
  return store;
}

test('menu de Sete Lagoas exibe 6 Finalizar sessão em todos os retornos', async () => {
  const store = await storeWith(authenticated);
  for (const command of ['menu', 'invalid-option', '1']) {
    const replies = await processMessage(config, phone, command, store);
    const list = replies.find(reply => typeof reply !== 'string' && reply.type === 'list') as any;
    assert.ok(list);
    const rows = list.sections.flatMap((section: any) => section.rows);
    assert.deepEqual(rows.map((row: any) => row.id), ['1', '2', '3', '4', '5', '6', '0']);
    assert.equal(rows.find((row: any) => row.id === '6').title, '6️⃣ Finalizar sessão');
  }
  assert.match(mainMenu(true), /6️⃣ Finalizar sessão/);
  assert.doesNotMatch(mainMenu(), /Finalizar sessão/);
});

test('finalizar sessão limpa os dados do imóvel e pede uma nova identificação', async () => {
  for (const command of ['6', 'Finalizar sessão', '6️⃣ Finalizar sessão']) {
    const store = await storeWith(authenticated);
    const replies = await processMessage(config, phone, command, store);
    assert.ok(replies.some(reply => typeof reply === 'string' && reply.includes('Atendimento encerrado')));
    assert.ok(replies.includes(messages.askIdEletronico(false)));
    assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'awaiting_login_id' });
  }
});

test('outras cidades mantêm o menu e a opção 6 não encerra sessão', async () => {
  for (const municipio of ['formiga', 'oliveira', undefined]) {
    const store = await storeWith(authenticated);
    const replies = await processMessage({ ...config, municipio }, phone, '6', store);
    assert.equal((await store.getByPhone(phone))?.state.name, 'main_menu');
    const list = replies.find(reply => typeof reply !== 'string' && reply.type === 'list') as any;
    assert.ok(list.sections.every((section: any) => section.rows.every((row: any) => row.id !== '6')));
  }
});

function verification(challenge: IdentityChallengeState): ConversationState {
  return { name: 'awaiting_identity_verification', idEletronico: '123@A', imovelId: 123,
    nomeCliente: 'Cliente', challenge, step: 'primary', attemptsLeft: 2 };
}
const cpfChallenge: IdentityChallengeState = {
  field: 'cpf', question: 'Selecione os 4 últimos dígitos do seu CPF:', correctId: 'ident_correct',
  options: [{ id: 'ident_correct', text: '8900' }, { id: 'ident_wrong_1', text: '0000' }]
};

test('primeiro erro no CPF orienta LGPD e SAC 115 e encerra a validação', async () => {
  for (const field of ['cpf', undefined] as const) {
    const store = await storeWith(verification({ ...cpfChallenge, field }));
    const replies = await processMessage(config, phone, 'ident_wrong_1', store);
    assert.deepEqual(replies, [messages.identityCpfFailed]);
    assert.match(replies[0] as string, /LGPD/);
    assert.match(replies[0] as string, /SAC: 115/);
    assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'idle' });
  }
});

test('CPF correto segue a próxima confirmação', async () => {
  const secondary: IdentityChallengeState = { ...cpfChallenge, field: 'bairro', question: 'Selecione o bairro do seu imóvel:' };
  const state = { ...verification(cpfChallenge), secondaryChallenge: secondary } as ConversationState;
  const store = await storeWith(state);
  const replies = await processMessage(config, phone, 'ident_correct', store);
  assert.ok(replies.includes('Correto! Mais uma confirmação:'));
  const saved = (await store.getByPhone(phone))?.state as any;
  assert.equal(saved.name, 'awaiting_identity_verification');
  assert.equal(saved.step, 'secondary');
  assert.equal(saved.challenge.field, 'bairro');
});

test('erros em outras perguntas e em outras cidades mantêm as tentativas existentes', async () => {
  for (const [instance, challenge] of [
    [config, { ...cpfChallenge, field: 'bairro', question: 'Selecione o bairro do seu imóvel:' }],
    [{ ...config, municipio: 'formiga' }, cpfChallenge]
  ] as const) {
    const store = await storeWith(verification(challenge));
    const replies = await processMessage(instance, phone, 'ident_wrong_1', store);
    assert.ok(replies.includes('Resposta incorreta. Tente novamente:'));
    const saved = (await store.getByPhone(phone))?.state as any;
    assert.equal(saved.name, 'awaiting_identity_verification');
    assert.equal(saved.attemptsLeft, 1);
    assert.ok(!replies.includes(messages.identityCpfFailed));
  }
});

test('geração de desafios identifica o campo CPF', () => {
  const challenges = buildChallenges({ CPF: '12345678900', Nome: 'Cliente' } as LinkDadosCadastrais);
  assert.equal(challenges?.primary.field, 'cpf');
  assert.equal(challenges?.secondary?.field, 'nome');
});
