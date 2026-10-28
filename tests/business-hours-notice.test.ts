import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, type AppConfig } from '../src/config.js';
import { isWithinBusinessHours, businessHoursMessage } from '../src/bot/businessHours.js';

const base = { municipio: 'sabinopolis', businessDayStart: 1, businessDayEnd: 5,
  businessHoursStart: '08:00', businessHoursEnd: '16:15' } as AppConfig;

// 10:00 em Brasília (UTC-3)
const at = (day: string) => new Date(`${day}T13:00:00Z`);

function loadWithEnvironment(overrides: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = {
    MUNICIPIO: 'sabinopolis', DB_SERVER: 'test', DB_USER: 'test', DB_PASSWORD: 'test',
    DB_DATABASE: 'test', ZAPI_BASE_URL: 'https://whatsapp.invalid', ZAPI_INSTANCE_ID: 'test', ZAPI_TOKEN: 'test',
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

test('mensagem personalizada substitui o texto padrão e converte \\n do .env', () => {
  const loaded = loadWithEnvironment({
    BUSINESS_HOURS_MESSAGE: 'Linha 1.\\n\\nLinha 2.',
    BUSINESS_HOURS_NOTICE: undefined, BUSINESS_HOURS_NOTICE_UNTIL: undefined
  });
  assert.equal(businessHoursMessage(loaded), 'Linha 1.\n\nLinha 2.');
});

test('aviso aparece até a data limite (inclusive) e some depois', () => {
  const config = { ...base, businessHoursMessage: 'Horário.', businessHoursNotice: 'Aviso.',
    businessHoursNoticeUntil: '2026-11-02' } as AppConfig;
  assert.equal(businessHoursMessage(config, at('2026-10-28')), 'Horário.\n\nAviso.');
  assert.equal(businessHoursMessage(config, new Date('2026-11-03T02:59:00Z')), 'Horário.\n\nAviso.');
  assert.equal(businessHoursMessage(config, new Date('2026-11-03T03:00:00Z')), 'Horário.');
});

test('sem mensagem personalizada o aviso é somado ao texto padrão', () => {
  const config = { ...base, businessHoursNotice: 'Aviso.' } as AppConfig;
  const message = businessHoursMessage(config, at('2026-10-28'));
  assert.match(message, /^⏰ Nosso atendimento humano funciona/);
  assert.match(message, /\n\nAviso\.$/);
});

test('dias sem expediente bloqueiam o atendimento humano mesmo no horário comercial', () => {
  const config = { ...base, businessClosedFrom: '2026-10-30', businessClosedUntil: '2026-10-30' } as AppConfig;
  assert.equal(isWithinBusinessHours(config, at('2026-10-29')), true);
  assert.equal(isWithinBusinessHours(config, at('2026-10-30')), false);
  assert.equal(isWithinBusinessHours(config, at('2026-11-03')), true);
});

test('BUSINESS_CLOSED_UNTIL vazio considera apenas o dia de BUSINESS_CLOSED_FROM', () => {
  const loaded = loadWithEnvironment({ BUSINESS_CLOSED_FROM: '2026-10-30', BUSINESS_CLOSED_UNTIL: undefined });
  assert.equal(loaded.businessClosedUntil, '2026-10-30');
});

test('datas fora do formato AAAA-MM-DD são rejeitadas', () => {
  assert.throws(() => loadWithEnvironment({ BUSINESS_HOURS_NOTICE_UNTIL: '02/11/2026' }), /AAAA-MM-DD/);
});
