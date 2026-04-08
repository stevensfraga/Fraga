# 🏗️ ARQUITETURA DAS MELHORIAS /NFSE

## 📊 Estrutura de Componentes

```
NfseDashboard.tsx (página principal)
├── NfseAnalytics
│   ├── Stat Cards
│   ├── LineChart (Emissões por dia)
│   ├── PieChart (Distribuição status)
│   └── Insights Panel
│
├── NfseAdvancedFilters
│   ├── Search Bar
│   ├── Quick Filters
│   ├── Advanced Filter Popover
│   │   ├── Status Multi-Select
│   │   ├── Date Range Picker
│   │   ├── Value Range
│   │   ├── City Input
│   │   └── Provider Input
│   └── Active Filters Display
│
├── NfseTable
│   ├── Checkbox Column (Seleção múltipla)
│   ├── Columns (NF-e, Tomador, Valor, Status, Ações)
│   └── TableRows (com selection state)
│
├── NfseBulkToolbar (sticky bottom)
│   ├── Selection Count
│   ├── Action Buttons
│   │   ├── Emit Bulk
│   │   ├── Retry Bulk
│   │   ├── Export
│   │   └── Delete Bulk
│   └── Confirmation Dialogs
│
└── Pagination Controls
```

---

## 🔄 Data Flow

```
┌─────────────────────────────────────────────────────┐
│ NfseDashboard (State)                               │
├─────────────────────────────────────────────────────┤
│ - filters: AdvancedFilterState                      │
│ - page: number                                      │
│ - search: string                                    │
└────────────┬────────────────────────────────────────┘
             │
    ┌────────┴──────────┬──────────────┬──────────────┐
    │                   │              │              │
    ▼                   ▼              ▼              ▼
┌─────────┐      ┌──────────┐   ┌─────────┐   ┌────────────┐
│Analytics│      │ Filters  │   │ Table   │   │BulkToolbar │
│Component│      │Component │   │Component│   │Component   │
└────┬────┘      └────┬─────┘   └────┬────┘   └─────┬──────┘
     │                │              │              │
     └────────┬───────┴──────────────┴──────────────┘
              │
              ▼
      ┌──────────────────┐
      │ TRPC API Calls   │
      ├──────────────────┤
      │ - list (filters) │
      │ - stats          │
      │ - emit/retry     │
      │ - delete         │
      │ - export         │
      └────────┬─────────┘
               │
               ▼
      ┌──────────────────┐
      │ Backend (TRPC)   │
      ├──────────────────┤
      │ - Database       │
      │ - Business Logic │
      │ - File Export    │
      └──────────────────┘
```

---

## 🎯 State Management

### Global State (Zustand)
```
useNfseBulkStore
├── selectedIds: number[]
├── toggleSelect(id)
├── selectAll(ids)
├── deselectAll()
├── isSelected(id)
└── getSelectedCount()
```

### Component State (React)
```
NfseDashboard
├── filters: AdvancedFilterState
├── page: number
├── search: string
├── selectedId: number | null (para detalhe)
└── showNovaEmissao: boolean

NfseAdvancedFilters
├── showAdvanced: boolean
├── tempFilters: AdvancedFilterState
└── activeFilterCount: number
```

### TRPC Queries & Mutations
```
Queries:
├── nfse.emissoes.list (+ filters)
├── nfse.analytics.stats
├── nfse.analytics.timeline
└── nfse.analytics.statusDistribution

Mutations:
├── nfse.emissoes.bulkEmit
├── nfse.emissoes.bulkRetry
├── nfse.emissoes.bulkDelete
├── nfse.emissoes.bulkExport
└── nfse.emissoes.emit (single)
```

---

## 📦 Dependências

### Node Packages
```json
{
  "recharts": "^2.10.0",           // Gráficos
  "zustand": "^4.4.0",             // State management
  "date-fns": "^2.30.0",           // Data formatting
  "react-day-picker": "^8.9.0",    // Calendar picker
  "xlsx": "^0.18.5",               // Excel export
  "papaparse": "^5.4.1",           // CSV parse/export
  "shadcn/ui": "existing",         // UI components
  "react": "^18.0.0",              // Base
  "trpc": "existing"               // API
}
```

### Import Paths
```typescript
@/components/ui/*        // UI components
@/components/Nfse*       // NFSE components
@/store/nfseBulkStore    // State
@/lib/trpc               // API client
```

---

## 🔐 Security & Validation

### Backend Validation
```
Input Validation:
├── bulkEmit: IDs array validation
├── bulkRetry: Status check (apenas 'erro')
├── bulkDelete: Status check (apenas 'rascunho'/'erro')
├── dateRange: Validação de datas
└── valueRange: Validação de ranges

Authorization:
├── Verificar permissões do usuário
├── Validar propriedade dos registros
└── Rate limiting em bulk operations
```

