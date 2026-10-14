import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, type AppConfig } from '../src/config.js';
import { isWithinBusinessHours, businessHoursMessage } from '../src/bot/businessHours.js';
import { processMessage } from '../src/bot/flow.js';
import { MemorySessionStore } from '../src/state/memorySessionStore.js';

const config = { municipio: 'sete-lagoas', businessDayStart: 1, businessDayEnd: 5,
  businessHoursStart: '08:00', businessHoursEnd: '16:30',
  businessSaturdayEnabled: true, businessSaturdayStart: '07:00', businessSaturdayEnd: '18:30' } as AppConfig;

function loadWithEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    MUNICIPIO: 'sete-lagoas', DB_SERVER: 'test', DB_USER: 'test', DB_PASSWORD: 'test',
    DB_DATABASE: 'test', ZAPI_BASE_URL: 'https://whatsapp.invalid', ZAPI_INSTANCE_ID: 'test', ZAPI_TOKEN: 'test',
    BUSINESS_DAY_START: undefined, BUSINESS_DAY_END: undefined,
    BUSINESS_HOURS_START: undefined, BUSINESS_HOURS_END: undefined,
    BUSINESS_SATURDAY_ENABLED: undefined, BUSINESS_SATURDAY_START: undefined, BUSINESS_SATURDAY_END: undefined,
    ...overrides
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return loadConfig();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('ambiente de Sete Lagoas tem os horários solicitados como padrão', () => {
  const loaded = loadWithEnvironment();
  assert.equal(loaded.businessHoursStart, '08:00');
  assert.equal(loaded.businessHoursEnd, '16:30');
  assert.equal(loaded.businessSaturdayEnabled, true);
  assert.equal(loaded.businessSaturdayStart, '07:00');
  assert.equal(loaded.businessSaturdayEnd, '18:30');
});

test('7lagoas mantém o identificador existente e ativa os mesmos horários e mensagem', () => {
  const loaded = loadWithEnvironment({ MUNICIPIO: ' 7LAGOAS ' });
  assert.equal(loaded.municipio, '7lagoas');
  assert.equal(loaded.businessHoursEnd, '16:30');
  assert.equal(loaded.businessSaturdayEnabled, true);
  assert.equal(loaded.businessSaturdayStart, '07:00');
  assert.equal(loaded.businessSaturdayEnd, '18:30');
  assert.equal(businessHoursMessage(loaded), businessHoursMessage(loadWithEnvironment()));
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-17T12:00:00-03:00')), true);
});

test('alterar o ambiente muda os horários reais e a mensagem, inclusive sábado', () => {
  const loaded = loadWithEnvironment({ BUSINESS_HOURS_START: '09:00', BUSINESS_HOURS_END: '15:00',
    BUSINESS_SATURDAY_START: '10:00', BUSINESS_SATURDAY_END: '12:00' });
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-13T08:30:00-03:00')), false);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-13T09:00:00-03:00')), true);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-13T15:00:00-03:00')), false);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-17T09:30:00-03:00')), false);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-17T10:00:00-03:00')), true);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-17T12:00:00-03:00')), false);
  assert.match(businessHoursMessage(loaded), /09:00.*15:00.*sábados.*10:00.*12:00/);
});

test('sábado pode ser desabilitado pelo ambiente e desaparece da mensagem', () => {
  const loaded = loadWithEnvironment({ BUSINESS_SATURDAY_ENABLED: 'false' });
  assert.equal(loaded.businessSaturdayEnabled, false);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-17T12:00:00-03:00')), false);
  assert.doesNotMatch(businessHoursMessage(loaded), /sábados/);
});

test('dias úteis configurados restringem a regra e atualizam a mensagem', () => {
  const loaded = loadWithEnvironment({ BUSINESS_DAY_START: '2', BUSINESS_DAY_END: '4' });
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-12T12:00:00-03:00')), false);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-13T12:00:00-03:00')), true);
  assert.equal(isWithinBusinessHours(loaded, new Date('2026-10-16T12:00:00-03:00')), false);
  assert.match(businessHoursMessage(loaded), /terça a quinta/);
});

test('horários e dias inválidos de Sete Lagoas falham antes de iniciar o servidor', () => {
  for (const override of [
    { BUSINESS_HOURS_START: '25:00' }, { BUSINESS_HOURS_END: '07:00' },
    { BUSINESS_SATURDAY_END: '06:00' }, { BUSINESS_SATURDAY_ENABLED: 'maybe' },
    { BUSINESS_DAY_START: '0' }, { BUSINESS_DAY_END: '6' }, { BUSINESS_DAY_START: '4', BUSINESS_DAY_END: '2' }
  ]) {
    assert.throws(() => loadWithEnvironment(override), /BUSINESS_/);
  }
});

test('segunda a sexta abre às 08:00 e fecha às 16:30 no horário de Brasília', () => {
  for (const day of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
    for (const [time, expected] of [['07:59', false], ['08:00', true], ['16:29', true], ['16:30', false], ['17:00', false]] as const) {
      assert.equal(isWithinBusinessHours(config, new Date(`${day}T${time}:00-03:00`)), expected, `${day} ${time}`);
    }
  }
});

test('sábado abre às 07:00 e fecha às 18:30; domingo permanece fechado', () => {
  for (const [time, expected] of [['06:59', false], ['07:00', true], ['18:29', true], ['18:30', false]] as const) {
    assert.equal(isWithinBusinessHours(config, new Date(`2026-10-17T${time}:00-03:00`)), expected, time);
  }
  assert.equal(isWithinBusinessHours(config, new Date('2026-10-18T12:00:00-03:00')), false);
});

test('regra usa Brasília mesmo quando a data é fornecida em UTC', () => {
  assert.equal(isWithinBusinessHours(config, new Date('2026-10-17T09:59:00Z')), false);
  assert.equal(isWithinBusinessHours(config, new Date('2026-10-17T10:00:00Z')), true);
  assert.equal(isWithinBusinessHours(config, new Date('2026-10-17T21:30:00Z')), false);
});

test('mensagem informa os mesmos horários usados pela regra', () => {
  const message = businessHoursMessage(config);
  assert.match(message, /segunda a sexta-feira/);
  assert.match(message, /08:00.*16:30/);
  assert.match(message, /sábados.*07:00.*18:30/);
  assert.match(message, /outras opções do menu/);
});

test('outras cidades mantêm horários configurados e a mensagem anterior', () => {
  for (const municipio of ['formiga', 'oliveira', undefined]) {
    const instance = loadWithEnvironment({ MUNICIPIO: municipio, BUSINESS_SATURDAY_ENABLED: 'true' });
    assert.equal(isWithinBusinessHours(instance, new Date('2026-10-13T17:00:00-03:00')), true);
    assert.equal(isWithinBusinessHours(instance, new Date('2026-10-17T12:00:00-03:00')), false);
    assert.match(businessHoursMessage(instance), /segunda a sexta.*08:00.*18:00/);
    assert.doesNotMatch(businessHoursMessage(instance), /sábados/);
  }
});

test('fluxo do bot fora do horário mostra a mensagem e mantém o autoatendimento', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T12:00:00-03:00') });
  const phone = '5531999999999';
  const store = new MemorySessionStore();
  await store.save({ phone, state: { name: 'main_menu', idEletronico: '123@A' }, updatedAt: new Date().toISOString() });
  const replies = await processMessage(config, phone, '0', store);
  assert.ok(replies.includes(businessHoursMessage(config)));
  assert.equal((await store.getByPhone(phone))?.state.name, 'main_menu');
});
