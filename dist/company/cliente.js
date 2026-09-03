import { fetch } from 'undici';
import { linkLogin, isLinkApiConfigured } from './linkApi.js';
function onlyDigits(value) {
    try {
        if (typeof value !== 'string')
            return '';
        return value.replace(/\D/g, '');
    }
    catch {
        return '';
    }
}
function buildClienteUrl(config, cpf) {
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
export async function loginByIdEletronico(config, idEletronico) {
    if (!isLinkApiConfigured(config)) {
        throw new Error('Link API não configurada (LINK_API_BASE_URL e LINK_API_TOKEN ausentes)');
    }
    const response = await linkLogin(config, idEletronico);
    console.log('[cliente] Login response raw:', JSON.stringify(response, null, 2));
    // Normaliza variações de campo da API (Imoveis / Imovel / imoveis / imovel)
    const raw = response;
    const imoveis = Array.isArray(raw.Imoveis) ? raw.Imoveis :
        Array.isArray(raw.Imovel) ? raw.Imovel :
            Array.isArray(raw.imoveis) ? raw.imoveis :
                Array.isArray(raw.imovel) ? raw.imovel :
                    raw.Imoveis != null ? [raw.Imoveis] :
                        [];
    if (!imoveis.length) {
        console.warn('[cliente] Nenhum imóvel retornado pela API. Response:', JSON.stringify(raw));
    }
    return {
        nomeCliente: raw.Cliente ?? raw.cliente ?? raw.NomeCliente ?? '',
        imoveis,
        imovelSelecionado: raw.ImovelSelecionado ?? raw.imovelSelecionado ?? 0,
    };
}
/**
 * Busca cliente por CPF (legado - mantido para retrocompatibilidade)
 */
export async function fetchClienteByCpf(config, cpf) {
    const digits = onlyDigits(cpf);
    // API legada de cliente - se não configurada, lança erro
    if (!config.clienteApiBaseUrl) {
        throw new Error('API de cliente não configurada (CLIENTE_API_BASE_URL ausente). Use loginByIdEletronico para a Link API.');
    }
    const url = buildClienteUrl(config, digits);
    const headers = { 'Content-Type': 'application/json' };
    if (config.clienteApiToken) {
        headers['Authorization'] = `Bearer ${config.clienteApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Falha ao buscar cliente por CPF: ${res.status} ${bodyText}`);
    }
    const json = await res.json().catch(() => null);
    if (!json)
        return null;
    // Tenta localizar o objeto de cliente em diferentes formatos comuns
    const fonte = (json.cliente || json.data || json.clienteCadastro || json);
    if (!fonte)
        return null;
    const cpfFonte = onlyDigits(String(fonte.cpf || fonte.cpfCliente || digits));
    if (!cpfFonte || cpfFonte.length !== 11) {
        return null;
    }
    const email = (fonte.email || fonte.emailCadastro || fonte.email_principal || fonte.emailPrincipal);
    const nome = (fonte.nome || fonte.nomeCliente || fonte.nome_titular || fonte.titular);
    return {
        cpf: cpfFonte,
        nome: nome ?? null,
        email: email ?? null
    };
}
