# 📊 FRAGA DASHBOARD - CONTEXT.md

## 📋 INFORMAÇÕES GERAIS

- **Projeto:** Fraga Dashboard - Sistema de Gestão Contábil com NFS-e
- **Ambiente:** Hetzner Cloud (5.78.190.95)
- **Domínio:** dashboard.fragacontabilidade.com.br
- **Data de Atualização:** 17 de março de 2026
- **Status:** Em desenvolvimento
- **Responsável:** Equipe Fraga Contabilidade

---

## 🏗️ STACK TECNOLÓGICO

### Backend
- **Runtime:** Node.js 22.13.0
- **Framework:** Express.js 4
- **Banco de Dados:** MySQL/TiDB
- **ORM:** Drizzle 0.44.5
- **API RPC:** tRPC 11.6.0
- **Autenticação:** Manus OAuth
- **Job Scheduler:** node-cron
- **HTTP Client:** Axios
- **Serialização:** SuperJSON 1.13.3
- **Autenticação JWT:** jose 6.1.0

### Frontend
- **Framework:** React 19
- **Build Tool:** Vite
- **Styling:** Tailwind CSS 4
- **UI Components:** shadcn/ui
- **Routing:** wouter
- **State Management:** React Query (TanStack Query)
- **Client RPC:** @trpc/react-query

### Infraestrutura
- **Reverse Proxy:** Nginx
- **SSL:** Let's Encrypt
- **Process Manager:** PM2
- **Autenticação Nginx:** Basic Auth
- **Storage:** AWS S3 (@aws-sdk/client-s3)

---

## 📁 ESTRUTURA DE PASTAS

```
fraga-dashboard/
├── client/                          # Frontend React
│   ├── public/                      # Arquivos estáticos
│   ├── src/
│   │   ├── _core/hooks/            # Hooks customizados (useAuth)
│   │   ├── components/             # Componentes reutilizáveis
│   │   │   ├── DashboardLayout.tsx
│   │   │   ├── AIChatBox.tsx
│   │   │   └── Map.tsx
│   │   ├── pages/                  # Páginas da aplicação
│   │   ├── lib/                    # Utilitários (trpc.ts)
│   │   ├── contexts/               # React Contexts
│   │   ├── App.tsx                 # Roteamento principal
│   │   ├── main.tsx                # Entry point
│   │   └── index.css               # Estilos globais
│   └── index.html
│
├── server/                          # Backend Node.js
│   ├── _core/                      # Framework core (não editar)
│   │   ├── index.ts                # Servidor Express principal
│   │   ├── context.ts              # Contexto tRPC
│   │   ├── trpc.ts                 # Configuração tRPC
│   │   ├── oauth.ts                # Autenticação OAuth
│   │   ├── llm.ts                  # Integração LLM
│   │   ├── imageGeneration.ts      # Geração de imagens
│   │   ├── voiceTranscription.ts   # Transcrição de áudio
│   │   ├── map.ts                  # Integração Google Maps
│   │   ├── notification.ts         # Notificações do owner
│   │   ├── dataApi.ts              # Data API
│   │   ├── env.ts                  # Variáveis de ambiente
│   │   └── vite.ts                 # Integração Vite
│   │
│   ├── routes/                     # Rotas customizadas
│   │   ├── zapcontabilWebhookMessageSetor.ts
│   │   ├── zapcontabilWebhookNfse.ts
│   │   ├── zapcontabilWebhookTag.ts
│   │   ├── zapcontabilWebhookMessageTag.ts
│   │   └── webhookDebug.ts
│   │
│   ├── webhooks/                   # Webhooks de integração
│   │   ├── zapContabilWebhook.ts
│   │   └── contaAzulWebhook.ts
│   │
│   ├── jobs/                       # Jobs agendados (cron)
│   │   ├── ReguaJob.ts             # Régua de cobrança
│   │   ├── SyncPaymentsJob.ts      # Sincronização de pagamentos
│   │   └── DispatchJob.ts          # Disparo de mensagens
│   │
│   ├── services/                   # Serviços de negócio
│   │   ├── nfseFlowStateMachine.ts # Máquina de estados NFS-e
│   │   ├── clientIdentificationService.ts
│   │   ├── whatsappService.ts
│   │   └── zapContabilService.ts
│   │
│   ├── handlers/                   # Handlers de eventos
│   ├── collection/                 # Sistema de cobrança
│   ├── contaAzul/                  # Integração Conta Azul
│   ├── zap/                        # Integração ZapContábil
│   ├── routers.ts                  # Routers tRPC principais
│   ├── db.ts                       # Query helpers do banco
│   ├── storage.ts                  # Helpers S3
│   └── auth.logout.test.ts         # Testes de autenticação
│
├── drizzle/                        # Migrações e schema
│   ├── schema.ts                   # Definição de tabelas
│   ├── relations.ts                # Relações entre tabelas
│   ├── migrations/                 # Arquivos de migração
│   └── meta/
│
├── shared/                         # Código compartilhado
│   ├── _core/
│   ├── types.ts                    # Tipos TypeScript
│   └── const.ts                    # Constantes
│
├── storage/                        # Helpers S3
│   └── nfse/                       # Armazenamento NFS-e
│
├── docs/                           # Documentação
├── certs/                          # Certificados digitais
├── data/                           # Dados estáticos
├── patches/                        # Patches de dependências
│
├── package.json                    # Dependências do projeto
├── tsconfig.json                   # Configuração TypeScript
├── vite.config.ts                  # Configuração Vite
├── vitest.config.ts                # Configuração testes
├── drizzle.config.ts               # Configuração Drizzle
├── .prettierrc                     # Prettier config
├── .prettierignore
├── .gitignore
└── README.md
```

