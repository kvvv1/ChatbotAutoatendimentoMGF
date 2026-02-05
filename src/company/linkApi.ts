/**
 * Cliente HTTP centralizado para a API Link Autoatendimento (Gestcom)
 * 
 * Endpoints disponíveis:
 * - POST /login-default - Login com ID Eletrônico
 * - POST /Debitos - Lista débitos do imóvel
 * - POST /Dados-Cadastrais - Dados cadastrais do imóvel
 * - POST /Ultimas-Leituras - Histórico de leituras
 * - POST /Impressao-Conta - Gera PDF da fatura
 * - POST /Home - Dados resumidos (consumos e total débitos)
 */

import { fetch } from 'undici';
import type { AppConfig } from '../config.js';

// ============================================================================
// TIPOS DE RESPOSTA DA API
// ============================================================================

/** Imóvel retornado pelo login */
export type LinkImovel = {
  ImovelID: number;
  DV: number;
  IdEletronico: string;
  Endereco: string;
};

/** Resposta do POST /login-default */
export type LinkLoginResponse = {
  Cliente: string;
  Imoveis: LinkImovel[];
  ImovelSelecionado: number;
};

/** Débito retornado pelo POST /Debitos */
export type LinkDebito = {
  BoletoID: string;
  DataRef: string;
  DataVencimento: string;
  ValorBoleto: number;
  CodigoBarras: string;
  LinhaDigitavel: string;
  PayloadPix: string;
  DebitoAutomatico: number; // 0 = não, 1 = sim
};

/** Categoria do imóvel */
export type LinkCategoria = {
  Categoria: string;
  Economias: number;
};

/** Resposta do POST /Dados-Cadastrais */
export type LinkDadosCadastrais = {
  Nome: string;
  Endereco: string;
  MapaCadastral: string;
  Categorias: LinkCategoria[];
  DataLigacao: string;
  DataInstalacao: string;
  Hidrometro: string;
  Servico: number;
  DescricaoServico: string;
  Situacao: number;
  DescricaoSituacao: string;
  IDEletronico: string;
  EnderecoCorrespondencia: string;
  DCO: number;
};

/** Leitura retornada pelo POST /Ultimas-Leituras */
export type LinkLeitura = {
  DataLeitura: string;
  OcorrenciaID: number;
  Ocorrencia: string;
  DataRef: string;
  Hidrometro: string;
  Leitura: number;
  ConsumoFaturado: number;
  ConsumoReal: number;
  ConsumoMedio: number;
};

/** Consumo resumido do POST /Home */
export type LinkConsumoHome = {
  mes: string;
  consumo: number;
};

/** Resposta do POST /Home */
export type LinkHomeResponse = {
  Consumos: LinkConsumoHome[];
  TotalDebitos: number;
};

// ============================================================================
// CLIENTE HTTP
// ============================================================================

export class LinkApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'LinkApiError';
  }
}

/**
 * Faz uma requisição POST para a API Link
 */
async function linkPost<T>(
  config: AppConfig,
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  if (!config.linkApiBaseUrl) {
    throw new LinkApiError('LINK_API_BASE_URL não configurado');
  }
  if (!config.linkApiToken) {
    throw new LinkApiError('LINK_API_TOKEN não configurado');
  }

  const base = config.linkApiBaseUrl.replace(/\/+$/, '');
  const url = `${base}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Token': config.linkApiToken
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new LinkApiError(
      `Erro na API Link: ${res.status} ${res.statusText}`,
      res.status,
      bodyText
    );
  }

  const json = await res.json().catch(() => null);
  return json as T;
}

/**
 * Faz uma requisição GET para a API Link
 */
async function linkGet<T>(
  config: AppConfig,
  endpoint: string
): Promise<T> {
  if (!config.linkApiBaseUrl) {
    throw new LinkApiError('LINK_API_BASE_URL não configurado');
  }
  if (!config.linkApiToken) {
    throw new LinkApiError('LINK_API_TOKEN não configurado');
  }

  const base = config.linkApiBaseUrl.replace(/\/+$/, '');
  const url = `${base}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Token': config.linkApiToken
  };

  const res = await fetch(url, {
    method: 'GET',
    headers
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new LinkApiError(
      `Erro na API Link: ${res.status} ${res.statusText}`,
      res.status,
      bodyText
    );
  }

  const json = await res.json().catch(() => null);
  return json as T;
}

// ============================================================================
// FUNÇÕES DE NEGÓCIO
// ============================================================================

/**
 * Login com ID Eletrônico
 * POST /login-default
 */
