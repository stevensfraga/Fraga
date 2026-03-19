# 🔧 CHECKLIST DE INTEGRAÇÃO - MELHORIAS /NFSE

## 📋 Pré-requisitos

- [ ] Node.js 18+ instalado
- [ ] PM2 rodando
- [ ] Banco de dados acessível
- [ ] Ambiente staging disponível
- [ ] Git branch main limpo

---

## 🔄 FASE 1: PREPARAÇÃO (1 dia)

### Dependências
```bash
cd /opt/fraga-dashboard
npm install recharts zustand date-fns react-day-picker xlsx papaparse
npm list recharts zustand  # Verificar instalação
```

### Branches & Git
```bash
git checkout -b feat/nfse-improvements
git pull origin main
git status  # Confirmar estado limpo
```

### Backup
```bash
cp -r client/src/pages client/src/pages.backup.$(date +%s)
cp -r client/src/components client/src/components.backup.$(date +%s)
```

---

## 🎯 FASE 2: INTEGRAÇÃO DE COMPONENTES (3 dias)

### Step 1: Copiar AdvancedFilters.tsx

```bash
cat > /opt/fraga-dashboard/client/src/components/NfseAdvancedFilters.tsx << 'COMPONENT'
[Conteúdo do AdvancedFilters.tsx aqui]
COMPONENT

# Verificar se foi criado
ls -la /opt/fraga-dashboard/client/src/components/NfseAdvancedFilters.tsx
```

**Checklist:**
- [ ] Arquivo criado
- [ ] Sem erros de sintaxe
- [ ] Imports corretos
- [ ] Tipos exportados

### Step 2: Copiar NfseAnalytics.tsx

```bash
cat > /opt/fraga-dashboard/client/src/components/NfseAnalytics.tsx << 'COMPONENT'
[Conteúdo do NfseAnalytics.tsx aqui]
COMPONENT

# Verificar se foi criado
ls -la /opt/fraga-dashboard/client/src/components/NfseAnalytics.tsx
```

**Checklist:**
- [ ] Arquivo criado
- [ ] Recharts importado corretamente
- [ ] Sem erros de compilação

### Step 3: Criar Zustand Store

```bash
cat > /opt/fraga-dashboard/client/src/store/nfseBulkStore.ts << 'STORE'
import { create } from 'zustand';

export interface NfseBulkStore {
  selectedIds: number[];
  toggleSelect: (id: number) => void;
  selectAll: (ids: number[]) => void;
  deselectAll: () => void;
  isSelected: (id: number) => boolean;
  getSelectedCount: () => number;
}

export const useNfseBulkStore = create<NfseBulkStore>((set, get) => ({
  selectedIds: [],
  
  toggleSelect: (id: number) => {
    const current = get().selectedIds;
    set({
      selectedIds: current.includes(id)
        ? current.filter(i => i !== id)
        : [...current, id],
    });
  },
  
  selectAll: (ids: number[]) => set({ selectedIds: ids }),
  deselectAll: () => set({ selectedIds: [] }),
  
  isSelected: (id: number) => get().selectedIds.includes(id),
  getSelectedCount: () => get().selectedIds.length,
}));
STORE

# Verificar
ls -la /opt/fraga-dashboard/client/src/store/nfseBulkStore.ts
```

**Checklist:**
- [ ] Store criado
- [ ] Tipos corretos
- [ ] Métodos implementados

### Step 4: Atualizar NfseDashboard.tsx

```bash
# Backup do original
cp /opt/fraga-dashboard/client/src/pages/NfseDashboard.tsx \
   /opt/fraga-dashboard/client/src/pages/NfseDashboard.tsx.backup

# Editar arquivo
nano /opt/fraga-dashboard/client/src/pages/NfseDashboard.tsx

# Adicionar imports:
# import { NfseAdvancedFilters } from "@/components/NfseAdvancedFilters";
# import { NfseAnalytics } from "@/components/NfseAnalytics";
# import { useNfseBulkStore } from "@/store/nfseBulkStore";

# Adicionar componentes no JSX
```

