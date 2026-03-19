# 📊 CONTEXTO DO PROJETO FRAGA DASHBOARD - DeepSeek

## 🎯 VISÃO GERAL

**Projeto:** Fraga Dashboard  
**Localização:** `/opt/fraga-dashboard`  
**Servidor:** Hetzner Cloud (Ubuntu)  
**Domínio:** dashboard.fragacontabilidade.com.br  
**Status:** Em desenvolvimento e produção  
**Gerenciador de Processo:** PM2

---

## 🏗️ ARQUITETURA DO PROJETO

### Estrutura de Diretórios

```
fraga-dashboard/
├── client/                    # Frontend React + TypeScript
│   ├── src/
│   │   ├── components/       # Componentes React (UI/Shadcn)
│   │   ├── pages/            # Páginas da aplicação
│   │   ├── hooks/            # Custom Hooks
│   │   ├── contexts/         # Context API
│   │   ├── lib/              # Utilitários
│   │   ├── _core/            # Integração tRPC
│   │   ├── App.tsx           # Componente raiz
│   │   ├── main.tsx          # Entry point
│   │   └── index.css          # Tailwind CSS
│   └── public/               # Arquivos estáticos
├── server/                    # Backend Node.js + Express
│   ├── _core/                # Servidor Express + tRPC
│   ├── routers/              # tRPC routers
│   ├── routes/               # Express routes
│   ├── services/             # Lógica de negócio
│   ├── handlers/             # Manipuladores de requisições
│   ├── jobs/                 # Jobs agendados (node-cron)
│   ├── queues/               # Filas de processamento
│   ├── workers/              # Workers de jobs
│   ├── utils/                # Funções utilitárias
│   ├── webhooks/             # Endpoints de webhooks
│   ├── orchestrator/         # Orquestração de processos
│   ├── contaAzul/            # Integração Conta Azul
│   ├── zap/                  # Integração WhatsApp/Zap
│   ├── collection/           # Lógica de cobrança
│   ├── etapa9/               # Etapas de processamento
│   └── test-generators/      # Geradores de dados de teste
├── shared/                    # Código compartilhado
│   └── _core/                # Tipos e utilitários compartilhados
├── drizzle/                   # Migrações e schema do banco
│   ├── migrations/           # Arquivos de migração
│   └── meta/                 # Metadata
├── scripts/                   # Scripts utilitários
├── data/                      # Dados estáticos
├── backups/                   # Backups do projeto
├── certs/                     # Certificados SSL
├── tsconfig.json             # Configuração TypeScript
├── vite.config.ts            # Configuração Vite
├── package.json              # Dependências
└── CONTEXT.md                # Documentação existente
```

---

## 💻 STACK TECNOLÓGICO

### Frontend
- **React 19** - UI Library
- **TypeScript** - Tipagem estática
- **Vite** - Build tool
- **Tailwind CSS 4** - Styling
- **shadcn/ui** - Componentes UI (style: new-york)
- **React Hook Form** - Gerenciamento de formulários
- **Zod** - Validação de schemas
- **React Router** - Roteamento
- **zustand** - State management (alternativa/complemento)
- **axios** - HTTP client
- **date-fns** - Manipulação de datas
- **Chart.js / Recharts** - Gráficos

### Backend
- **Node.js 22.13.0** - Runtime
- **Express.js 4** - Framework HTTP
- **TypeScript** - Tipagem
- **tRPC 11.6.0** - RPC type-safe
- **Drizzle ORM 0.44.5** - ORM
- **MySQL/TiDB** - Banco de dados
- **node-cron** - Job scheduling
- **axios** - HTTP client
- **jose** - JWT handling
- **SuperJSON** - Serialização
- **Playwright** - Automação/Scraping

### Autenticação & Integração
- **Manus OAuth** - Autenticação principal
- **Anthropic Claude API** - IA para análise
- **Conta Azul API** - Integração financeira
- **AWS S3** - Storage
- **2Captcha** - Validação de captchas
- **WhatsApp/Zap** - Comunicação

### DevOps & Ferramentas
- **PM2** - Gerenciador de processos
- **Prettier** - Code formatter
- **vitest** - Unit testing
- **Playwright** - E2E testing

---

## 🚀 COMANDOS PRINCIPAIS

### Desenvolvimento
```bash
npm run dev              # Inicia servidor em modo development (tsx watch)
```

### Build & Deploy
```bash
npm run build            # Build frontend (Vite) + backend (esbuild)
npm start                # Inicia servidor de produção (node dist/index.js)
npm run check            # Verifica tipos TypeScript
npm run format           # Formata código com Prettier
npm run test             # Executa testes com vitest
```

### Banco de Dados
```bash
npm run db:push          # Gera migrações e aplica ao banco
```

### PM2
```bash
pm2 restart fraga-dashboard     # Reinicia aplicação
pm2 logs fraga-dashboard        # Vê logs em tempo real
pm2 logs fraga-dashboard --lines 50 --nostream  # Últimas 50 linhas
pm2 stop fraga-dashboard        # Para aplicação
pm2 start fraga-dashboard       # Inicia aplicação
```

---

## 📂 ARQUITETURA DE CÓDIGO

### tRPC Routers
Os routers tRPC são organizados em `server/routers/` e expostos através de `server/_core/index.ts`:

```typescript
// Exemplo de router tRPC
export const appRouter = t.router({
  user: userRouter,
  emissions: emissionsRouter,
  financial: financialRouter,
  // ...
});
```

### Estrutura Backend
- **Services**: Lógica de negócio isolada
- **Handlers**: Processamento de requisições
- **Jobs**: Tarefas agendadas (cron)
- **Routers**: Endpoints tRPC
- **Utils**: Funções auxiliares reutilizáveis

