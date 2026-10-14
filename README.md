## Chatbot de Autoatendimento (WhatsApp + Z-API + Supabase)

### Requisitos
- Node.js 20+
- Conta Supabase (URL e Service Role Key)
- Instância Z-API (base URL, instanceId e token)

### Configuração
1. Copie `docs/env.example` para `.env` e preencha:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ZAPI_BASE_URL`, `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`
2. Instale dependências:
   ```bash
   npm install
   ```
3. Rodar em desenvolvimento:
   ```bash
   npm run dev
   ```
4. Saúde do serviço:
   - `GET /health` → `{ "status": "ok" }`
5. Webhook Z-API:
   - `POST /webhook/zapi` (configure na Z-API)

### Multi-instância (rodando juntas)
- A mesma imagem Docker pode atender varios municipios ao mesmo tempo.
- Crie um arquivo por instancia (`.env.formiga`, `.env.sete-lagoas`, etc.) com portas diferentes.

Para usar o login do registry da DigitalOcean deste projeto, utilize o config local em `.docker/config.json`:
```powershell
$env:DOCKER_CONFIG = "$PWD/.docker"
docker pull registry.digitalocean.com/seu-registry/sua-imagem:tag
```

Exemplo (PowerShell), subindo duas instancias simultaneas:
```powershell
$env:ENV_FILE = ".env.formiga"
docker compose --project-name chatbot-formiga up -d --build

$env:ENV_FILE = ".env.sete-lagoas"
docker compose --project-name chatbot-sete-lagoas up -d --build
```

Observacoes:
- Cada `.env.*` precisa ter `PORT` diferente para evitar conflito.
- O `container_name` ja usa `MUNICIPIO`, entao cada instancia fica identificada por municipio.

### Funcionalidades exclusivas de Sete Lagoas

Configure `MUNICIPIO=7lagoas` ou `MUNICIPIO=sete-lagoas` no arquivo de ambiente da instância para habilitar as mesmas funcionalidades. Preserve o identificador já usado no servidor, assim como o nome do container e o projeto Compose:

- Após finalizar no painel, uma nova mensagem comum (por exemplo, “oi”) volta ao autoatendimento e mantém o ticket como `finalizado`. Ao escolher “Falar com atendente” no menu, dentro do horário de atendimento, o último ticket finalizado é reaberto como `pendente`, preservando o histórico e o responsável. Atendimentos cancelados não são reabertos; uma nova solicitação cria outro ticket. O bot permanece silenciado enquanto há atendimento humano pendente ou em andamento.
- Opção `6️⃣ Finalizar sessão` no menu, que limpa a identificação e o imóvel selecionado e solicita uma nova identificação.
- Orientação sobre proteção de dados (LGPD) e contato com o SAC 115 quando as tentativas de identificação se esgotam, inclusive na confirmação do CPF. Em Sete Lagoas, cada pergunta permite três tentativas: o primeiro e o segundo erros permitem tentar novamente; o terceiro erro mostra a orientação e encerra a validação. A próxima pergunta também começa com três tentativas. As demais cidades mantêm o limite anterior de duas tentativas. A seleção aceita o ID do botão, o rótulo da opção ou o número correspondente ao fallback em texto.
- Atendimento humano parametrizado por ambiente, com padrão de segunda a sexta, das 08:00 às 16:30, e aos sábados, das 07:00 às 18:30, no fuso `America/Sao_Paulo`. Domingo permanece fechado. A mensagem de horário é gerada pela mesma configuração.
- Busca de conversas em destaque no painel (ACC-5333), por nome sem distinção de acentos ou por telefone com ou sem formatação, DDD, código 55 e nono dígito. O telefone aparece formatado nos resultados. A opção “Buscar em todas as conversas” remove os filtros de status e operador, preservando o texto pesquisado.

Instâncias com outro `MUNICIPIO`, ou sem essa variável, mantêm os fluxos anteriores. A regra se aplica aos webhooks Z-API, Meta e Evolution; não registra uma nova rota de Evolution no servidor.

Validação local: `npm test` executa testes de fluxo e de rotas com persistência simulada, sem enviar mensagens reais; `npm run build` compila o projeto.

O modelo sem credenciais em `deploy/sete-lagoas.env.example` contém as variáveis de horário. Acrescente esses valores ao `.env` completo já usado pelo container no servidor. `BUSINESS_SATURDAY_ENABLED=false` desabilita os sábados. O `.env` operacional não é enviado ao GitHub nem incorporado à imagem.

O workflow `docker-build.yml` valida os testes, compila e publica a imagem em pushes para `formiga` e `main`. Além de `latest`, cada publicação gera a tag `sha-<commit completo>`. Para atualizar apenas Sete Lagoas, configure `CHATBOT_IMAGE=registry.digitalocean.com/gestcom/chatbot:sha-<commit>` no ambiente dessa instância.

Após ajustar o `.env`, recrie o container para carregar os valores novos. No servidor, usando o nome de arquivo e projeto já existentes:

```bash
ENV_FILE=.env.sete-lagoas docker compose --env-file .env.sete-lagoas --project-name chatbot-sete-lagoas pull
ENV_FILE=.env.sete-lagoas docker compose --env-file .env.sete-lagoas --project-name chatbot-sete-lagoas up -d --force-recreate
```

`pull` baixa a imagem; a recriação é necessária para trocar a versão em execução. Para conferir o commit da imagem e a identificação da instância, sem exibir credenciais:

```bash
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' chatbot-sete-lagoas
docker exec chatbot-sete-lagoas printenv MUNICIPIO
```

Use o nome real do container nesses comandos (por exemplo, `chatbot`). O primeiro comando deve retornar o commit correspondente à tag `sha-<commit>` selecionada; o segundo deve retornar `7lagoas` ou `sete-lagoas`.

### Netlify por instancia
- O painel agora gera `painel-atendimento/config.js` no build com `PANEL_API_BASE_URL`.
- Em cada site Netlify (um por municipio), configure:
  - `PANEL_API_BASE_URL=https://chatbot.formiga.sistemagestcom.com.br` (exemplo)
- Build command do Netlify: `npm run build:netlify`.
- Assim o mesmo codigo do painel aponta para APIs diferentes sem alterar fonte.

### Supabase (migrar schema)
- Com Supabase CLI: copie `supabase/` e rode:
  ```bash
  supabase db push
  ```
- Ou, via Dashboard: cole o conteúdo de `supabase/migrations/0001_init.sql` no SQL Editor e execute.

### Estrutura
```
src/
  server.ts            # bootstrap Fastify
  config.ts            # carregamento de env
  supabase/client.ts   # cliente admin supabase
  supabase/audit.ts    # utilitário de auditoria
  supabase/sessionStore.ts # store de sessão no Supabase
  state/session.ts     # tipos e armazenamento de sessão (FSM)
  zapi/
    client.ts          # cliente Z-API (envio)
    webhook.ts         # rota de webhook (recepção)
db/
  schema.sql           # schema inicial das tabelas
docs/
  env.example          # exemplo de variáveis de ambiente
supabase/
  config.toml
  migrations/
    0001_init.sql
```

### Próximos passos
- Persistir sessão no Supabase (`sessions`) e implementar FSM dos fluxos.
- Implementar integração com SGC/Agência Virtual para login (CPF, e-mail, OTP).
- Implementar listagem de ligações, débitos, 2ª via/fatura (PDF/linha digitável), serviços (religação), acompanhamentos, leituras, dados cadastrais.
- Auditoria de todas as ações em `audit_logs`.


