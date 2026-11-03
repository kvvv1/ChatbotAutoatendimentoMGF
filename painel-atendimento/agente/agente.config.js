// Configuração da tela do Agente MGF.
// Pode ser sobrescrita pela URL do iframe: ?entidade=...&municipio=...&usuario=...&schema=...
// ou pelo sistema hospedeiro via postMessage({ type: 'agente-iam:contexto', entidade, municipio, usuario, schema }).
window.AGENTE_IAM_CONFIG = Object.freeze({
  sigla: 'MGF',
  sistemaNome: 'SAAE - Água e Esgoto',
  endpoint: 'https://n8n.webcidadao.com.br/webhook/fac26cd6-e470-45b9-8554-8399b0829212',
  // 2ª via de boletos (cartão exibido quando a resposta traz acao.tipo === 'segunda_via')
  boletosEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-boletos',
  segundaViaEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-segunda-via',
  whatsappEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-enviar-whatsapp',
  // Cartões de campo e atendimento (acao.tipo === 'rota_os' | 'chamado_abrir' | 'chamado_consultar')
  rotaOsEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-rota-os',
  chamadoAbrirEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-chamado-abrir',
  chamadoConsultarEndpoint: 'https://n8n.webcidadao.com.br/webhook/mgf-chamado-consultar',
  rotaLimite: 15,
  // Opções do filtro "Tipo de serviço" no cartão de rota (vazio = todos os tipos)
  tiposServicoOs: ['Corte', 'Religação', 'Vazamento', 'Troca de hidrômetro', 'Revisão de leitura', 'Ligação nova', 'Falta d\'água', 'Desobstrução de esgoto'],
  // Tipos aceitos no cartão "Abrir chamado" (valor enviado ao backend + rótulo)
  tiposChamado: [
    { valor: 'vazamento', rotulo: 'Vazamento' },
    { valor: 'falta_agua', rotulo: 'Falta d\'água' },
    { valor: 'religacao', rotulo: 'Religação' },
    { valor: 'revisao_leitura', rotulo: 'Revisão de leitura' },
    { valor: 'outro', rotulo: 'Outro' }
  ],
  // Id anônimo persistente quando o hospedeiro não informa o usuário (formato 'anon-<uuid>')
  usuarioStorageKey: 'mgf-agente-usuario',
  schema: 'gloria',
  entidade: 'SAAE São João Batista do Glória',
  municipio: 'São João Batista do Glória',

  title: 'Agente MGF',
  storageKey: 'mgf-agente-iam',
  welcomeTitle: 'Olá! Sou o Agente MGF',
  welcomeDescription: 'Pergunte sobre ligações, leituras e consumo, contas, arrecadação, inadimplência, parcelamentos e ordens de serviço. Também gero relatórios em PDF e painéis de BI.',

  welcomeSuggestions: [
    { titulo: 'Inadimplência', texto: 'qual a dívida vencida total e quantos imóveis estão inadimplentes?' },
    { titulo: 'Arrecadação', texto: 'qual foi a arrecadação por mês em 2026?' },
    { titulo: 'Consumo', texto: 'compare o consumo medido e faturado em m³ nos últimos 6 meses' },
    { titulo: 'Ordens de serviço', texto: 'quantas ordens de serviço estão pendentes por tipo?' },
    { titulo: 'Relatório PDF', texto: 'gere um relatório em PDF da inadimplência e arrecadação de 2026' },
    { titulo: 'Painel de BI', texto: 'gere um dashboard de BI com indicadores de faturamento e inadimplência' }
  ],

  followUpSuggestions: [
    'liste os 10 maiores devedores com endereço',
    'quanto foi faturado por serviço no último mês?',
    'quantos imóveis existem por situação da ligação e categoria?',
    'agora gere um PDF com essa análise',
    'resuma em tópicos para reunião'
  ],

  // Próximos passos depois de cada resposta, pelo ASSUNTO da conversa.
  // palavrasChave: comparadas sem acento e sem maiúsculas com a pergunta (peso 3) e a resposta (peso 1).
  // acoes: tipos de cartão que indicam o assunto (peso 5).
  // proximos: {bairro}, {matricula}, {protocolo} e {ano} são preenchidos com o que apareceu na conversa;
  // a sugestão é descartada quando o dado não existe.
  assuntos: [
    { id: 'imovel', palavrasChave: ['matricula'], acoes: ['segunda_via'],
      proximos: ['gere a 2ª via dos boletos da matrícula {matricula}', 'qual o histórico de consumo da matrícula {matricula} nos últimos 12 meses?', 'abrir um chamado para a matrícula {matricula}', 'qual o risco de inadimplência da matrícula {matricula}?'] },
    { id: 'inadimplencia', palavrasChave: ['inadimpl', 'devedor', 'divida', 'debito', 'vencid', 'em atraso', 'contas em aberto'],
      proximos: ['qual o risco de inadimplência por faixa?', 'quais os maiores devedores do bairro {bairro}?', 'quais bairros concentram a maior dívida vencida?', 'quantos imóveis têm mais de 3 contas vencidas?', 'liste os 10 maiores devedores com endereço', 'gere um relatório em PDF da inadimplência'] },
    { id: 'arrecadacao', palavrasChave: ['arrecad', 'pagamento', 'recebid', 'pago', 'quitad'],
      proximos: ['qual a previsão de arrecadação para os próximos 3 meses?', 'compare a arrecadação com o faturamento por mês', 'qual a arrecadação por forma de pagamento?', 'qual a arrecadação por bairro em {ano}?'] },
    { id: 'faturamento', palavrasChave: ['fatur', 'tarifa', 'conta de agua', 'contas emitidas', 'servico faturado'],
      proximos: ['simule um reajuste de 5% na tarifa e o impacto no faturamento', 'quanto foi faturado por categoria no último mês?', 'compare o faturamento com a arrecadação por mês'] },
    { id: 'tarifa', palavrasChave: ['simul', 'reajuste', 'tarifa', 'faixa de consumo'],
      proximos: ['simule um reajuste de 8% só na categoria comercial', 'qual o impacto do reajuste por faixa de consumo?', 'quantos imóveis ficam na tarifa mínima?'] },
    { id: 'consumo', palavrasChave: ['consumo', 'leitura', 'hidrometro', 'm3', 'm³', 'medido'],
      proximos: ['quais imóveis tiveram consumo muito acima da média?', 'há indícios de vazamento nos últimos 3 meses?', 'qual o consumo médio do bairro {bairro}?', 'quais ocorrências de leitura foram mais frequentes no último mês?'] },
    { id: 'anomalias', palavrasChave: ['anomalia', 'vazamento', 'consumo atipico', 'acima da media', 'fraude'],
      proximos: ['quais imóveis têm indício de vazamento? priorize as vistorias', 'abrir um chamado de vazamento', 'quais imóveis tiveram consumo zerado por 3 meses seguidos?'] },
    { id: 'previsao', palavrasChave: ['previs', 'projec', 'tendencia', 'proximos meses'],
      proximos: ['qual o risco de inadimplência por faixa?', 'compare a previsão com a arrecadação do mesmo período do ano passado', 'gere um painel de BI com a previsão de arrecadação'] },
    { id: 'risco', palavrasChave: ['risco'],
      proximos: ['quais os maiores devedores do bairro {bairro}?', 'quais imóveis de risco alto têm parcelamento ativo?', 'gere um relatório em PDF do risco de inadimplência'] },
    { id: 'os', palavrasChave: ['ordem de servico', 'ordens de servico', 'as os', 'das os', ' os pendente', 'corte', 'religacao'],
      proximos: ['sugira a rota da equipe para as OS pendentes do bairro {bairro}', 'sugira a rota da equipe para as OS pendentes', 'qual a OS pendente mais antiga de cada tipo?', 'quantas OS foram executadas por mês em {ano}?'] },
    { id: 'rotas', palavrasChave: ['rota', 'roteiro', 'equipe de campo', 'parada'], acoes: ['rota_os'],
      proximos: ['sugira a rota só com as OS de religação', 'quantas OS pendentes existem por bairro?', 'qual a OS pendente mais antiga de cada tipo?'] },
    { id: 'chamados', palavrasChave: ['chamado', 'protocolo', 'reclamac', 'atendimento'], acoes: ['chamado_abrir', 'chamado_consultar'],
      proximos: ['acompanhar o chamado protocolo {protocolo}', 'acompanhar os chamados da matrícula {matricula}', 'quantos chamados foram abertos por tipo neste mês?', 'abrir um novo chamado'] },
    { id: 'relatorios', palavrasChave: ['relatorio', 'pdf', 'dashboard', 'painel de bi', ' bi '],
      proximos: ['resuma em tópicos para reunião', 'gere um dashboard de BI com indicadores de faturamento e inadimplência', 'gere um relatório em PDF da arrecadação de {ano}'] }
  ],

  // Catálogo do autocompletar: perguntas que o agente já responde bem (agrupadas só para organizar).
  catalogoPerguntas: {
    'Débitos': [
      'qual o débito total em aberto da matrícula 1234?',
      'quais contas estão em aberto para a matrícula 1234?',
      'quanto a matrícula 1234 deve com juros e multa?',
      'quais imóveis têm débito acima de R$ 1.000?',
      'quantos imóveis têm débito vencido há mais de 90 dias?'
    ],
    'Inadimplência': [
      'qual a dívida vencida total e quantos imóveis estão inadimplentes?',
      'liste os 10 maiores devedores com endereço',
      'qual a dívida vencida por bairro?',
      'quantos imóveis têm mais de 3 contas vencidas?',
      'qual a taxa de inadimplência por mês em 2026?',
      'qual a inadimplência por categoria de ligação?',
      'quais devedores têm parcelamento ativo?'
    ],
    'Consumo': [
      'compare o consumo medido e faturado em m³ nos últimos 6 meses',
      'qual o consumo médio por categoria?',
      'quais imóveis tiveram consumo muito acima da média?',
      'qual o consumo total por bairro no último mês?',
      'quais imóveis tiveram consumo zerado por 3 meses seguidos?'
    ],
    'Faturamento': [
      'quanto foi faturado por serviço no último mês?',
      'qual foi o faturamento por mês em 2026?',
      'quanto foi faturado por categoria no último mês?',
      'quantas contas foram emitidas no último mês?'
    ],
    'Arrecadação': [
      'qual foi a arrecadação por mês em 2026?',
      'compare a arrecadação com o faturamento por mês',
      'qual a arrecadação por forma de pagamento?',
      'qual a arrecadação por banco ou agente arrecadador?',
      'quanto foi arrecadado hoje?'
    ],
    'Ordens de serviço': [
      'quantas ordens de serviço estão pendentes por tipo?',
      'qual a OS pendente mais antiga de cada tipo?',
      'quantas OS foram executadas por mês em 2026?',
      'qual o tempo médio de execução das OS por tipo?',
      'quantos cortes e religações foram feitos no último mês?'
    ],
    'Leituras': [
      'quais ocorrências de leitura foram mais frequentes no último mês?',
      'quantas leituras faltam na rota deste mês?',
      'quais hidrômetros estão parados ou com leitura não realizada?',
      'qual leiturista fez mais leituras no último mês?'
    ],
    'Ligações': [
      'quantos imóveis ligados existem?',
      'quantos imóveis existem por situação da ligação e categoria?',
      'quantas ligações novas foram feitas em 2026?',
      'quantos imóveis estão cortados por bairro?'
    ],
    '2ª via': [
      'gere a 2ª via dos boletos da matrícula 1234',
      'envie a 2ª via da conta da matrícula 1234 por WhatsApp',
      'qual a linha digitável da última conta da matrícula 1234?'
    ],
    'Relatórios': [
      'gere um relatório em PDF da inadimplência e arrecadação de 2026',
      'gere um relatório em PDF das ordens de serviço pendentes',
      'gere um relatório em PDF do consumo por bairro',
      'resuma em tópicos para reunião'
    ],
    'BI': [
      'gere um dashboard de BI com indicadores de faturamento e inadimplência',
      'gere um painel de BI de arrecadação por mês',
      'gere um painel de BI das ordens de serviço'
    ],
    'Anomalias e vazamentos': [
      'há indícios de vazamento nos últimos 3 meses?',
      'quais imóveis têm consumo atípico em relação ao histórico?',
      'quais imóveis tiveram queda brusca de consumo?',
      'liste possíveis fraudes ou ligações irregulares por consumo'
    ],
    'Previsão de arrecadação': [
      'qual a previsão de arrecadação para os próximos 3 meses?',
      'compare a previsão de arrecadação com o ano passado',
      'qual a tendência de arrecadação até o fim do ano?'
    ],
    'Risco de inadimplência': [
      'qual o risco de inadimplência por faixa?',
      'quais imóveis têm maior risco de ficar inadimplentes?',
      'qual o risco de inadimplência por bairro?'
    ],
    'Simulação de tarifa': [
      'simule um reajuste de 5% na tarifa e o impacto no faturamento',
      'simule um reajuste de 8% só na categoria comercial',
      'qual o impacto do reajuste por faixa de consumo?'
    ],
    'Rotas de campo': [
      'sugira a rota da equipe para as OS pendentes',
      'sugira a rota da equipe para as OS de religação',
      'sugira a rota da equipe para as OS pendentes do bairro Centro',
      'monte o roteiro de cortes para amanhã'
    ],
    'Chamados': [
      'abrir um chamado de vazamento',
      'abrir um chamado de falta d\'água',
      'abrir um chamado de religação',
      'abrir um chamado de revisão de leitura',
      'acompanhar os chamados da matrícula 1234',
      'acompanhar o chamado pelo protocolo',
      'quantos chamados foram abertos por tipo neste mês?'
    ]
  },

  // Modelos com entidades: ao digitar "débito da matrícula 3" o autocompletar sugere
  // "Qual o débito da matrícula 3?". {valor} recebe o que foi digitado depois da entidade.
  // chaves: palavras (sem acento) que colocam o modelo no topo quando aparecem no texto.
  modelosAutocompletar: [
    { entidade: 'matricula', chaves: ['debito', 'divida', 'deve', 'aberto'], modelo: 'Qual o débito da matrícula {valor}?' },
    { entidade: 'matricula', chaves: ['2a via', 'segunda via', 'boleto', 'conta'], modelo: 'Gere a 2ª via dos boletos da matrícula {valor}' },
    { entidade: 'matricula', chaves: ['consumo', 'leitura', 'historico'], modelo: 'Qual o histórico de consumo da matrícula {valor} nos últimos 12 meses?' },
    { entidade: 'matricula', chaves: ['ordem', 'servico', 'as os'], modelo: 'Quais ordens de serviço existem para a matrícula {valor}?' },
    { entidade: 'matricula', chaves: ['abrir', 'chamado', 'vazamento', 'falta', 'religa'], modelo: 'Abrir um chamado para a matrícula {valor}' },
    { entidade: 'matricula', chaves: ['acompanh', 'andamento', 'status', 'situacao'], modelo: 'Acompanhar os chamados da matrícula {valor}' },
    { entidade: 'matricula', chaves: ['risco'], modelo: 'Qual o risco de inadimplência da matrícula {valor}?' },
    { entidade: 'matricula', chaves: ['vazamento', 'anomalia', 'atipico'], modelo: 'O consumo da matrícula {valor} tem indício de vazamento?' },
    { entidade: 'bairro', chaves: ['devedor', 'divida', 'inadimpl', 'debito'], modelo: 'Quais os maiores devedores do bairro {valor}?' },
    { entidade: 'bairro', chaves: ['rota', 'equipe', 'campo', 'pendente'], modelo: 'Sugira a rota da equipe para as OS pendentes do bairro {valor}' },
    { entidade: 'bairro', chaves: ['consumo', 'media'], modelo: 'Qual o consumo médio do bairro {valor} nos últimos 6 meses?' },
    { entidade: 'bairro', chaves: ['vazamento', 'anomalia'], modelo: 'Há indícios de vazamento no bairro {valor}?' },
    { entidade: 'bairro', chaves: ['risco'], modelo: 'Qual o risco de inadimplência no bairro {valor}?' },
    { entidade: 'protocolo', chaves: ['acompanh', 'chamado', 'status'], modelo: 'Acompanhar o chamado protocolo {valor}' },
    { entidade: 'ano', chaves: ['arrecad'], modelo: 'Qual foi a arrecadação por mês em {valor}?' },
    { entidade: 'ano', chaves: ['fatur'], modelo: 'Qual foi o faturamento por mês em {valor}?' },
    { entidade: 'ano', chaves: ['inadimpl'], modelo: 'Qual a taxa de inadimplência por mês em {valor}?' },
    { entidade: 'ano', chaves: ['ordem', 'execut', 'as os'], modelo: 'Quantas OS foram executadas por mês em {valor}?' },
    { entidade: 'ano', chaves: ['relatorio', 'pdf'], modelo: 'Gere um relatório em PDF da inadimplência e arrecadação de {valor}' }
  ]
});
