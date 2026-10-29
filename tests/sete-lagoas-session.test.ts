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

test('7lagoas habilita finalizar sessão e a orientação LGPD/SAC 115', async () => {
  const instance = { ...config, municipio: '7lagoas' };
  const store = await storeWith(authenticated);
  const replies = await processMessage(instance, phone, 'menu', store);
  const list = replies.find(reply => typeof reply !== 'string' && reply.type === 'list') as any;
  assert.ok(list.sections.some((section: any) => section.rows.some((row: any) => row.id === '6')));
  await processMessage(instance, phone, '6', store);
  assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'awaiting_login_id' });
  await store.save({ phone, state: verification(cpfChallenge), updatedAt: new Date().toISOString() });
  const first = await processMessage(instance, phone, 'ident_wrong_1', store);
  assert.ok(first.includes('Resposta incorreta. Tente novamente:'));
  assert.ok(!first.includes(messages.identityVerificationFailed));
  assert.ok((await processMessage(instance, phone, 'ident_wrong_1', store)).includes('Resposta incorreta. Tente novamente:'));
  assert.deepEqual(await processMessage(instance, phone, 'ident_wrong_1', store), [messages.identityVerificationFailed]);
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

function verification(challenge: IdentityChallengeState, attemptsLeft = 3): ConversationState {
  return { name: 'awaiting_identity_verification', idEletronico: '123@A', imovelId: 123,
    nomeCliente: 'Cliente', challenge, step: 'primary', attemptsLeft };
}
const cpfChallenge: IdentityChallengeState = {
  field: 'cpf', question: 'Selecione os 4 últimos dígitos do seu CPF:', correctId: 'ident_correct',
  options: [{ id: 'ident_correct', text: '8900' }, { id: 'ident_wrong_1', text: '0000' }]
};

test('CPF permite dois erros e orienta LGPD/SAC 115 apenas no terceiro erro', async () => {
  for (const municipio of ['sete-lagoas', '7lagoas']) {
    for (const field of ['cpf', undefined] as const) {
      const instance = { ...config, municipio };
      const challenge = { ...cpfChallenge, field };
      const initial = verification(challenge);
      const store = await storeWith(initial);
      const first = await processMessage(instance, phone, 'ident_wrong_1', store);
      assert.equal(first[0], 'Resposta incorreta. Tente novamente:');
      assert.ok(!first.includes(messages.identityVerificationFailed));
      assert.deepEqual((await store.getByPhone(phone))?.state, { ...initial, attemptsLeft: 2 });
      const buttons = first.find(reply => typeof reply !== 'string' && reply.type === 'buttons') as any;
      assert.equal(buttons.text, challenge.question);
      assert.deepEqual(buttons.buttons, challenge.options.map(option => ({ id: option.id, text: option.text })));
      const second = await processMessage(instance, phone, 'ident_wrong_1', store);
      assert.equal(second[0], 'Resposta incorreta. Tente novamente:');
      assert.ok(!second.includes(messages.identityVerificationFailed));
      assert.deepEqual((await store.getByPhone(phone))?.state, { ...initial, attemptsLeft: 1 });
      const third = await processMessage(instance, phone, 'ident_wrong_1', store);
      assert.deepEqual(third, [messages.identityVerificationFailed]);
      assert.match(third[0] as string, /LGPD/);
      assert.match(third[0] as string, /2106-0100 e nos fins de semana através do SAC pelo número 115\./);
      assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'idle' });
    }
  }
});

test('CPF correto na terceira tentativa segue a próxima confirmação com três tentativas', async () => {
  const secondary: IdentityChallengeState = { ...cpfChallenge, field: 'nome', question: 'Selecione o primeiro nome do titular:' };
  const store = await storeWith({ ...verification(cpfChallenge), secondaryChallenge: secondary } as ConversationState);
  await processMessage(config, phone, 'ident_wrong_1', store);
  await processMessage(config, phone, 'ident_wrong_1', store);
  const replies = await processMessage(config, phone, 'ident_correct', store);
  assert.ok(replies.includes('Correto! Mais uma confirmação:'));
  assert.ok(!replies.includes(messages.identityVerificationFailed));
  const saved = (await store.getByPhone(phone))?.state as any;
  assert.equal(saved.step, 'secondary');
  assert.equal(saved.challenge.field, 'nome');
  assert.equal(saved.attemptsLeft, 3);
});

test('confirmação de CPF na etapa secundária também permite três tentativas', async () => {
  const store = await storeWith({ ...verification(cpfChallenge), step: 'secondary' } as ConversationState);
  const first = await processMessage(config, phone, 'ident_wrong_1', store);
  assert.ok(first.includes('Resposta incorreta. Tente novamente:'));
  assert.equal(((await store.getByPhone(phone))?.state as any).step, 'secondary');
  assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 2);
  assert.ok((await processMessage(config, phone, 'ident_wrong_1', store)).includes('Resposta incorreta. Tente novamente:'));
  assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 1);
  assert.deepEqual(await processMessage(config, phone, 'ident_wrong_1', store), [messages.identityVerificationFailed]);
  assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'idle' });
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

