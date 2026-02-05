# APIs necessárias para o Chatbot de Autoatendimento

Este documento lista os **fluxos e subfluxos** do bot e as **APIs HTTP** necessárias para que tudo funcione em ambiente real (sem mock), com as respectivas variáveis de ambiente.

---

## 1. Login (CPF + e-mail + OTP)

Fluxo inicial de autenticação do usuário.

### 1.1. Verificar cliente por CPF
- **Função no código**: `fetchClienteByCpf`
- **Arquivo**: `src/company/cliente.ts`
- **Variáveis .env**:
  - `CLIENTE_API_BASE_URL`
  - `CLIENTE_API_TOKEN` (opcional)
- **Endpoint HTTP** sugerido:
  - `GET {CLIENTE_API_BASE_URL}/cliente?cpf={CPF}`

### 1.2. Envio e validação de OTP
- **Funções**: `createAndSendOtp`, `verifyOtp`
- **Arquivos**: `src/otp/service.ts`, `src/email/smtp.ts`
- **APIs externas da concessionária**: **não há**.
- **Infra necessária**:
  - SMTP para envio de e-mail (já parametrizado):
    - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  - Banco (Supabase) para armazenar OTP:
    - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Fluxo "Minhas ligações" (Menu 1)

Usado para listar instalações do CPF e exibir dados cadastrais ao selecionar uma ligação.

### 2.1. Listar ligações por CPF
- **Função**: `fetchLigacoesByCpf`
- **Arquivo**: `src/company/ligacoes.ts`
- **Variáveis .env**:
  - `LIGACOES_API_BASE_URL`
  - `LIGACOES_API_TOKEN` (opcional)
  - `LIGACOES_API_MOCK` (se `true`, usa mock e não chama a API)
- **Endpoint HTTP**:
  - `GET {LIGACOES_API_BASE_URL}/ligacoes?cpf={CPF}`

### 2.2. Buscar dados cadastrais da ligação
- **Função**: `fetchDadosCadastraisByLigacao`
- **Arquivo**: `src/company/cadastro.ts`
- **Variáveis .env**:
  - `CADASTRO_API_BASE_URL`
  - `CADASTRO_API_TOKEN` (opcional)
  - `CADASTRO_API_MOCK` (se `true`, usa mock)
- **Endpoint HTTP**:
  - `GET {CADASTRO_API_BASE_URL}/cadastro?cpf={CPF}&ligacaoId={LIGACAO_ID}`

---

## 3. Fluxo "Emissão de 2ª via" (Menu 2)

Consulta faturas/debitos pendentes da ligação selecionada e mostra as informações, incluindo link do PDF.

### 3.1. Listar débitos/faturas da ligação
- **Função**: `fetchDebitosByLigacao`
- **Arquivo**: `src/company/debitos.ts`
- **Variáveis .env**:
  - `DEBITOS_API_BASE_URL`
  - `DEBITOS_API_TOKEN` (opcional)
  - `DEBITOS_API_MOCK` (se `true`, usa mock)
- **Endpoint HTTP**:
  - `GET {DEBITOS_API_BASE_URL}/debitos?cpf={CPF}&ligacaoId={LIGACAO_ID}`
- **Campos importantes esperados no retorno** (podem ter nomes diferentes, o código já tenta mapear):
  - Número da fatura / identificador
  - Mês/ano de referência
  - Data de vencimento
  - Valor
  - Indicador de débito automático
  - Linha digitável ou código de barras
  - URL do PDF da fatura/boleto (`urlFatura` ou equivalente)

> Observação: o bot apenas **consome** a `urlFatura` retornada pela API; ele não gera o PDF.

---

## 4. Fluxo "Solicitar serviços (ex.: religação)" (Menu 4)

Hoje o fluxo implementado é para **religação de água** (pode ser expandido para outros serviços no futuro).

### 4.1. Registrar pedido de religação
- **Função**: `solicitarReligacao`
- **Arquivo**: `src/company/servicos.ts`
- **Variáveis .env**:
  - `SERVICOS_API_BASE_URL`
  - `SERVICOS_API_TOKEN` (opcional)
  - `SERVICOS_API_MOCK` (se `true`, usa mock)
- **Endpoint HTTP**:
  - `POST {SERVICOS_API_BASE_URL}/servicos/religacao`
- **Body JSON enviado** (exemplo):
  ```json
  {
    "cpf": "{CPF}",
    "ligacaoId": "{LIGACAO_ID}",
    "comprovantesInformados": true
  }
  ```
