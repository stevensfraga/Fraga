# 🔌 Guia de Integração do Orquestrador

## Passo 1: Adicionar ao Router Principal

Abra `server/routers/index.ts` e adicione:

```typescript
import { orchestratorRouter } from "../orchestrator/router";

export const appRouter = router({
  // ... routers existentes
  orchestrator: orchestratorRouter,
});
```

## Passo 2: Adicionar Middleware (Opcional)

Abra `server/_core/index.ts` e adicione após criar o app Express:

```typescript
import { setupOrchestratorMiddleware } from "../orchestrator/middleware";

const app = express();

// ... middlewares existentes

// Adicionar orquestrador
setupOrchestratorMiddleware(app);
```

## Passo 3: Verificar Variáveis de Ambiente

Certifique-se que em `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

## Passo 4: Usar no Cliente

### Opção A: Via tRPC (Recomendado)

```typescript
// Em componentes React
import { trpc } from '@/utils/trpc';

export function MyComponent() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleQuery = async (query: string) => {
    setLoading(true);
    try {
      const response = await trpc.orchestrator.query.mutate({
        query,
        priority: "high",
      });
      setResult(response);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        placeholder="Faça uma pergunta..."
        onSubmit={(e) => handleQuery(e.target.value)}
      />
      {loading && <p>Processando...</p>}
      {result && (
        <div>
          <h3>Resposta:</h3>
          <p>{result.answer}</p>
          <p>Modelos usados: {result.usedModels.join(", ")}</p>
          <p>Tempo: {result.metadata.totalTime}ms</p>
        </div>
      )}
    </div>
  );
}
```

### Opção B: Via REST API

```typescript
const response = await fetch('/api/trpc/orchestrator.query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: 'Sua pergunta aqui',
    priority: 'high',
  }),
});

const result = await response.json();
```

### Opção C: Com Contexto Dinâmico

```typescript
const result = await trpc.orchestrator.query.mutate({
  query: 'Analise os pagamentos',
  context: {
    startDate: '2024-01-01',
    endDate: '2024-03-19',
    status: 'pending',
  },
  requiresDeepThinking: true,
  priority: 'high',
});
```

## Passo 5: Monitorar

Acesse o health check:

```bash
curl http://localhost:5000/trpc/orchestrator.health
```

## Passo 6: Configurar Cache (Opcional)

```typescript
// Em orchestrator.ts
const CACHE_TTL = 3600000; // Alterar conforme necessário
```

## Troubleshooting

### ❌ Erro: "ANTHROPIC_API_KEY not found"

Solução: Adicione a chave em `.env.local`

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

### ❌ Erro: "router is not defined"

Solução: Certifique-se que importou corretamente:

```typescript
import { router, publicProcedure } from "../routers";
```

### ❌ Tempo muito longo

Solução: Reduza CACHE_TTL ou defina timeout:

```typescript
const response = await orchestrate({
  query: 'Sua query',
  timeout: 10000, // 10 segundos max
});
```

## Performance Tips

1. **Use contexto mínimo** - Apenas dados necessários
2. **Ative cache** - Reutiliza respostas
3. **Defina prioridade** - `high` para crítico
4. **Batch queries** - Processe múltiplas de uma vez

## Checklist de Implementação

- [ ] Adicionar orchestratorRouter ao appRouter
- [ ] Configurar middleware (opcional)
- [ ] Adicionar ANTHROPIC_API_KEY ao .env
- [ ] Testar com health check
- [ ] Implementar UI no cliente
- [ ] Monitorar logs
- [ ] Configurar rate limiting
- [ ] Adicionar analytics

---

**Status**: Pronto para Produção ✅
