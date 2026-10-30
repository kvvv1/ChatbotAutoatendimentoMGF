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

  domainKeywords: [
    { palavrasChave: ['dívida', 'divida', 'inadimpl', 'devedor', 'débito', 'debito'],
      suggestions: ['liste os 10 maiores devedores com endereço', 'qual a dívida vencida por bairro?', 'quantos imóveis têm mais de 3 contas vencidas?'] },
    { palavrasChave: ['arrecad', 'pagamento', 'pago', 'boleto'],
      suggestions: ['compare a arrecadação com o faturamento por mês', 'qual a arrecadação por forma de pagamento?'] },
    { palavrasChave: ['consumo', 'leitura', 'hidrômetro', 'hidrometro', 'm³', 'm3'],
      suggestions: ['quais ocorrências de leitura foram mais frequentes no último mês?', 'quais imóveis tiveram consumo muito acima da média?'] },
    { palavrasChave: ['ordem de serviço', 'ordens de serviço', ' os ', 'corte', 'religação', 'religacao'],
      suggestions: ['qual a OS pendente mais antiga de cada tipo?', 'quantas OS foram executadas por mês em 2026?'] }
  ]
});
