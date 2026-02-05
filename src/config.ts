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
  // Link API (Gestcom) - API principal de integração
  linkApiBaseUrl?: string;
  linkApiToken?: string;
  linkApiMock?: boolean;
  // APIs legadas (mantidas para retrocompatibilidade, serão removidas)
  ligacoesApiBaseUrl?: string;
  ligacoesApiToken?: string;
  ligacoesApiMock?: boolean;
  debitosApiBaseUrl?: string;
  debitosApiToken?: string;
  debitosApiMock?: boolean;
  consumoApiBaseUrl?: string;
  consumoApiToken?: string;
  consumoApiMock?: boolean;
  cadastroApiBaseUrl?: string;
  cadastroApiToken?: string;
  cadastroApiMock?: boolean;
  servicosApiBaseUrl?: string;
  servicosApiToken?: string;
  servicosApiMock?: boolean;
  clienteApiBaseUrl?: string;
  clienteApiToken?: string;
  clienteApiMock?: boolean;
  religacaoWhatsappNumber?: string;
  entidadePhoneNumber?: string;
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
  otpMock?: boolean;
  videoTutorialUrl?: string;
  videoTutorialCaption?: string;
  videoTutorialIntro?: string;
  atendimentoMapsUrl?: string;
  atendimentoMapsTitle?: string;
  atendimentoMapsDescription?: string;
  atendimentoMapsLatitude?: string;
  atendimentoMapsLongitude?: string;
  atendimentoMapsAddress?: string;
  welcomeAudioUrl?: string;
  menuAudioUrl?: string;
  // Modo demonstração/simulação
  demoIdEletronico?: string;
};

export function loadConfig(): AppConfig {
  const {
    PORT,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    ZAPI_BASE_URL,
    ZAPI_INSTANCE_ID,
    ZAPI_TOKEN,
    // Link API (Gestcom)
    LINK_API_BASE_URL,
    LINK_API_TOKEN,
    LINK_API_MOCK,
    // APIs legadas
    LIGACOES_API_BASE_URL,
    LIGACOES_API_TOKEN,
    LIGACOES_API_MOCK,
    DEBITOS_API_BASE_URL,
    DEBITOS_API_TOKEN,
    DEBITOS_API_MOCK,
    CONSUMO_API_BASE_URL,
    CONSUMO_API_TOKEN,
    CONSUMO_API_MOCK,
    CADASTRO_API_BASE_URL,
    CADASTRO_API_TOKEN,
    CADASTRO_API_MOCK,
    SERVICOS_API_BASE_URL,
    SERVICOS_API_TOKEN,
    SERVICOS_API_MOCK,
    CLIENTE_API_BASE_URL,
    CLIENTE_API_TOKEN,
    CLIENTE_API_MOCK,
    RELIGACAO_WHATSAPP_NUMBER,
    ENTIDADE_PHONE_NUMBER,
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
    OTP_MOCK,
    VIDEO_TUTORIAL_URL,
    VIDEO_TUTORIAL_CAPTION,
    VIDEO_TUTORIAL_INTRO,
    ATENDIMENTO_MAPS_URL,
    ATENDIMENTO_MAPS_TITLE,
    ATENDIMENTO_MAPS_DESCRIPTION,
    ATENDIMENTO_MAPS_LATITUDE,
    ATENDIMENTO_MAPS_LONGITUDE,
    ATENDIMENTO_MAPS_ADDRESS,
    WELCOME_AUDIO_URL,
    MENU_AUDIO_URL,
    DEMO_ID_ELETRONICO
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
    // Link API (Gestcom)
    linkApiBaseUrl: LINK_API_BASE_URL,
    linkApiToken: LINK_API_TOKEN,
    linkApiMock: LINK_API_MOCK === 'true',
    // APIs legadas
    ligacoesApiBaseUrl: LIGACOES_API_BASE_URL,
    ligacoesApiToken: LIGACOES_API_TOKEN,
    ligacoesApiMock: LIGACOES_API_MOCK === 'true',
    debitosApiBaseUrl: DEBITOS_API_BASE_URL,
    debitosApiToken: DEBITOS_API_TOKEN,
    debitosApiMock: DEBITOS_API_MOCK === 'true',
    consumoApiBaseUrl: CONSUMO_API_BASE_URL,
    consumoApiToken: CONSUMO_API_TOKEN,
    consumoApiMock: CONSUMO_API_MOCK === 'true',
    cadastroApiBaseUrl: CADASTRO_API_BASE_URL,
    cadastroApiToken: CADASTRO_API_TOKEN,
    cadastroApiMock: CADASTRO_API_MOCK === 'true',
    servicosApiBaseUrl: SERVICOS_API_BASE_URL,
    servicosApiToken: SERVICOS_API_TOKEN,
    servicosApiMock: SERVICOS_API_MOCK === 'true',
    clienteApiBaseUrl: CLIENTE_API_BASE_URL,
    clienteApiToken: CLIENTE_API_TOKEN,
    clienteApiMock: CLIENTE_API_MOCK === 'true',
    religacaoWhatsappNumber: RELIGACAO_WHATSAPP_NUMBER,
    entidadePhoneNumber: ENTIDADE_PHONE_NUMBER,
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
    otpMock: OTP_MOCK === 'true',
    videoTutorialUrl: VIDEO_TUTORIAL_URL,
    videoTutorialCaption: VIDEO_TUTORIAL_CAPTION,
    videoTutorialIntro: VIDEO_TUTORIAL_INTRO,
    atendimentoMapsUrl: ATENDIMENTO_MAPS_URL,
    atendimentoMapsTitle: ATENDIMENTO_MAPS_TITLE,
    atendimentoMapsDescription: ATENDIMENTO_MAPS_DESCRIPTION,
    atendimentoMapsLatitude: ATENDIMENTO_MAPS_LATITUDE,
    atendimentoMapsLongitude: ATENDIMENTO_MAPS_LONGITUDE,
    atendimentoMapsAddress: ATENDIMENTO_MAPS_ADDRESS,
    welcomeAudioUrl: WELCOME_AUDIO_URL,
    menuAudioUrl: MENU_AUDIO_URL,
    demoIdEletronico: DEMO_ID_ELETRONICO
  };
}