---

## 🔌 ENDPOINTS PRINCIPAIS

### Webhooks Públicos (sem autenticação)

| Endpoint | Método | Descrição | Origem |
|----------|--------|-----------|--------|
| `/api/webhook/debug` | POST | Debug de webhooks | ZapContábil |
| `/api/webhook/zap-contabil` | POST | Webhook geral ZapContábil | ZapContábil |
| `/api/zapcontabil/webhook-message-setor` | POST | Mensagens em setor específico | ZapContábil |
| `/api/zapcontabil/webhook-nfse` | POST | Webhook de NFS-e | ZapContábil |
| `/api/zapcontabil/tag-nota-fiscal` | POST | Webhook de tag "nota fiscal" | ZapContábil |
| `/api/zapcontabil/webhook-message-tag` | POST | Mensagens com tag | ZapContábil |
| `/api/oauth/callback` | GET | Callback OAuth Manus | Manus |
| `/api/oauth/conta-azul/callback` | GET | Callback Conta Azul | Conta Azul |
| `/ping` | GET | Health check | Monitoramento |
| `/health` | GET | Status do servidor | Monitoramento |

### Endpoints Protegidos (com autenticação)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/admin/*` | * | Rotas administrativas |
| `/api/dashboard/*` | * | Rotas do dashboard |
| `/api/nfse/*` | * | Rotas de NFS-e |
| `/api/zapcontabil/*` | * | Rotas ZapContábil (exceto webhooks) |

---

## 🗄️ BANCO DE DADOS

### Tabelas Principais

#### `zapcontabil_tickets`
Armazena tickets de atendimento do ZapContábil com fluxo de NFS-e.

```sql
CREATE TABLE zapcontabil_tickets (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id VARCHAR(255) UNIQUE,
  phone_e164 VARCHAR(20),
  client_name VARCHAR(255),
  status ENUM('flow_started', 'nfse_issued', 'error'),
  flow_state VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### `clients`
Registro de clientes.

```sql
CREATE TABLE clients (
  id INT PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20),
  name VARCHAR(255),
  cpf_cnpj VARCHAR(20),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `nfse_requests`
Solicitações de emissão de NFS-e.