- **Campos importantes esperados no retorno**:
  - `protocolo` (ou `numeroProtocolo`, ou campo equivalente)
  - `status`
  - Opcional: `prazoEstimadoHoras`

---

## 5. Fluxo "Acompanhar solicitações" (Menu 5)

Permite listar serviços recentes de uma ligação e consultar o status detalhado de um protocolo específico.

### 5.1. Listar serviços da ligação
- **Função**: `fetchServicosByLigacao`
- **Arquivo**: `src/company/servicos.ts`
- **Variáveis .env**:
  - `SERVICOS_API_BASE_URL`
  - `SERVICOS_API_TOKEN` (opcional)
  - `SERVICOS_API_MOCK`
- **Endpoint HTTP**:
  - `GET {SERVICOS_API_BASE_URL}/servicos?cpf={CPF}&ligacaoId={LIGACAO_ID}`
- **Campos importantes esperados no retorno**:
  - Protocolo
  - Tipo do serviço (religação, troca de hidrômetro, etc.)
  - Data da solicitação
  - Status atual

### 5.2. Consultar status detalhado de um serviço
- **Função**: `consultarStatusServico`
- **Arquivo**: `src/company/servicos.ts`
- **Variáveis .env**:
  - `SERVICOS_API_BASE_URL`
  - `SERVICOS_API_TOKEN` (opcional)
  - `SERVICOS_API_MOCK`
- **Endpoint HTTP**:
  - `GET {SERVICOS_API_BASE_URL}/servicos/status?cpf={CPF}&protocolo={PROTOCOLO}`
- **Campos importantes esperados no retorno**:
  - `status`
  - Descrição/mensagem (`descricao` ou equivalente)
  - Data/hora da última atualização
  - Previsão de conclusão (se existir)

---

## 6. Fluxo "Histórico de consumo e leituras" (Menu 6)

Consulta o histórico recente de consumo/leituras da ligação selecionada.

### 6.1. Buscar histórico de consumo/leitura
- **Função**: `fetchConsumoByLigacao`
- **Arquivo**: `src/company/consumo.ts`
- **Variáveis .env**:
  - `CONSUMO_API_BASE_URL`
  - `CONSUMO_API_TOKEN` (opcional)
  - `CONSUMO_API_MOCK` (se `true`, usa mock)
- **Endpoint HTTP**:
  - `GET {CONSUMO_API_BASE_URL}/consumo?cpf={CPF}&ligacaoId={LIGACAO_ID}`
- **Campos importantes esperados no retorno** (por item de histórico):
  - Referência (mês/ano)
  - Data da leitura
  - Consumo real (kWh, m³ ou unidade utilizada pela concessionária)
  - Consumo faturado
  - Média de consumo

---

## 7. Outros pontos relevantes (sem API da concessionária)

### 7.1. Vídeo orientativo (Menu 9)
- Usa apenas URL configurada via `.env`:
  - `VIDEO_TUTORIAL_URL`
  - `VIDEO_TUTORIAL_CAPTION`
  - `VIDEO_TUTORIAL_INTRO`

### 7.2. Local de atendimento presencial (Menu 8)
- Usa URL do Google Maps configurada via `.env`:
  - `ATENDIMENTO_MAPS_URL`
  - `ATENDIMENTO_MAPS_TITLE`
  - `ATENDIMENTO_MAPS_DESCRIPTION`

### 7.3. Telefone da entidade para atendimento humano
- Usado em mensagens de erro/cadastro ausente:
  - `ENTIDADE_PHONE_NUMBER`

---

## 8. Resumo rápido para contratação das APIs

Para deixar o chatbot totalmente integrado, a entidade precisa fornecer (ou contratar):

1. **API de Clientes**
   - `GET /cliente?cpf={CPF}`
2. **API de Ligações**
   - `GET /ligacoes?cpf={CPF}`
3. **API de Dados Cadastrais da Ligação**
   - `GET /cadastro?cpf={CPF}&ligacaoId={LIGACAO_ID}`
4. **API de Débitos/Faturas**
   - `GET /debitos?cpf={CPF}&ligacaoId={LIGACAO_ID}`
5. **API de Serviços**
   - `POST /servicos/religacao`
   - `GET /servicos?cpf={CPF}&ligacaoId={LIGACAO_ID}`
   - `GET /servicos/status?cpf={CPF}&protocolo={PROTOCOLO}`
6. **API de Consumo/Leituras**
   - `GET /consumo?cpf={CPF}&ligacaoId={LIGACAO_ID}`

Com esse conjunto de endpoints implementados e as variáveis de ambiente configuradas, o chatbot passa a operar com dados reais de produção, sem depender de mocks.
