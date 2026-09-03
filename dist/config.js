import { config as dotenvConfig } from 'dotenv';
// Carrega o .env definido em ENV_FILE (ex: .env.formiga), ou .env padrão
dotenvConfig({ path: process.env.ENV_FILE ?? '.env' });
dotenvConfig({ path: 'docs/.env', override: false });
export function loadConfig() {
    const { PORT, DB_SERVER, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE, ZAPI_BASE_URL, ZAPI_INSTANCE_ID, ZAPI_TOKEN, 
    // Link API (Gestcom)
    LINK_API_BASE_URL, LINK_API_TOKEN, LINK_API_MOCK, 
    // APIs legadas
    LIGACOES_API_BASE_URL, LIGACOES_API_TOKEN, LIGACOES_API_MOCK, DEBITOS_API_BASE_URL, DEBITOS_API_TOKEN, DEBITOS_API_MOCK, CONSUMO_API_BASE_URL, CONSUMO_API_TOKEN, CONSUMO_API_MOCK, CADASTRO_API_BASE_URL, CADASTRO_API_TOKEN, CADASTRO_API_MOCK, SERVICOS_API_BASE_URL, SERVICOS_API_TOKEN, SERVICOS_API_MOCK, CLIENTE_API_BASE_URL, CLIENTE_API_TOKEN, CLIENTE_API_MOCK, RELIGACAO_WHATSAPP_NUMBER, ENTIDADE_PHONE_NUMBER, SESSION_MAX_INACTIVITY_MINUTES, SESSION_MAX_AGE_HOURS, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, OTP_EXPIRES_MINUTES, OTP_MAX_ATTEMPTS, OTP_MOCK, VIDEO_TUTORIAL_URL, VIDEO_TUTORIAL_CAPTION, VIDEO_TUTORIAL_INTRO, ATENDIMENTO_MAPS_URL, ATENDIMENTO_MAPS_TITLE, ATENDIMENTO_MAPS_DESCRIPTION, ATENDIMENTO_MAPS_LATITUDE, ATENDIMENTO_MAPS_LONGITUDE, ATENDIMENTO_MAPS_ADDRESS, WELCOME_AUDIO_URL, MENU_AUDIO_URL, DEMO_ID_ELETRONICO, ENTIDADE_NOME, ENTIDADE_NOME_COMPLETO, ENABLE_CONTACTS, BUSINESS_HOURS_START, BUSINESS_HOURS_END, BUSINESS_DAY_START, BUSINESS_DAY_END, HUMAN_HANDOFF_CALL_ENABLED, HUMAN_HANDOFF_CALL_PHONE, HUMAN_HANDOFF_CALL_MESSAGE, API_SECRET, ATTENDANT_AUTH_SECRET, WHATSAPP_PROVIDER, META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID, META_APP_SECRET, META_VERIFY_TOKEN, META_API_VERSION, } = process.env;
    if (!DB_SERVER)
        throw new Error('DB_SERVER não configurado');
    if (!DB_USER)
        throw new Error('DB_USER não configurado');
    if (!DB_PASSWORD)
        throw new Error('DB_PASSWORD não configurado');
    if (!DB_DATABASE)
        throw new Error('DB_DATABASE não configurado');
    if (!ZAPI_BASE_URL)
        throw new Error('ZAPI_BASE_URL não configurado');
    if (!ZAPI_INSTANCE_ID)
        throw new Error('ZAPI_INSTANCE_ID não configurado');
    if (!ZAPI_TOKEN)
        throw new Error('ZAPI_TOKEN não configurado');
    return {
        port: Number(PORT ?? 3000),
        dbHost: DB_SERVER,
        dbPort: Number(DB_PORT ?? 3306),
        dbUser: DB_USER,
        dbPassword: DB_PASSWORD,
        dbDatabase: DB_DATABASE,
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
        demoIdEletronico: DEMO_ID_ELETRONICO,
        entidadeNome: ENTIDADE_NOME || 'SAAE',
        entidadeNomeCompleto: ENTIDADE_NOME_COMPLETO || ENTIDADE_NOME || 'SAAE',
        enableContacts: ENABLE_CONTACTS === 'true',
        businessHoursStart: BUSINESS_HOURS_START || '08:00',
        businessHoursEnd: BUSINESS_HOURS_END || '18:00',
        businessDayStart: Number(BUSINESS_DAY_START) || 1,
        businessDayEnd: Number(BUSINESS_DAY_END) || 5,
        humanHandoffCallEnabled: HUMAN_HANDOFF_CALL_ENABLED === 'true',
        humanHandoffCallPhone: HUMAN_HANDOFF_CALL_PHONE || undefined,
        humanHandoffCallMessage: HUMAN_HANDOFF_CALL_MESSAGE || undefined,
        apiSecret: API_SECRET || undefined,
        attendantAuthSecret: ATTENDANT_AUTH_SECRET || API_SECRET || undefined,
        whatsappProvider: WHATSAPP_PROVIDER === 'meta' ? 'meta' : 'zapi',
        metaAccessToken: META_ACCESS_TOKEN || undefined,
        metaPhoneNumberId: META_PHONE_NUMBER_ID || undefined,
        metaWabaId: META_WABA_ID || undefined,
        metaAppSecret: META_APP_SECRET || undefined,
        metaVerifyToken: META_VERIFY_TOKEN || undefined,
        metaApiVersion: META_API_VERSION || undefined,
    };
}