### Estrutura Frontend
- **Pages**: Páginas da aplicação
- **Components**: Componentes React reutilizáveis
- **Hooks**: Custom hooks (useQuery, useMutation, etc)
- **Contexts**: Estado compartilhado (Auth, etc)
- **lib**: Utilitários e helpers

---

## 🗄️ BANCO DE DADOS

### ORM: Drizzle
- **Arquivo Schema:** `drizzle/schema.ts` (geralmente)
- **Migrações:** `drizzle/migrations/`
- **Comandos:**
  - `npm run db:push` - Gera e aplica migrações

### Banco de Dados
- **MySQL/TiDB**
- **Autenticação:** via `.env`
- **Variáveis de Ambiente:**
  - `DATABASE_URL` - Connection string

---

## 🔐 VARIÁVEIS DE AMBIENTE

### Cliente (.env)
```
VITE_API_URL=http://localhost:3000
VITE_ENV=development
```

### Servidor (.env)
```
NODE_ENV=production
DATABASE_URL=mysql://user:password@host/database
JWT_SECRET=sua_chave_secreta
ANTHROPIC_API_KEY=sk-ant-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
CONTA_AZUL_API_KEY=...
MANUS_OAUTH_CLIENT_ID=...
MANUS_OAUTH_CLIENT_SECRET=...
PORT=3000
```

---

## 🔄 FLUXO DE DESENVOLVIMENTO

### 1. Desenvolvimento Local
```bash
npm install                  # Instala dependências
npm run dev                  # Inicia servidor em watch mode
# Em outro terminal:
cd client && npm run dev     # Inicia Vite dev server (opcional)
```

### 2. Build & Teste
```bash
npm run check                # Verifica tipos
npm run format               # Formata código
npm run test                 # Executa testes
npm run build                # Build para produção
```

### 3. Deploy com PM2
```bash
npm run build                # Build
pm2 restart fraga-dashboard  # Reinicia com novo build
pm2 logs fraga-dashboard     # Verifica logs
```

---

## 📊 FUNCIONALIDADES PRINCIPAIS

1. **Dashboard Analytics**
   - Gráficos em tempo real
   - Métricas de emissões
   - Análise financeira

2. **Integração IA (Claude)**
   - Análise automática de dados
   - Insights financeiros
   - Processamento de documentos

3. **Sistema de Cobrança**
   - Integração Conta Azul
   - Gestão de boletos
   - Rastreamento de pagamentos
   - Orquestração de cobranças (etapas)

4. **Comunicação**
   - Integração WhatsApp (Zap)
   - Notificações automáticas
   - Webhooks

5. **Autenticação**
   - OAuth via Manus
   - JWT tokens
   - Gestão de sessão

6. **Armazenamento**
   - AWS S3 para arquivos
   - Presigned URLs

---

## 🛠️ GUIA PRÁTICO

### Adicionar Nova Rota tRPC
```typescript
// server/routers/novoRouter.ts
export const novoRouter = t.router({
  get: t.procedure.query(async () => {
    // lógica
  }),
  create: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      // lógica
    }),
});

// Registrar em server/_core/index.ts
export const appRouter = t.router({
  novo: novoRouter,
  // ...
});
```

### Consumir no Frontend
```typescript
import { trpc } from '@/_core/trpc';

function Component() {
  const { data } = trpc.novo.get.useQuery();
  const create = trpc.novo.create.useMutation();
  
  return (
    <button onClick={() => create.mutate({ name: 'test' })}>
      Criar
    </button>
  );
}
```

### Agendar Job
```typescript
// server/jobs/meuJob.ts
import cron from 'node-cron';

export function startMeuJob() {
  cron.schedule('0 0 * * *', async () => {
    // Executado diariamente à meia-noite
  });
}

// Registrar em server/_core/index.ts
startMeuJob();
```

---

## 🐛 TROUBLESHOOTING

### Build falha
```bash
rm -rf dist node_modules/.vite
npm install
npm run build
```

### Tipos não funcionam
```bash
npm run check               # Identifica erros de tipo
tsc --noEmit                # Verifica tipos
```

### PM2 não reconhece mudanças
```bash
npm run build
pm2 restart fraga-dashboard --force
pm2 logs fraga-dashboard --lines 100 --nostream
```

### Banco de dados não conecta
- Verificar `DATABASE_URL` no `.env`
- Testar conexão: `drizzle-kit check`
- Aplicar migrações: `npm run db:push`

---

## 📝 CONVENTIONS

### Naming
- Componentes React: PascalCase (MyComponent.tsx)
- Funções/Variáveis: camelCase (myFunction, myVariable)
- Constantes: UPPER_SNAKE_CASE (MY_CONSTANT)
- Routers: camelCase (userRouter, userRoutes)

### File Structure
- Um componente = Um arquivo (prefira)
- Componentes reutilizáveis em `components/`
- Componentes específicos de página em `components/pages/`
- Tipos compartilhados em `shared/`

### TypeScript
- Sempre use `export type` para tipos
- Use `z.object()` para validação
- Tipifique argumentos de funções

---

## 🎓 RECURSOS ÚTEIS

- **tRPC Docs:** https://trpc.io/docs
- **Drizzle Docs:** https://orm.drizzle.team
- **Tailwind CSS:** https://tailwindcss.com/docs
- **shadcn/ui:** https://ui.shadcn.com
- **React Docs:** https://react.dev
- **TypeScript:** https://www.typescriptlang.org/docs

---

## 📞 CONTATO & SUPORTE

- **Projeto:** Fraga Contabilidade
- **Responsável:** Equipe DevOps
- **Última Atualização:** Março 2025

---

**Este documento é auto-gerado e serve como referência rápida para novos desenvolvedores e automações.**