**Checklist:**
- [ ] Imports adicionados
- [ ] Estado de filtros criado
- [ ] NfseAnalytics renderizado
- [ ] NfseAdvancedFilters integrado
- [ ] Store integrado

---

## 🧪 FASE 3: TESTES (2 dias)

### TypeScript Compilation
```bash
cd /opt/fraga-dashboard
npm run build

# Verificar erros
# Esperado: Sem erros TypeScript
```

**Checklist:**
- [ ] Sem erros de compilação
- [ ] Sem warnings críticos
- [ ] Type checking completo

### Testes em Desenvolvimento

```bash
npm run dev  # Se disponível
# ou
pm2 start npm --name "fraga-dev" -- run dev
```

Abrir em: `http://localhost:3000/nfse`

**Testes Manuais:**
- [ ] Página carrega sem erros
- [ ] Analytics aparecem
- [ ] Filtros funcionam
- [ ] Seleção múltipla funciona
- [ ] Gráficos renderizam
- [ ] Responsividade mobile OK

### Testes de Performance

```javascript
// No browser console (F12)
performance.measure('page-load', 'navigationStart', 'loadEventEnd');
const measure = performance.getEntriesByName('page-load')[0];
console.log(`Load Time: ${measure.duration}ms`);

// Esperado: < 3000ms
```

**Checklist:**
- [ ] Carregamento < 3s
- [ ] Sem memory leaks
- [ ] CPU usage normal
- [ ] Network requests otimizado

---

## 📦 FASE 4: BUILD & DEPLOYMENT (1 dia)

### Build Production

```bash
cd /opt/fraga-dashboard
npm run build

# Verificar output
ls -la dist/ 
# Esperado: arquivos CSS, JS minificados
```

**Checklist:**
- [ ] Build sem erros
- [ ] Tamanho bundle OK (< 5MB)
- [ ] Source maps inclusos (para debug)

### Deploy em Staging

```bash
# Se usar Docker
docker build -t fraga-dashboard:latest .
docker run -p 3000:3000 fraga-dashboard:latest

# Se usar PM2
pm2 restart fraga-dashboard
pm2 logs fraga-dashboard --lines 50

# Verificar logs
```

**Checklist:**
- [ ] Aplicação inicia sem erros
- [ ] Logs limpos (sem ERROR)
- [ ] Endpoints respondendo (200 OK)
- [ ] WebSocket conectando (se usado)

### Teste em Staging

```
URL: https://staging.fraga-dashboard/nfse

✅ Testar:
- Carregamento da página
- Filtros avançados
- Seleção múltipla
- Bulk operations
- Analytics/KPIs
- Responsividade
- Navegação
```

**Checklist:**
- [ ] Usuários testam funcionalidades
- [ ] Feedback coletado
- [ ] Bugs reportados e fixados
- [ ] Performance aceitável

---

## 🚀 FASE 5: PRODUCTION DEPLOYMENT (1 dia)

### Pre-deployment Checklist

```bash
# Verificar status atual
git status  # Nada staged/uncommitted
git log --oneline -5  # Últimas commits

# Verificar código
npm run lint  # Se disponível
npm run test  # Se disponível

# Backup da versão atual
tar -czf fraga-dashboard-backup-$(date +%Y%m%d_%H%M%S).tar.gz \
  /opt/fraga-dashboard
```

**Checklist:**
- [ ] Todos os testes passando
- [ ] Code review aprovado
- [ ] Documentação atualizada
- [ ] Backup criado

### Deployment

```bash
# 1. Parar aplicação
pm2 stop fraga-dashboard

# 2. Deploy (via git ou manual)
cd /opt/fraga-dashboard
git pull origin main  # ou git merge feat/nfse-improvements
npm install
npm run build

# 3. Iniciar aplicação
pm2 start fraga-dashboard
pm2 save  # Salvar lista de processos

# 4. Verificar
pm2 logs fraga-dashboard --lines 100 --nostream
```

