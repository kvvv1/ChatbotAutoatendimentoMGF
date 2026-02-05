import { fetch } from 'undici';
import { linkGetDadosCadastrais, isLinkApiConfigured } from './linkApi.js';
/**
 * Converte dados cadastrais da Link API para o formato usado pelo bot
 */
function linkDadosToDadosCadastrais(dados) {
    // Extrai categoria principal (primeira da lista)
    const categoriaStr = dados.Categorias && dados.Categorias.length > 0
        ? dados.Categorias[0].Categoria
        : undefined;
    return {
        nomeTitular: dados.Nome,
        idEletronico: dados.IDEletronico,
        numeroHidrometro: dados.Hidrometro,
        situacaoAbastecimento: dados.DescricaoSituacao,
        servicosContratados: dados.DescricaoServico ? [dados.DescricaoServico] : undefined,
        enderecoImovel: dados.Endereco,
        enderecoCorrespondencia: dados.EnderecoCorrespondencia,
        categoria: categoriaStr,
        dataAtivacao: dados.DataLigacao?.split('T')[0],
        dataInstalacao: dados.DataInstalacao?.split('T')[0]
    };
}
/**
 * Busca dados cadastrais por ImovelID usando a Link API
 */
export async function fetchDadosCadastraisByImovelId(config, imovelId) {
    if (!isLinkApiConfigured(config)) {
        throw new Error('Link API não configurada (LINK_API_BASE_URL e LINK_API_TOKEN ausentes)');
    }
    const linkDados = await linkGetDadosCadastrais(config, imovelId);
    return linkDadosToDadosCadastrais(linkDados);
}
function buildCadastroUrl(config, cpf, ligacaoId) {
    if (!config.cadastroApiBaseUrl) {
        throw new Error('API de dados cadastrais não configurada (CADASTRO_API_BASE_URL ausente)');
    }
    const base = config.cadastroApiBaseUrl.replace(/\/+$/, '');
    const url = `${base}/cadastro?cpf=${encodeURIComponent(cpf)}&ligacaoId=${encodeURIComponent(ligacaoId)}`;
    return url;
}
/**
 * Busca dados cadastrais por CPF e ligacaoId (legado - mantido para retrocompatibilidade)
 * Se a Link API estiver configurada, usa o imovelId da ligação
 */
export async function fetchDadosCadastraisByLigacao(config, params) {
    const { cpf, ligacaoId, imovelId } = params;
    // Se temos imovelId e a Link API está configurada, usa ela
    if (imovelId && isLinkApiConfigured(config)) {
        return fetchDadosCadastraisByImovelId(config, imovelId);
    }
    // API legada de cadastro
    if (!config.cadastroApiBaseUrl) {
        throw new Error('API de cadastro não configurada (CADASTRO_API_BASE_URL ou LINK_API ausente)');
    }
    const url = buildCadastroUrl(config, cpf || '', ligacaoId);
    const headers = { 'Content-Type': 'application/json' };
    if (config.cadastroApiToken) {
        headers['Authorization'] = `Bearer ${config.cadastroApiToken}`;
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Falha ao buscar dados cadastrais: ${res.status} ${bodyText}`);
    }
    const json = await res.json().catch(() => null);
    if (!json)
        return null;
    const fonte = json && (json.dados || json.data || json.cadastro || json) || {};
    const numeroLigacao = fonte.numeroLigacao || fonte.numero_ligacao || fonte.ligacaoId || fonte.idLigacao || fonte.id_ligacao;
    const nomeTitular = fonte.nomeTitular || fonte.titular || fonte.nome || fonte.nome_cliente;
    const numeroHidrometro = fonte.numeroHidrometro || fonte.hidrometro || fonte.num_hidrometro || fonte.medidor;
    const situacaoAbastecimento = fonte.situacaoAbastecimento || fonte.situacao || fonte.statusAbastecimento || fonte.status_abastecimento;
    const servicosContratadosRaw = fonte.servicosContratados || fonte.servicos || fonte.servicos_contratados || fonte.tipos_servico;
    let servicosContratados;
    if (Array.isArray(servicosContratadosRaw)) {
        servicosContratados = servicosContratadosRaw.map((s) => String(s));
    }
    else if (typeof servicosContratadosRaw === 'string') {
        servicosContratados = servicosContratadosRaw.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    }
    const enderecoImovel = fonte.enderecoImovel || fonte.endereco_imovel || fonte.endereco || fonte.enderecoInstalacao;
    const enderecoCorrespondencia = fonte.enderecoCorrespondencia || fonte.endereco_correspondencia || fonte.enderecoCobranca;
    const categoria = fonte.categoria || fonte.classe || fonte.tipoLigacao || fonte.tipo_ligacao;
    const dataAtivacao = fonte.dataAtivacao || fonte.data_ativacao || fonte.ativacaoData || fonte.dataLigacao || fonte.data_ligacao;
    return {
        numeroLigacao: numeroLigacao ? String(numeroLigacao) : undefined,
        nomeTitular: nomeTitular ? String(nomeTitular) : undefined,
        numeroHidrometro: numeroHidrometro ? String(numeroHidrometro) : undefined,
        situacaoAbastecimento: situacaoAbastecimento ? String(situacaoAbastecimento) : undefined,
        servicosContratados,
        enderecoImovel: enderecoImovel ? String(enderecoImovel) : undefined,
        enderecoCorrespondencia: enderecoCorrespondencia ? String(enderecoCorrespondencia) : undefined,
        categoria: categoria ? String(categoria) : undefined,
        dataAtivacao: dataAtivacao ? String(dataAtivacao) : undefined
    };
}
