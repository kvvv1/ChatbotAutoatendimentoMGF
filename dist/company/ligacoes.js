import { fetch } from 'undici';
/**
 * Converte imóveis da Link API para o formato Ligacao usado pelo bot
 */
export function imoveisToLigacoes(imoveis) {
    return imoveis.map((imovel, index) => ({
        id: String(imovel.ImovelID),
        imovelId: imovel.ImovelID,
        idEletronico: imovel.IdEletronico?.trim(),
        label: `Imóvel ${imovel.ImovelID}`,
        description: imovel.Endereco
    }));
}
function buildLigacoesUrl(config, cpf) {
    if (!config.ligacoesApiBaseUrl) {
        throw new Error('API de ligações não configurada (LIGACOES_API_BASE_URL ausente)');
    }
    const base = config.ligacoesApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/ligacoes?cpf=${encodeURIComponent(cpf)}`;
    return url;
}
export async function fetchLigacoesByCpf(config, cpf) {
    // API legada de ligações - se não configurada, lança erro
    if (!config.ligacoesApiBaseUrl) {
        throw new Error('API de ligações não configurada (LIGACOES_API_BASE_URL ausente). Use loginByIdEletronico para a Link API.');
    }
    const url = buildLigacoesUrl(config, cpf);
    const headers = { 'Content-Type': 'application/json' };
    if (config.ligacoesApiToken) {
        headers['Authorization'] = `Bearer ${config.ligacoesApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Falha ao buscar ligações: ${res.status} ${bodyText}`);
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
    const ligacoes = rawList.map((item, index) => {
        const id = (item && (item.id || item.ligacaoId || item.idLigacao || item.id_ligacao)) ||
            String(index + 1);
        const numero = (item && (item.numeroInstalacao || item.instalacao || item.codigo || item.codInstalacao)) ||
            '';
        const apelido = (item && (item.apelido || item.nome || item.alias)) || '';
        const enderecoPartes = [];
        if (item) {
            if (item.endereco)
                enderecoPartes.push(String(item.endereco));
            if (item.logradouro)
                enderecoPartes.push(String(item.logradouro));
            if (item.numero)
                enderecoPartes.push(String(item.numero));
            if (item.bairro)
                enderecoPartes.push(String(item.bairro));
            if (item.cidade)
                enderecoPartes.push(String(item.cidade));
            if (item.uf)
                enderecoPartes.push(String(item.uf));
        }
        const labelParts = [];
        if (apelido)
            labelParts.push(apelido);
        if (numero)
            labelParts.push(`Instalação ${numero}`);
        const label = labelParts.length > 0 ? labelParts.join(' - ') : `Ligação ${index + 1}`;
        const description = enderecoPartes.length > 0 ? enderecoPartes.join(', ') : undefined;
        return { id: String(id), label, description };
    });
    return ligacoes;
}