```sql
CREATE TABLE nfse_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT,
  client_id INT,
  service_description TEXT,
  service_value DECIMAL(10, 2),
  emitter_cnpj VARCHAR(20),
  status ENUM('pending', 'issued', 'error'),
  nfse_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES zapcontabil_tickets(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

---

## 🔄 JOBS AGENDADOS (CRON)

### ReguaJob
**Arquivo:** `server/jobs/ReguaJob.ts`
**Horários:** 09:00 e 14:00 (seg-sex)
**Descrição:** Dispara mensagens de cobrança automática

**Configurações:**
- `REGUA_ENABLED`: true/false
- `REGUA_DAILY_LIMIT`: 50 (mensagens/dia)
- `REGUA_RATE_LIMIT_HOURS`: 12 (horas entre clientes)
- `REGUA_QUIET_HOURS`: 18:00-08:00
- `REGUA_BUSINESS_DAYS_ONLY`: true

### SyncPaymentsJob
**Arquivo:** `server/jobs/SyncPaymentsJob.ts`
**Horário:** A cada 30 minutos
**Descrição:** Sincroniza pagamentos da Conta Azul

### DispatchJob
**Arquivo:** `server/jobs/DispatchJob.ts`
**Horário:** A cada 5 minutos
**Descrição:** Processa fila de disparo de mensagens

---

## 🔐 VARIÁVEIS DE AMBIENTE

### Autenticação & OAuth
```
VITE_APP_ID=<app_id_manus>
VITE_OAUTH_PORTAL_URL=https://login.manus.im
OAUTH_SERVER_URL=https://api.manus.im
OWNER_OPEN_ID=<owner_id>
OWNER_NAME=<owner_name>
JWT_SECRET=<secret_jwt>
```

### Banco de Dados
```
DATABASE_URL=mysql://user:password@host:3306/fraga_dashboard
```

### ZapContábil
```
ZAP_CONTABIL_API_URL=https://api-fraga.zapcontabil.chat
ZAP_CONTABIL_API_KEY=<api_key>
ZAP_CONTABIL_API_BASE=https://api-fraga.zapcontabil.chat
ZAP_CONTABIL_BASE_URL=https://fraga.zapcontabil.chat
ZAP_CONTABIL_USER=<username>
ZAP_CONTABIL_PASS=<password>
ZAP_CONTABIL_BEARER_JWT=<jwt_token>
ZAP_CONTABIL_JRT_COOKIE=<cookie>
```

### Conta Azul
```
CONTA_AZUL_API_TOKEN=<token>
CONTA_AZUL_API_BASE=https://api.contaazul.com
CONTA_AZUL_CLIENT_ID=<client_id>
CONTA_AZUL_CLIENT_SECRET=<client_secret>
CONTA_AZUL_ACCOUNT_ID=<account_id>
CONTA_AZUL_REDIRECT_URI=https://dashboard.fragacontabilidade.com.br/api/oauth/conta-azul/callback
CONTA_AZUL_SCOPE=read,write
CONTA_AZUL_PANEL_EMAIL=<email>
CONTA_AZUL_PANEL_PASSWORD=<password>
```

### WhatsApp & Comunicação
```
WHATSAPP_API_KEY=<api_key>
ALLOW_REAL_SEND=true
ALLOW_CRON_ENABLE=true
```

### Régua de Cobrança
```
REGUA_ENABLED=true
REGUA_DAILY_LIMIT=50
REGUA_RATE_LIMIT_HOURS=12
REGUA_QUIET_HOURS=18:00-08:00
REGUA_BUSINESS_DAYS_ONLY=true
REGUA_ALLOWED_STAGES=financeiro,cobranca
```

### Storage S3
```
STORAGE_PROVIDER=s3
STORAGE_BUCKET=<bucket_name>
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<access_key>
AWS_SECRET_ACCESS_KEY=<secret_key>
STORAGE_PUBLIC_BASE_URL=https://cdn.example.com
```

### LLM & APIs Manus
```
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=<api_key>
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im
VITE_FRONTEND_FORGE_API_KEY=<api_key>
```

### Configurações Gerais
```
VITE_APP_TITLE=Fraga Dashboard
VITE_APP_LOGO=<logo_url>
VITE_ANALYTICS_ENDPOINT=<endpoint>
VITE_ANALYTICS_WEBSITE_ID=<id>
NODE_ENV=production
```

---

## 🔧 CONFIGURAÇÃO NGINX

**Arquivo:** `/etc/nginx/sites-available/fraga-dashboard`

### Rotas Públicas (sem autenticação)
- `/ping`, `/health`
- `/api/ping`, `/api/health`
- `/api/oauth/callback`
- `/api/oauth/conta-azul/callback`
- `/api/webhook/*`
- `/api/zapcontabil/*` (webhooks)

### Rotas Protegidas (Basic Auth)
- `/api/admin/*`
- `/api/dashboard/*`
- `/api/nfse/*`

---

## 📦 DEPENDÊNCIAS PRINCIPAIS

### Backend
```json
{
  "@trpc/server": "^11.6.0",
  "@trpc/client": "^11.6.0",
  "express": "^4.x",
  "drizzle-orm": "^0.44.5",
  "mysql2": "^3.15.0",
  "axios": "^1.x",
  "node-cron": "^3.x",
  "jose": "6.1.0",
  "cookie": "^1.0.2",
  "@aws-sdk/client-s3": "^3.693.0"
}
```

### Frontend
```json
{
  "react": "^19.x",
  "vite": "^latest",
  "tailwindcss": "^4.x",
  "@tanstack/react-query": "^5.90.2",
  "@trpc/react-query": "^11.6.0",
  "wouter": "^latest"
}
```

---

## 🚀 SCRIPTS PRINCIPAIS

```bash
# Desenvolvimento
pnpm dev                    # Inicia servidor em modo watch

# Build
pnpm build                  # Build para produção

# Testes
pnpm test                   # Executa testes com Vitest

# Banco de dados
pnpm db:push               # Aplica migrações Drizzle

# Formatação
pnpm format                # Formata código com Prettier
```

---

## 📋 PENDÊNCIAS ABERTAS

### 🔴 CRÍTICAS
- [ ] Webhook de transferência de setor não dispara automaticamente
- [ ] Payload do ZapContábil precisa ser capturado e mapeado
- [ ] Fluxo de NFS-e não inicia automaticamente ao transferir

### 🟡 IMPORTANTES
- [ ] Implementar notificações no dashboard quando NFS-e é emitida
- [ ] Adicionar validação de CNPJ/CPF
- [ ] Integrar com ZapContábil para emissão automática de NFS-e
- [ ] Criar interface de administração para configurações

### 🟢 MELHORIAS
- [ ] Adicionar logs estruturados (Winston/Pino)
- [ ] Implementar rate limiting nos endpoints
- [ ] Adicionar testes de integração
- [ ] Documentar API com Swagger/OpenAPI
- [ ] Criar dashboard de monitoramento de jobs

---

## 🔍 DEBUGGING

### Ver logs em tempo real
```bash
# SSH no servidor
ssh root@5.78.190.95

# Ver logs do PM2
pm2 logs fraga-dashboard --lines 100

# Ver logs específicos
tail -f ~/.pm2/logs/fraga-dashboard-out.log | grep "SETOR-NF"
```

### Testar webhooks
```bash
curl -X POST https://dashboard.fragacontabilidade.com.br/api/webhook/debug \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

---

## 📞 CONTATOS & RECURSOS

- **Domínio:** dashboard.fragacontabilidade.com.br
- **Servidor:** Hetzner Cloud (5.78.190.95)
- **ZapContábil:** https://fraga.zapcontabil.chat
- **Conta Azul:** https://app.contaazul.com

---

**Última atualização:** 17 de março de 2026
**Versão:** 1.0.0