export async function linkLogin(
  config: AppConfig,
  idEletronico: string
): Promise<LinkLoginResponse> {
  return linkPost<LinkLoginResponse>(config, '/login-default', {
    identificador: idEletronico
  });
}

/**
 * Busca débitos do imóvel
 * POST /Debitos
 */
export async function linkGetDebitos(
  config: AppConfig,
  imovelId: number
): Promise<LinkDebito[]> {
  console.log('[linkApi] Buscando débitos para ImovelID:', imovelId);
  const result = await linkPost<LinkDebito[]>(config, '/Debitos', {
    ImovelID: imovelId
  });
  console.log('[linkApi] Débitos recebidos:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Busca dados cadastrais do imóvel
 * POST /Dados-Cadastrais
 */
export async function linkGetDadosCadastrais(
  config: AppConfig,
  imovelId: number
): Promise<LinkDadosCadastrais> {
  return linkPost<LinkDadosCadastrais>(config, '/Dados-Cadastrais', {
    ImovelID: imovelId
  });
}

/**
 * Busca últimas leituras do imóvel
 * POST /Ultimas-Leituras
 */
export async function linkGetUltimasLeituras(
  config: AppConfig,
  imovelId: number
): Promise<LinkLeitura[]> {
  return linkPost<LinkLeitura[]>(config, '/Ultimas-Leituras', {
    ImovelID: imovelId
  });
}

/**
 * Busca dados resumidos (consumos e total débitos)
 * POST /Home
 */
export async function linkGetHome(
  config: AppConfig,
  imovelId: number
): Promise<LinkHomeResponse> {
  return linkPost<LinkHomeResponse>(config, '/Home', {
    ImovelID: imovelId
  });
}

/**
 * Gera impressão da conta (2ª via)
 * POST /Impressao-Conta
 * Retorna o PDF ou URL do PDF (a confirmar formato de resposta)
 */
export async function linkImpressaoConta(
  config: AppConfig,
  imovelId: number,
  boletoIds: string[]
): Promise<string | null> {
  if (!config.linkApiBaseUrl) {
    throw new LinkApiError('LINK_API_BASE_URL não configurado');
  }
  if (!config.linkApiToken) {
    throw new LinkApiError('LINK_API_TOKEN não configurado');
  }

  const base = config.linkApiBaseUrl.replace(/\/+$/, '');
  const url = `${base}/Impressao-Conta`;

  const payload = {
    ImovelID: imovelId,
    BoletoID: boletoIds
  };
  
  console.log('[linkApi] Chamando Impressao-Conta com payload:', JSON.stringify(payload));
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Token': config.linkApiToken
      },
      body: JSON.stringify(payload)
    });

    console.log('[linkApi] Impressao-Conta status:', res.status, 'Content-Type:', res.headers.get('content-type'));

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[linkApi] Impressao-Conta erro:', res.status, bodyText);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    
    // Se retorna PDF binário diretamente
    if (contentType.includes('application/pdf')) {
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      console.log('[linkApi] Impressao-Conta retornou PDF binário, convertido para base64, tamanho:', base64.length);
      return base64;
    }
    
    // Se retorna JSON
    if (contentType.includes('application/json')) {
      const json = await res.json().catch(() => null);
      console.log('[linkApi] Impressao-Conta retornou JSON:', JSON.stringify(json, null, 2));
      
      if (json && typeof json === 'object') {
        // Tenta encontrar o campo com o PDF base64
        const pdfField = (json as any).pdf || (json as any).Pdf || (json as any).PDF || 
                        (json as any).base64 || (json as any).Base64 ||
                        (json as any).arquivo || (json as any).Arquivo ||
                        (json as any).documento || (json as any).Documento;
        if (pdfField && typeof pdfField === 'string') {
          console.log('[linkApi] PDF encontrado no campo JSON, tamanho:', pdfField.length);
          return pdfField;
        }
      }
      return null;
    }
    
    // Se retorna texto (pode ser base64 direto)
    const text = await res.text();
    console.log('[linkApi] Impressao-Conta retornou texto, tamanho:', text.length, 'primeiros chars:', text.substring(0, 100));
    
    // Verifica se parece ser base64 de PDF
    if (text && (text.startsWith('JVBERi') || text.length > 1000)) {
      return text;
    }
    
    return null;
  } catch (error) {
    console.error('[linkApi] Erro na Impressao-Conta:', error);
    return null;
  }
}

/**
 * Verifica se a API Link está configurada e disponível
 */
export function isLinkApiConfigured(config: AppConfig): boolean {
  return !!(config.linkApiBaseUrl && config.linkApiToken);
}
