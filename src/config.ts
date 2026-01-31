import { config as dotenvConfig } from 'dotenv';

// Carrega .env padrão, depois complementa com docs/.env (sem sobrescrever o que já existir)
dotenvConfig();
dotenvConfig({ path: 'docs/.env', override: false });

export type AppConfig = {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  zapiBaseUrl: string;
  zapiInstanceId: string;
  zapiToken: string;
  sessionMaxInactivityMinutes: number;
  sessionMaxAgeHours: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  otpExpiresMinutes: number;
  otpMaxAttempts: number;
  videoTutorialUrl?: string;
  videoTutorialCaption?: string;
  videoTutorialIntro?: string;
};

export function loadConfig(): AppConfig {
  const {
    PORT,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    ZAPI_BASE_URL,
    ZAPI_INSTANCE_ID,
    ZAPI_TOKEN,
    SESSION_MAX_INACTIVITY_MINUTES,
    SESSION_MAX_AGE_HOURS,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    OTP_EXPIRES_MINUTES,
    OTP_MAX_ATTEMPTS,
    VIDEO_TUTORIAL_URL,
    VIDEO_TUTORIAL_CAPTION,
    VIDEO_TUTORIAL_INTRO
  } = process.env;

  if (!SUPABASE_URL) throw new Error('SUPABASE_URL não configurado');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado');
  if (!ZAPI_BASE_URL) throw new Error('ZAPI_BASE_URL não configurado');
  if (!ZAPI_INSTANCE_ID) throw new Error('ZAPI_INSTANCE_ID não configurado');
  if (!ZAPI_TOKEN) throw new Error('ZAPI_TOKEN não configurado');

  return {
    port: Number(PORT ?? 3000),
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    zapiBaseUrl: ZAPI_BASE_URL,
    zapiInstanceId: ZAPI_INSTANCE_ID,
    zapiToken: ZAPI_TOKEN,
    sessionMaxInactivityMinutes: Number(SESSION_MAX_INACTIVITY_MINUTES ?? 60),
    sessionMaxAgeHours: Number(SESSION_MAX_AGE_HOURS ?? 24),
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT ? Number(SMTP_PORT) : undefined,
    smtpSecure: SMTP_SECURE ? SMTP_SECURE === 'true' : undefined,
    smtpUser: SMTP_USER,
    smtpPass: SMTP_PASS,
    smtpFrom: SMTP_FROM,
    otpExpiresMinutes: Number(OTP_EXPIRES_MINUTES ?? 10),
    otpMaxAttempts: Number(OTP_MAX_ATTEMPTS ?? 5),
    videoTutorialUrl: VIDEO_TUTORIAL_URL,
    videoTutorialCaption: VIDEO_TUTORIAL_CAPTION,
    videoTutorialIntro: VIDEO_TUTORIAL_INTRO
  };
}