### Frontend Validation
```
User Input:
├── Date picker: Validação automática
├── Number fields: Min/max
├── Text fields: Trim & length
└── Selection: Verificar IDs válidos
```

---

## 📊 Database Schema (Existente)

```sql
-- Tabela base (presumida)
CREATE TABLE nfseEmissao (
  id INT PRIMARY KEY,
  nfseNumber VARCHAR,
  status ENUM('rascunho', 'processando', 'emitida', 'erro', 'cancelada'),
  tomador VARCHAR,
  valor DECIMAL,
  cidade VARCHAR,
  prestador VARCHAR,
  descricao TEXT,
  criadoEm TIMESTAMP,
  emitidoEm TIMESTAMP,
  ultimoErro VARCHAR,
  tentativas INT,
  ultimaTentativa TIMESTAMP,
  INDEX(status),
  INDEX(criadoEm),
  INDEX(tomador),
  INDEX(prestador)
);
```

---

## ⚡ Performance Considerations

### Optimization Strategies

```
Frontend:
├── React.memo para Stat Cards
├── useMemo para gráficos
├── Lazy loading de modais
├── Virtual scrolling para tabelas grandes
└── Code splitting por page

Backend:
├── Database indexing (status, data, tomador)
├── Pagination (50 itens/página)
├── Cache TRPC (5 min para stats)
├── Batch operations
└── Query optimization

Network:
├── Gzip compression
├── Image optimization
├── Bundle splitting
└── Lazy load charts
```

### Métricas Alvo

```
Carregamento:
├── First Contentful Paint: < 2s
├── Largest Contentful Paint: < 3s
├── Time to Interactive: < 4s
└── Cumulative Layout Shift: < 0.1

Runtime:
├── Filter response: < 500ms
├── Table render: < 1s
├── Bulk action: < 2s
└── Export: < 5s

Recursos:
├── Bundle size: < 5MB (total)
├── Memory usage: < 200MB
├── CPU usage: < 50% idle
└── Network: < 100 requests/page
```

---

## 🔄 Deployment Flow

```
┌─────────────────────────────────┐
│ Feature Branch Development      │
├─────────────────────────────────┤
│ git checkout -b feat/nfse-impr. │
│ npm install                     │
│ Desenvolver componentes         │
│ npm run build                   │
└──────────────┬──────────────────┘
               │
               ▼
┌──────────────────────────┐
│ Pull Request & Review    │
├──────────────────────────┤
│ Code review              │
│ Type checking            │
│ Unit tests (se houver)   │
└──────────────┬───────────┘
               │
               ▼
┌──────────────────────────┐
│ Staging Deployment       │
├──────────────────────────┤
│ npm run build            │
│ Deploy to staging        │
│ QA testing               │
│ User acceptance testing  │
└──────────────┬───────────┘
               │
               ▼
┌──────────────────────────┐
│ Production Deployment    │
├──────────────────────────┤
│ Schedule window          │
│ Backup                   │
│ Deploy                   │
│ Monitoring 24h           │
└──────────────┬───────────┘
               │
               ▼
┌──────────────────────────┐
│ Post-Launch Support      │
├──────────────────────────┤
│ Monitor logs             │
│ Coleta de feedback       │
│ Hot fixes (se necessário)│
└──────────────────────────┘
```

---

## 📋 Checklist de Implementação

### Preparação
- [ ] Branch criado
- [ ] Dependências instaladas
- [ ] Tipos TypeScript definidos

### Desenvolvimento
- [ ] Componentes criados
- [ ] State management
- [ ] TRPC routes
- [ ] Integração

### Testes
- [ ] Testes unitários
- [ ] Testes de integração
- [ ] Testes manuais
- [ ] Performance testing

### Deployment
- [ ] Build sem erros
- [ ] Staging deployment
- [ ] QA approval
- [ ] Prod deployment
- [ ] Monitoring

---

## 🚨 Rollback Plan

```bash
# Se algo der errado em produção:

1. Detecção (automática ou manual)
   └─ Alertas monitorando logs

2. Decision (< 5 min)
   └─ Decidir se faz rollback

3. Execution
   └─ pm2 restart fraga-dashboard (volta versão anterior)

4. Verification
   └─ Health checks passam

5. Communication
   └─ Avisar usuários / stakeholders

6. Root Cause Analysis
   └─ Investigar o que deu errado
```

---

## 📞 Support & Escalation

```
Problema                      → Responsável
─────────────────────────────────────────────
Performance lenta            → Backend/DevOps
Erro na UI                   → Frontend Dev
Database issue               → DevOps
API timeout                  → Backend
UI bugs após deploy          → Frontend
Security issue               → Security team
User confusion               → Product/UX
```

---

**Última Atualização**: Março 2024
**Status**: 🟢 Arquitetura Definida
**Próximo**: Iniciar desenvolvimento

