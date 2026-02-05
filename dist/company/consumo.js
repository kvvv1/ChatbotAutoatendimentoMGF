import { fetch } from 'undici';
import { linkGetUltimasLeituras, isLinkApiConfigured } from './linkApi.js';
/**
 * Converte leitura da Link API para o formato ConsumoLeitura usado pelo bot
 */
function linkLeituraToConsumo(item) {
    return {
        referencia: item.DataRef,
        dataLeitura: item.DataLeitura,
        leitura: item.Leitura,
        consumoReal: item.ConsumoReal,
        consumoFaturado: item.ConsumoFaturado,
        consumoMedio: item.ConsumoMedio,
        hidrometro: item.Hidrometro,
        ocorrencia: item.Ocorrencia,
        // Campos legados (mapeados para compatibilidade)
        consumoRealKwh: item.ConsumoReal,
        consumoFaturadoKwh: item.ConsumoFaturado,
        mediaConsumoKwh: item.ConsumoMedio
    };
}
/**
 * Busca últimas leituras por ImovelID usando a Link API
 */
export async function fetchConsumoByImovelId(config, imovelId) {
    if (!isLinkApiConfigured(config)) {
        throw new Error('Link API não configurada (LINK_API_BASE_URL e LINK_API_TOKEN ausentes)');
    }
    const linkLeituras = await linkGetUltimasLeituras(config, imovelId);
    return linkLeituras.map(linkLeituraToConsumo);
}
function buildConsumoUrl(config, cpf, ligacaoId) {
    if (!config.consumoApiBaseUrl) {
        throw new Error('API de consumo/leitura não configurada (CONSUMO_API_BASE_URL ausente)');
    }
    const base = config.consumoApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/consumo?cpf=${encodeURIComponent(cpf)}&ligacaoId=${encodeURIComponent(ligacaoId)}`;
    return url;
}
/**
 * Busca consumo por CPF e ligacaoId (legado - mantido para retrocompatibilidade)
 * Se a Link API estiver configurada, usa o imovelId da ligação
 */
export async function fetchConsumoByLigacao(config, params) {
    const { cpf, ligacaoId, imovelId } = params;
    // Se temos imovelId e a Link API está configurada, usa ela
    if (imovelId && isLinkApiConfigured(config)) {
        return fetchConsumoByImovelId(config, imovelId);
    }
    // API legada de consumo
    if (!config.consumoApiBaseUrl) {
        throw new Error('API de consumo não configurada (CONSUMO_API_BASE_URL ou LINK_API ausente)');
    }
    const url = buildConsumoUrl(config, cpf || '', ligacaoId);
    const headers = { 'Content-Type': 'application/json' };
    if (config.consumoApiToken) {
        headers['Authorization'] = `Bearer ${config.consumoApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Falha ao buscar histórico de consumo: ${res.status} ${bodyText}`);
    }
    const json = await res.json().catch(() => null);
    if (!json)
        return [];
    const rawList = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
            ? json.data
            : Array.isArray(json.items)
                ? json.items
                : [];
    const lista = rawList.map((item, index) => {
        const referencia = (item && (item.referencia || item.mesAno || item.mes_ano || item.mesAnoReferencia)) ||
            `Período ${index + 1}`;
        const dataLeitura = (item && (item.dataLeitura || item.data_leitura || item.leituraData || item.leitura_data)) ||
            undefined;
        const consumoRealRaw = item && (item.consumoReal || item.consumo_real || item.consumoMedido || item.consumo_medido);
        const consumoFaturadoRaw = item && (item.consumoFaturado || item.consumo_faturado || item.consumo || item.kwh_faturado);
        const mediaRaw = item && (item.mediaConsumo || item.media_consumo || item.consumoMedio || item.consumo_medio);
        const consumoRealKwh = consumoRealRaw !== undefined && consumoRealRaw !== null ? Number(consumoRealRaw) || undefined : undefined;
        const consumoFaturadoKwh = consumoFaturadoRaw !== undefined && consumoFaturadoRaw !== null
            ? Number(consumoFaturadoRaw) || undefined
            : undefined;
        const mediaConsumoKwh = mediaRaw !== undefined && mediaRaw !== null ? Number(mediaRaw) || undefined : undefined;
        return {
            referencia: String(referencia),
            dataLeitura: dataLeitura ? String(dataLeitura) : undefined,
            consumoRealKwh,
            consumoFaturadoKwh,
            mediaConsumoKwh
        };
    });
    return lista;
}