**Checklist:**
- [ ] App iniciando sem erros
- [ ] Logs limpos
- [ ] Health check OK
- [ ] Database conectado

### Smoke Tests

```bash
# Testar endpoints críticos
curl -s http://localhost:3000/nfse | grep "DOCTYPE" > /dev/null && \
  echo "✅ Página carrega" || echo "❌ Erro ao carregar"

# Testar API
curl -s http://localhost:3000/api/nfse/stats | jq . && \
  echo "✅ API respondendo" || echo "❌ API com erro"
```

**Checklist:**
- [ ] Homepage carrega
- [ ] API respondendo
- [ ] Sem erro 500
- [ ] Redirects funcionam

### Monitoring

```bash
# Monitorar logs em tempo real
pm2 monit fraga-dashboard

# ou
pm2 logs fraga-dashboard

# Alertas
pm2 deploy.js  # Se configurado
```

**Checklist:**
- [ ] Zero erros após 5 min
- [ ] Performance normal
- [ ] Sem memory leaks
- [ ] Requisições processando

---

## 📊 FASE 6: PÓS-DEPLOYMENT (Contínuo)

### Day 1 (Launch Day)

```bash
# Monitorar ativamente
pm2 logs fraga-dashboard --lines 200 --nostream

# Coletar feedback
# - Slack: #fraga-nfse-feedback
# - Email: feedback@fraga.com
# - In-app: Formulário
```

**Checklist:**
- [ ] Zero bugs críticos reportados
- [ ] Performance aceitável
- [ ] Usuários conseguem usar
- [ ] Feedback coletado

### Week 1

```bash
# Análise de dados
# - Qual filtro mais usado?
# - Qual feature tem maior engagement?
# - Há erros frequentes?

# Otimizações baseadas em dados
# - Cache mais agressivo?
# - Índices no DB?
# - Compressão de assets?
```

**Checklist:**
- [ ] Métricas sendo rastreadas
- [ ] Issues sendo monitoradas
- [ ] Otimizações implementadas

### Month 1

```bash
# Retrospectiva
- ✅ O que funcionou bem?
- ❌ O que não funcionou?
- 🔄 O que melhorar?

# Planejar v2.0
- Próximas features
- Correções prioritárias
```

**Checklist:**
- [ ] Retrospectiva realizada
- [ ] Lessons learned documentadas
- [ ] Roadmap v2.0 criado

---

## 🔙 ROLLBACK (Se Necessário)

```bash
# 1. Parar app
pm2 stop fraga-dashboard

# 2. Restaurar backup
tar -xzf fraga-dashboard-backup-YYYYMMDD_HHMMSS.tar.gz -C /

# 3. Reiniciar
pm2 start fraga-dashboard

# 4. Verificar
pm2 logs fraga-dashboard --lines 50 --nostream
```

**Checklist:**
- [ ] Versão anterior rodando
- [ ] Sem erros
- [ ] Dados intactos
- [ ] Usuários notificados

---

## ✅ RESUMO FINAL

| Fase | Duração | Status |
|------|---------|--------|
| Preparação | 1 dia | ⬜ |
| Integração | 3 dias | ⬜ |
| Testes | 2 dias | ⬜ |
| Build/Deploy | 1 dia | ⬜ |
| Prod Deploy | 1 dia | ⬜ |
| Monitoramento | Contínuo | ⬜ |
| **TOTAL** | **~9 dias** | ⬜ |

---

## 📞 CONTATOS DE EMERGÊNCIA

- **Eng Lead**: [Nome/Slack]
- **DevOps**: [Nome/Slack]
- **PM**: [Nome/Slack]
- **On-call**: [Número/Email]

---

**Última Atualização**: Março 2024
**Status**: 🔴 Aguardando Aprovação
**Próximo Passo**: Approve → Iniciar Fase 1

