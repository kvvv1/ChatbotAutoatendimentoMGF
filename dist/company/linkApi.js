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
// ============================================================================
// CLIENTE HTTP
// ============================================================================
export class LinkApiError extends Error {
    statusCode;
    responseBody;
    constructor(message, statusCode, responseBody) {
        super(message);
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.name = 'LinkApiError';
    }
}
/**
 * Faz uma requisição POST para a API Link
 */
async function linkPost(config, endpoint, body) {
    if (!config.linkApiBaseUrl) {
        throw new LinkApiError('LINK_API_BASE_URL não configurado');
    }
    if (!config.linkApiToken) {
        throw new LinkApiError('LINK_API_TOKEN não configurado');
    }
    const base = config.linkApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}${endpoint}`;
    const headers = {
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
        throw new LinkApiError(`Erro na API Link: ${res.status} ${res.statusText}`, res.status, bodyText);
    }
    const json = await res.json().catch(() => null);
    return json;
}
/**
 * Faz uma requisição GET para a API Link
 */
async function linkGet(config, endpoint) {
    if (!config.linkApiBaseUrl) {
        throw new LinkApiError('LINK_API_BASE_URL não configurado');
    }
    if (!config.linkApiToken) {
        throw new LinkApiError('LINK_API_TOKEN não configurado');
    }
    const base = config.linkApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'Token': config.linkApiToken
    };
    const res = await fetch(url, {
        method: 'GET',
        headers
    });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new LinkApiError(`Erro na API Link: ${res.status} ${res.statusText}`, res.status, bodyText);
    }
    const json = await res.json().catch(() => null);
    return json;
}
// ============================================================================
// FUNÇÕES DE NEGÓCIO
// ============================================================================
/**
 * Login com ID Eletrônico
 * POST /login-default
 */
export async function linkLogin(config, idEletronico) {
    return linkPost(config, '/login-default', {
        identificador: idEletronico
    });
}
/**
 * Busca débitos do imóvel
 * POST /Debitos
 */
export async function linkGetDebitos(config, imovelId) {
    console.log('[linkApi] Buscando débitos para ImovelID:', imovelId);
    const result = await linkPost(config, '/Debitos', {
        ImovelID: imovelId
    });
    console.log('[linkApi] Débitos recebidos:', JSON.stringify(result, null, 2));
    return result;
}
/**
 * Busca dados cadastrais do imóvel
 * POST /Dados-Cadastrais
 */
export async function linkGetDadosCadastrais(config, imovelId) {
    return linkPost(config, '/Dados-Cadastrais', {
        ImovelID: imovelId
    });
}
/**
 * Busca últimas leituras do imóvel
 * POST /Ultimas-Leituras
 */
export async function linkGetUltimasLeituras(config, imovelId) {
    console.log('[linkApi] Buscando leituras para ImovelID:', imovelId);
    const result = await linkPost(config, '/Ultimas-Leituras', {
        ImovelID: imovelId
    });
    console.log('[linkApi] Resposta /Ultimas-Leituras:', JSON.stringify(result));
    return result;
}
/**
 * Busca dados resumidos (consumos e total débitos)
 * POST /Home
 */
export async function linkGetHome(config, imovelId) {
    return linkPost(config, '/Home', {
        ImovelID: imovelId
    });
}
/**
 * Gera impressão da conta (2ª via)
 * POST /Impressao-Conta
 * Retorna o PDF ou URL do PDF (a confirmar formato de resposta)
 */
export async function linkImpressaoConta(config, imovelId, boletoIds) {
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
                const pdfField = json.pdf || json.Pdf || json.PDF ||
                    json.base64 || json.Base64 ||
                    json.arquivo || json.Arquivo ||
                    json.documento || json.Documento;
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
    }
    catch (error) {
        console.error('[linkApi] Erro na Impressao-Conta:', error);
        return null;
    }
}
/**
 * Verifica se a API Link está configurada e disponível
 */
export function isLinkApiConfigured(config) {
    return !!(config.linkApiBaseUrl && config.linkApiToken);
}
