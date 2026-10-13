import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const context: any = {};
runInNewContext(readFileSync(new URL('../painel-atendimento/conversation-search.js', import.meta.url), 'utf8'), context);
const { matches, formatPhone } = context.ConversationSearch;
const customer = { customer_name: 'José Carlos da Silva', phone: '5531988887777' };

test('nome aceita acentos, maiúsculas, espaços extras e partes do nome', () => {
  for (const query of ['José', 'JOSE', '  jose   silva ', 'Silva José', 'carl']) {
    assert.equal(matches(customer, query), true, query);
  }
  assert.equal(matches(customer, 'Maria'), false);
  assert.equal(matches(customer, 'Jose Souza'), false);
  assert.equal(matches({ customer_name: 'Maria D’Ávila' }, "maria d'avila"), true);
});

test('telefone aceita formatação, código 55, DDD e somente o número local', () => {
  for (const query of ['+55 (31) 98888-7777', '5531988887777', '(31) 98888-7777', '31 98888 7777', '31988887777', '98888-7777', '7777', '５５３１９８８８８７７７７', '(31) 98888–7777', '(31) 98888‑7777']) {
    assert.equal(matches(customer, query), true, query);
  }
  assert.equal(matches(customer, '(11) 98888-7777'), false);
  assert.equal(matches(customer, '98888-6666'), false);
});

test('telefone armazenado com máscara também é encontrado por dígitos', () => {
  const formatted = { ...customer, phone: '+55 (31) 98888-7777' };
  assert.equal(matches(formatted, '31988887777'), true);
  assert.equal(matches(formatted, '5531988887777'), true);
});

test('celular com ou sem nono dígito funciona nos dois sentidos', () => {
  for (const query of ['(31) 8888-7777', '553188887777', '8888-7777']) {
    assert.equal(matches(customer, query), true, query);
  }
  const old = { ...customer, phone: '553188887777' };
  assert.equal(matches(old, '(31) 98888-7777'), true);
  assert.equal(matches(old, '98888-7777'), true);
});

test('não remove DDD 55 nem cria nono dígito em telefone fixo', () => {
  const otherDdd = { phone: '55988887777' };
  assert.equal(matches(otherDdd, '(55) 98888-7777'), true);
  assert.equal(matches(otherDdd, '+55 (55) 98888-7777'), true);
  const landline = { phone: '553137771234' };
  assert.equal(matches(landline, '(31) 3777-1234'), true);
  assert.equal(matches(landline, '(31) 93777-1234'), false);
});

test('consulta vazia mostra todos; pontuação e dados ausentes não retornam todos', () => {
  assert.equal(matches({}, ''), true);
  assert.equal(matches({}, '   '), true);
  assert.equal(matches(customer, '+()-'), false);
  assert.equal(matches({}, '7777'), false);
  assert.equal(matches({}, 'Jose'), false);
  assert.equal(matches({ customer_name: 'José 115' }, '115'), false);
});

test('exibição padroniza celular e telefone fixo sem alterar o valor original', () => {
  assert.equal(formatPhone(customer.phone), '(31) 98888-7777');
  assert.equal(formatPhone('553137771234'), '(31) 3777-1234');
  assert.equal(formatPhone('55988887777'), '(55) 98888-7777');
  assert.equal(formatPhone('88887777'), '8888-7777');
  assert.equal(formatPhone('988887777'), '98888-7777');
  assert.equal(formatPhone(''), 'Sem telefone');
  assert.equal(customer.phone, '5531988887777');
});
