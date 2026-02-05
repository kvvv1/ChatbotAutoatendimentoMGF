import { fetch } from 'undici';
// API de serviços ainda não implementada - será integrada futuramente
export async function solicitarReligacao(config, params) {
    const { cpf, ligacaoId, comprovantesInformados } = params;
    if (!config.servicosApiBaseUrl) {
        throw new Error('API de serviços ainda não implementada');
    }
    const base = config.servicosApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/servicos/religacao`;
    const headers = { 'Content-Type': 'application/json' };
    if (config.servicosApiToken) {
        headers['Authorization'] = `Bearer ${config.servicosApiToken}`;
    }
    const body = {
        cpf,
        ligacaoId,
        comprovantesInformados
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Falha ao solicitar religação: ${res.status} ${text}`);
    }
    const json = await res.json().catch(() => null);
    if (!json) {
        throw new Error('Resposta inválida da API de serviços');
    }
    const protocolo = (json && (json.protocolo || json.numeroProtocolo || json.protocolo_religacao || json.id)) ||
        `REL-${new Date().getFullYear()}-${ligacaoId.slice(-4) || '0000'}`;
    const status = (json && (json.status || json.situacao)) || 'REGISTRADA';
    const prazoEstimadoHorasRaw = json && (json.prazoEstimadoHoras || json.prazo_estimado_horas || json.prazoHoras || json.prazo_horas);
    const prazoEstimadoHoras = prazoEstimadoHorasRaw !== undefined && prazoEstimadoHorasRaw !== null
        ? Number(prazoEstimadoHorasRaw) || undefined
        : undefined;
    return {
        protocolo: String(protocolo),
        status: String(status),
        prazoEstimadoHoras
    };
}
export async function fetchServicosByLigacao(config, params) {
    const { cpf, ligacaoId } = params;
    if (!config.servicosApiBaseUrl) {
        throw new Error('API de serviços ainda não implementada');
    }
    const base = config.servicosApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/servicos?cpf=${encodeURIComponent(cpf)}&ligacaoId=${encodeURIComponent(ligacaoId)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (config.servicosApiToken) {
        headers['Authorization'] = `Bearer ${config.servicosApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Falha ao listar serviços: ${res.status} ${text}`);
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
    const servicos = rawList.map((item, index) => {
        const protocolo = (item && (item.protocolo || item.numeroProtocolo || item.id || item.protocolo_servico)) ||
            String(index + 1);
        const tipo = (item && (item.tipo || item.tipoServico || item.tipo_servico || item.descricaoTipo)) ||
            'Serviço';
        const dataSolicitacao = (item && (item.dataSolicitacao || item.data_solicitacao || item.data || item.criadoEm || item.created_at)) ||
            undefined;
        const status = (item && (item.status || item.situacao || item.status_servico)) ||
            undefined;
        return {
            protocolo: String(protocolo),
            tipo: String(tipo),
            dataSolicitacao: dataSolicitacao ? String(dataSolicitacao) : undefined,
            status: status ? String(status) : undefined
        };
    });
    return servicos;
}
export async function consultarStatusServico(config, params) {
    const { cpf, protocolo } = params;
    if (!config.servicosApiBaseUrl) {
        throw new Error('API de serviços ainda não implementada');
    }
    const base = config.servicosApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/servicos/status?cpf=${encodeURIComponent(cpf)}&protocolo=${encodeURIComponent(protocolo)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (config.servicosApiToken) {
        headers['Authorization'] = `Bearer ${config.servicosApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Falha ao consultar status do serviço: ${res.status} ${text}`);
    }
    const json = await res.json().catch(() => null);
    if (!json) {
        throw new Error('Resposta inválida da API de serviços');
    }
    const status = (json && (json.status || json.situacao || json.status_servico)) ||
        'EM_ANDAMENTO';
    const descricao = (json && (json.descricao || json.detalhes || json.mensagem)) ||
        undefined;
    const atualizadoEm = (json && (json.atualizadoEm || json.updated_at || json.atualizado_em)) ||
        undefined;
    const previsao = (json && (json.previsao || json.previsaoConclusao || json.previsao_conclusao || json.previsaoData || json.previsao_data)) ||
        undefined;
    return {
        protocolo: String(protocolo),
        status: String(status),
        descricao: descricao ? String(descricao) : undefined,
        atualizadoEm: atualizadoEm ? String(atualizadoEm) : undefined,
        previsao: previsao ? String(previsao) : undefined
    };
}