test('primeiro erro preserva a validação, com três tentativas em Sete Lagoas e duas nas demais cidades', async () => {
  for (const [instance, challenge] of [
    [config, { ...cpfChallenge, field: 'bairro', question: 'Selecione o bairro do seu imóvel:' }],
    [{ ...config, municipio: 'formiga' }, cpfChallenge]
  ] as const) {
    const initialAttempts = instance.municipio === 'sete-lagoas' ? 3 : 2;
    const store = await storeWith(verification(challenge, initialAttempts));
    const replies = await processMessage(instance, phone, 'ident_wrong_1', store);
    assert.ok(replies.includes('Resposta incorreta. Tente novamente:'));
    const saved = (await store.getByPhone(phone))?.state as any;
    assert.equal(saved.name, 'awaiting_identity_verification');
    assert.equal(saved.attemptsLeft, initialAttempts - 1);
    assert.ok(!replies.includes(messages.identityVerificationFailed));
  }
});

test('geração de desafios identifica o campo CPF', () => {
  const challenges = buildChallenges({ CPF: '12345678900', Nome: 'Cliente' } as LinkDadosCadastrais);
  assert.equal(challenges?.primary.field, 'cpf');
  assert.equal(challenges?.secondary?.field, 'nome');
});

test('telefone, email, bairro e nome orientam LGPD e SAC 115 ao esgotar as tentativas', async () => {
  for (const field of ['phone', 'email', 'bairro', 'nome', undefined] as const) {
    const challenge = { ...cpfChallenge, field, question: 'Selecione uma informação do cadastro:' };
    const store = await storeWith(verification(challenge));
    const first = await processMessage(config, phone, 'ident_wrong_1', store);
    assert.ok(first.includes('Resposta incorreta. Tente novamente:'));
    assert.ok(!first.includes(messages.identityVerificationFailed));
    assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 2);
    const second = await processMessage(config, phone, 'ident_wrong_1', store);
    assert.ok(second.includes('Resposta incorreta. Tente novamente:'));
    assert.ok(!second.includes(messages.identityVerificationFailed));
    assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 1);
    assert.deepEqual(await processMessage(config, phone, 'ident_wrong_1', store), [messages.identityVerificationFailed]);
    assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'idle' });
  }
});

test('rótulo e número do fallback identificam a opção correta em Sete Lagoas', async () => {
  const challenge: IdentityChallengeState = {
    field: 'phone', question: 'Selecione os 4 últimos dígitos do seu telefone:', correctId: 'ident_correct',
    options: [{ id: 'ident_wrong_1', text: '6024' }, { id: 'ident_correct', text: '1287' }, { id: 'ident_wrong_2', text: '4413' }]
  };
  const secondary: IdentityChallengeState = { ...cpfChallenge, field: 'nome', question: 'Selecione o nome do titular:' };
  for (const input of ['ident_correct', '1287', '2']) {
    const store = await storeWith({ ...verification(challenge), secondaryChallenge: secondary } as ConversationState);
    const replies = await processMessage(config, phone, input, store);
    assert.ok(replies.includes('Correto! Mais uma confirmação:'));
    const saved = (await store.getByPhone(phone))?.state as any;
    assert.equal(saved.step, 'secondary');
    assert.equal(saved.challenge.field, 'nome');
  }
  for (const input of ['ident_wrong_1', '6024', '1', '9999']) {
    const store = await storeWith(verification(challenge));
    const replies = await processMessage(config, phone, input, store);
    assert.ok(replies.includes('Resposta incorreta. Tente novamente:'));
    assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 2);
  }
});

test('rótulos ambíguos não são aceitos como resposta correta', async () => {
  const challenge: IdentityChallengeState = { ...cpfChallenge, field: 'phone', question: 'Selecione seu telefone:',
    options: [{ id: 'ident_correct', text: '1287' }, { id: 'ident_wrong_1', text: '1287' }] };
  const store = await storeWith(verification(challenge));
  const replies = await processMessage(config, phone, '1287', store);
  assert.ok(replies.includes('Resposta incorreta. Tente novamente:'));
  assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 2);
});

test('outras cidades mantêm a mensagem anterior ao esgotar tentativas', async () => {
  for (const municipio of ['formiga', 'oliveira', undefined]) {
    const challenge = { ...cpfChallenge, field: 'phone' as const, question: 'Selecione seu telefone:' };
    const store = await storeWith(verification(challenge, 2));
    await processMessage({ ...config, municipio }, phone, 'ident_wrong_1', store);
    const replies = await processMessage({ ...config, municipio }, phone, 'ident_wrong_1', store);
    assert.deepEqual(replies, ['Não foi possível verificar sua identidade. Por segurança, o atendimento foi encerrado.']);
    assert.deepEqual((await store.getByPhone(phone))?.state, { name: 'idle' });
  }
});

test('sessão sem contador usa três tentativas apenas em Sete Lagoas', async () => {
  for (const municipio of ['sete-lagoas', '7lagoas', 'formiga', undefined]) {
    const initial = verification(cpfChallenge) as any;
    delete initial.attemptsLeft;
    const store = await storeWith(initial);
    const replies = await processMessage({ ...config, municipio }, phone, 'ident_wrong_1', store);
    assert.ok(replies.includes('Resposta incorreta. Tente novamente:'));
    assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, municipio === 'sete-lagoas' || municipio === '7lagoas' ? 2 : 1);
  }
});

test('confirmação secundária mantém duas tentativas nas demais cidades', async () => {
  const secondary: IdentityChallengeState = { ...cpfChallenge, field: 'nome', question: 'Selecione o nome:' };
  const store = await storeWith({ ...verification(cpfChallenge, 2), secondaryChallenge: secondary } as ConversationState);
  await processMessage({ ...config, municipio: 'formiga' }, phone, 'ident_correct', store);
  assert.equal(((await store.getByPhone(phone))?.state as any).attemptsLeft, 2);
});
