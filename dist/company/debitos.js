import { fetch } from 'undici';
import { linkGetDebitos, isLinkApiConfigured } from './linkApi.js';
/**
 * Formata DataRef para MM/YYYY.
 * A Link API manda no formato "AAAAMM" colado (ex: "202607"), que o construtor
 * Date() interpreta errado (trata a string inteira como ano, mês vira 01) —
 * por isso o parse é feito manualmente a partir dos dígitos, sem usar Date().
 */
function formatDataRefToMesAno(dataRef) {
    const digits = String(dataRef || '').replace(/\D/g, '');
    if (digits.length === 6) {
        const ano = digits.slice(0, 4);
        const mes = digits.slice(4, 6);
        return `${mes}/${ano}`;
    }
    // Fallback pra caso alguma instância venha com data ISO nesse campo
    try {
        const date = new Date(dataRef);
        if (isNaN(date.getTime()))
            return '';
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const ano = date.getFullYear();
        return `${mes}/${ano}`;
    }
    catch {
        return '';
    }
}
/**
 * Formata data ISO para DD/MM/YYYY
 */
function formatDataVencimento(dataVencimento) {
    try {
        const date = new Date(dataVencimento);
        if (isNaN(date.getTime()))
            return '';
        const dia = String(date.getDate()).padStart(2, '0');
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const ano = date.getFullYear();
        return `${dia}/${mes}/${ano}`;
    }
    catch {
        return '';
    }
}
/**
 * Interpreta o campo DebitoAutomatico da Link API, que varia de formato entre instâncias
 * (número 0/1, string "0"/"1", "S"/"N", ou vazio em instâncias desktop que não populam o campo)
 */
function parseDebitoAutomatico(value) {
    if (value === 1 || value === true)
        return true;
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized === '1' || normalized === 'S' || normalized === 'SIM' || normalized === 'TRUE';
}
/**
 * Converte débito da Link API para o formato Debito usado pelo bot
 */
function linkDebitoToDebito(item) {
    return {
        idFatura: item.BoletoID,
        mesAnoReferencia: formatDataRefToMesAno(item.DataRef),
        dataVencimento: formatDataVencimento(item.DataVencimento),
        valor: item.ValorBoleto,
        emDebitoAutomatico: parseDebitoAutomatico(item.DebitoAutomatico),
        linhaDigitavel: item.LinhaDigitavel,
        codigoBarras: item.CodigoBarras,
        payloadPix: item.PayloadPix,
        status: 'EM_ABERTO'
    };
}
/**
 * Busca débitos por ImovelID usando a Link API
 */
export async function fetchDebitosByImovelId(config, imovelId) {
    if (!isLinkApiConfigured(config)) {
        throw new Error('Link API não configurada (LINK_API_BASE_URL e LINK_API_TOKEN ausentes)');
    }
    const linkDebitos = await linkGetDebitos(config, imovelId);
    // A Link API retorna uma mensagem de texto (não um array) quando não há débitos pendentes —
    // trata qualquer resposta que não seja array como "sem débitos", em vez de estourar erro.
    if (!Array.isArray(linkDebitos))
        return [];
    return linkDebitos.map(linkDebitoToDebito);
}
function buildDebitosUrl(config, cpf, ligacaoId) {
    if (!config.debitosApiBaseUrl) {
        throw new Error('API de débitos não configurada (DEBITOS_API_BASE_URL ausente)');
    }
    const base = config.debitosApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/debitos?cpf=${encodeURIComponent(cpf)}&ligacaoId=${encodeURIComponent(ligacaoId)}`;
    return url;
}
/**
 * Busca débitos por CPF e ligacaoId (legado - mantido para retrocompatibilidade)
 * Se a Link API estiver configurada, usa o imovelId da ligação
 */
export async function fetchDebitosByLigacao(config, params) {
    const { cpf, ligacaoId } = params;
    // Converte imovelId para número se necessário
    let imovelIdNum;
    if (params.imovelId !== undefined && params.imovelId !== null) {
        imovelIdNum = typeof params.imovelId === 'number' ? params.imovelId : parseInt(String(params.imovelId), 10);
        if (isNaN(imovelIdNum))
            imovelIdNum = undefined;
    }
    // Se não temos imovelId mas temos ligacaoId numérico, usa como imovelId
    if (!imovelIdNum && ligacaoId && /^\d+$/.test(ligacaoId)) {
        imovelIdNum = parseInt(ligacaoId, 10);
    }
    // Se temos imovelId e a Link API está configurada, usa ela
    if (imovelIdNum && isLinkApiConfigured(config)) {
        console.log('[debitos] Usando Link API com imovelId:', imovelIdNum);
        return fetchDebitosByImovelId(config, imovelIdNum);
    }
    console.log('[debitos] Link API não usada. imovelId:', imovelIdNum, 'isConfigured:', isLinkApiConfigured(config));
    // API legada de débitos
    if (!config.debitosApiBaseUrl) {
        throw new Error('API de débitos não configurada (DEBITOS_API_BASE_URL ou LINK_API ausente)');
    }
    const url = buildDebitosUrl(config, cpf || '', ligacaoId);
    const headers = { 'Content-Type': 'application/json' };
    if (config.debitosApiToken) {
        headers['Authorization'] = `Bearer ${config.debitosApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Falha ao buscar débitos: ${res.status} ${bodyText}`);
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
    const debitos = rawList.map((item, index) => {
        const idFatura = (item && (item.idFatura || item.faturaId || item.numeroFatura || item.nossoNumero || item.id)) ||
            String(index + 1);
        const mesAnoReferencia = (item && (item.mesAnoReferencia || item.referencia || item.mesAno || item.mes_ano)) ||
            '';
        const dataVencimento = (item && (item.dataVencimento || item.vencimento || item.data_vencimento)) ||
            '';
        const valorRaw = (item && (item.valor || item.valorFatura || item.valor_total || item.total)) ||
            0;
        const valor = Number(valorRaw) || 0;
        const emDebitoAutomatico = Boolean(item && (item.emDebitoAutomatico || item.debitoAutomatico || item.debito_automatico || item.automaticDebit));
        const linhaDigitavel = (item && (item.linhaDigitavel || item.linha_digitavel || item.codigoBarras || item.codigo_barras)) ||
            '';
        const status = (item && (item.status || item.situacao || item.situacao_fatura)) ||
            undefined;
        const urlFatura = (item && (item.urlFatura || item.url_fatura || item.urlBoleto || item.url_boleto || item.pdfUrl || item.pdf_url)) ||
            undefined;
        return {
            idFatura: String(idFatura),
            mesAnoReferencia: String(mesAnoReferencia),
            dataVencimento: String(dataVencimento),
            valor,
            emDebitoAutomatico,
            linhaDigitavel: String(linhaDigitavel),
            status: status ? String(status) : undefined,
            urlFatura: urlFatura ? String(urlFatura) : undefined
        };
    });
    return debitos;
}
