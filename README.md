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


