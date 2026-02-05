import { fetch } from 'undici';
import type { AppConfig } from '../config.js';
import { linkLogin, isLinkApiConfigured, type LinkLoginResponse, type LinkImovel } from './linkApi.js';

export type ClienteCadastro = {
  cpf: string;
  nome?: string | null;
  email?: string | null;
};

/** Resultado do login via Link API */
export type LoginLinkResult = {
  nomeCliente: string;
  imoveis: LinkImovel[];
  imovelSelecionado: number;
};

function onlyDigits(value: string): string {
  try {
    if (typeof value !== 'string') return '';
    return value.replace(/\D/g, '');
  } catch {
    return '';
  }
}

function buildClienteUrl(config: AppConfig, cpf: string): string {
  if (!config.clienteApiBaseUrl) {
    throw new Error('API de clientes não configurada (CLIENTE_API_BASE_URL ausente)');
  }
  const base = config.clienteApiBaseUrl.replace(/\/+$/, '');
  const url = `${base}/cliente?cpf=${encodeURIComponent(cpf)}`;
  return url;
}

/**
 * Login via Link API (Gestcom) usando ID Eletrônico
 * Retorna dados do cliente e lista de imóveis
 */
export async function loginByIdEletronico(
  config: AppConfig,
  idEletronico: string
): Promise<LoginLinkResult> {
  if (!isLinkApiConfigured(config)) {
    throw new Error('Link API não configurada (LINK_API_BASE_URL e LINK_API_TOKEN ausentes)');
  }

  const response = await linkLogin(config, idEletronico);
  
  console.log('[cliente] Login response:', JSON.stringify(response, null, 2));
  
  return {
    nomeCliente: response.Cliente,
    imoveis: response.Imoveis,
    imovelSelecionado: response.ImovelSelecionado
  };
}

/**
 * Busca cliente por CPF (legado - mantido para retrocompatibilidade)
 */
export async function fetchClienteByCpf(config: AppConfig, cpf: string): Promise<ClienteCadastro | null> {
  const digits = onlyDigits(cpf);

  // API legada de cliente - se não configurada, lança erro
  if (!config.clienteApiBaseUrl) {
    throw new Error('API de cliente não configurada (CLIENTE_API_BASE_URL ausente). Use loginByIdEletronico para a Link API.');
  }

  const url = buildClienteUrl(config, digits);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.clienteApiToken) {
    headers['Authorization'] = `Bearer ${config.clienteApiToken}`;
  }

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Falha ao buscar cliente por CPF: ${res.status} ${bodyText}`);
  }

  const json: any = await res.json().catch(() => null);
  if (!json) return null;

  // Tenta localizar o objeto de cliente em diferentes formatos comuns
  const fonte = (json.cliente || json.data || json.clienteCadastro || json) as any;
  if (!fonte) return null;

  const cpfFonte = onlyDigits(String(fonte.cpf || fonte.cpfCliente || digits));
  if (!cpfFonte || cpfFonte.length !== 11) {
    return null;
  }

  const email = (fonte.email || fonte.emailCadastro || fonte.email_principal || fonte.emailPrincipal) as string | undefined;
  const nome = (fonte.nome || fonte.nomeCliente || fonte.nome_titular || fonte.titular) as string | undefined;

  return {
    cpf: cpfFonte,
    nome: nome ?? null,
    email: email ?? null
  };
}
