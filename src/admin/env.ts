import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import type { Instance } from './instances.js';

type FieldStatus = 'ok' | 'missing' | 'empty' | 'not_configured';

export type EnvField = {
  key: string;
  value: string | null;
  status: FieldStatus;
  required: boolean;
  group: string;
  sensitive: boolean;
};

export type EnvReport = {
  slug: string;
  envFile: string;
  totalFields: number;
  okCount: number;
  missingCount: number;
  emptyCount: number;
  fields: EnvField[];
};

const SCHEMA: Array<{ key: string; required: boolean; group: string; sensitive?: boolean }> = [
  // Servidor
  { key: 'PORT', required: true, group: 'Servidor' },
  { key: 'MUNICIPIO', required: true, group: 'Servidor' },
  { key: 'ENTIDADE_NOME', required: true, group: 'Servidor' },
  { key: 'ENTIDADE_NOME_COMPLETO', required: false, group: 'Servidor' },
  { key: 'ENTIDADE_PHONE_NUMBER', required: false, group: 'Servidor' },
  // Banco de dados
  { key: 'DB_SERVER', required: true, group: 'Banco de Dados' },
  { key: 'DB_PORT', required: false, group: 'Banco de Dados' },
  { key: 'DB_USER', required: true, group: 'Banco de Dados' },
  { key: 'DB_PASSWORD', required: true, group: 'Banco de Dados', sensitive: true },
  { key: 'DB_DATABASE', required: true, group: 'Banco de Dados' },
  // Z-API
  { key: 'ZAPI_BASE_URL', required: true, group: 'Z-API' },
  { key: 'ZAPI_INSTANCE_ID', required: true, group: 'Z-API' },
  { key: 'ZAPI_TOKEN', required: true, group: 'Z-API', sensitive: true },
  { key: 'ZAPI_CLIENT_TOKEN', required: true, group: 'Z-API', sensitive: true },
  // Sessão
  { key: 'SESSION_MAX_INACTIVITY_MINUTES', required: false, group: 'Sessão' },
  { key: 'SESSION_MAX_AGE_HOURS', required: false, group: 'Sessão' },
  // SMTP
  { key: 'SMTP_HOST', required: false, group: 'SMTP' },
  { key: 'SMTP_PORT', required: false, group: 'SMTP' },
  { key: 'SMTP_SECURE', required: false, group: 'SMTP' },
  { key: 'SMTP_USER', required: false, group: 'SMTP' },
  { key: 'SMTP_PASS', required: false, group: 'SMTP', sensitive: true },
  { key: 'SMTP_FROM', required: false, group: 'SMTP' },
  // OTP
  { key: 'OTP_EXPIRES_MINUTES', required: false, group: 'OTP' },
  { key: 'OTP_MAX_ATTEMPTS', required: false, group: 'OTP' },
  { key: 'OTP_MOCK', required: false, group: 'OTP' },
  // Gestcom API
  { key: 'LINK_API_BASE_URL', required: false, group: 'Gestcom API' },
  { key: 'LINK_API_TOKEN', required: false, group: 'Gestcom API', sensitive: true },
  // Mídia
  { key: 'WELCOME_AUDIO_URL', required: false, group: 'Mídia' },
  { key: 'MENU_AUDIO_URL', required: false, group: 'Mídia' },
  { key: 'VIDEO_TUTORIAL_URL', required: false, group: 'Mídia' },
  // Atendimento presencial
  { key: 'ATENDIMENTO_MAPS_URL', required: false, group: 'Atendimento Presencial' },
  { key: 'ATENDIMENTO_MAPS_TITLE', required: false, group: 'Atendimento Presencial' },
  { key: 'ATENDIMENTO_MAPS_ADDRESS', required: false, group: 'Atendimento Presencial' },
  { key: 'ATENDIMENTO_MAPS_LATITUDE', required: false, group: 'Atendimento Presencial' },
  { key: 'ATENDIMENTO_MAPS_LONGITUDE', required: false, group: 'Atendimento Presencial' },
];

const SENSITIVE_MASK = '••••••••';

export function buildEnvReport(instance: Instance): EnvReport {
  const filePath = path.join(process.cwd(), instance.envFile);
  let raw: Record<string, string> = {};
  try {
    raw = parse(readFileSync(filePath));
  } catch {
    // file unreadable — all fields will be missing
  }

  const fields: EnvField[] = SCHEMA.map(schema => {
    const rawVal = raw[schema.key];
    const exists = schema.key in raw;
    const isEmpty = exists && rawVal.trim() === '';
    let status: FieldStatus;
    if (!exists) status = 'missing';
    else if (isEmpty) status = 'empty';
    else status = 'ok';

    return {
      key: schema.key,
      value: rawVal != null && rawVal !== '' ? (schema.sensitive ? SENSITIVE_MASK : rawVal) : null,
      status,
      required: schema.required,
      group: schema.group,
      sensitive: !!schema.sensitive,
    };
  });

  const okCount = fields.filter(f => f.status === 'ok').length;
  const missingCount = fields.filter(f => f.status === 'missing' && f.required).length;
  const emptyCount = fields.filter(f => f.status === 'empty').length;

  return {
    slug: instance.slug,
    envFile: instance.envFile,
    totalFields: fields.length,
    okCount,
    missingCount,
    emptyCount,
    fields,
  };
}
