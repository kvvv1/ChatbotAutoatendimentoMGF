import { fetch } from 'undici';
// Cache em memória para evitar chamadas repetidas
let cachedAutarquia = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
export async function fetchDadosAutarquia(config) {
    // Verifica cache
    const now = Date.now();
    if (cachedAutarquia && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedAutarquia;
    }
    const baseUrl = config.clienteApiBaseUrl;
    if (!baseUrl) {
        throw new Error('CLIENTE_API_BASE_URL não configurada');
    }
    const url = `${baseUrl}/Autarquia`;
    console.log('[autarquia] Buscando dados da autarquia...');
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Erro ao buscar autarquia: ${res.status} ${text}`);
    }
    const data = await res.json();
    console.log('[autarquia] Dados recebidos:', JSON.stringify(data, null, 2));
    const autarquia = {
        nome: data.Nome || 'SAAE',
        nomeCompleto: data.Autarquia || 'Serviço Autônomo de Água e Esgoto',
        cnpj: data.CNPJ || '',
        inscricaoEstadual: data.InscricaoEstadual || undefined,
        telefone: data.Telefone || '',
        cep: data.CEP || '',
        endereco: data.Endereco || '',
        orgaoResponsavel: data.OrgaoResponsavel || undefined
    };
    // Atualiza cache
    cachedAutarquia = autarquia;
    cacheTimestamp = now;
    return autarquia;
}
/**
 * Formata o telefone para exibição
 * Ex: 3121060100 -> (31) 2106-0100
 */
export function formatarTelefone(telefone) {
    if (!telefone)
        return '';
    const digits = telefone.replace(/\D/g, '');
    if (digits.length === 10) {
        // (XX) XXXX-XXXX
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    else if (digits.length === 11) {
        // (XX) XXXXX-XXXX
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    return telefone;
}
/**
 * Limpa o cache da autarquia
 */
export function clearAutarquiaCache() {
    cachedAutarquia = null;
    cacheTimestamp = 0;
}
