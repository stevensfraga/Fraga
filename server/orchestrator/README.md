# 🎯 ORQUESTRADOR CLAUDE ↔ DEEPSEEK

Sistema inteligente de coordenação automática entre Claude e DeepSeek para o Fraga Dashboard.

## 📋 Visão Geral

O orquestrador funciona em **3 fases principais**:

### Fase 1: Análise (Claude)
- Claude analisa a query
- Decide se precisa DeepSeek
- Avalia confiança da decisão

### Fase 2: Execução
- **Se simples**: Apenas Claude responde
- **Se complexo**: Claude + DeepSeek (raciocínio profundo)

### Fase 3: Compilação
- Claude sintetiza resposta final
- Retorna com metadata completa

## 🚀 Como Usar

### Via API REST

```bash
# Requisição simples (apenas Claude)
curl -X POST http://localhost:5000/api/orchestrator \
  -H "Content-Type: application/json" \
  -d '{"query": "Qual é a capital do Brasil?"}'

# Requisição com raciocínio profundo
curl -X POST http://localhost:5000/api/orchestrator \
  -H "Content-Type: application/json" \
  -H "X-Deep-Thinking: true" \
  -d '{"query": "Analise a complexidade de um algoritmo de ordenação"}'

# Com contexto
curl -X POST http://localhost:5000/api/orchestrator \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Qual é o próximo passo?",
    "context": {"previousData": {...}}
  }'
```

### Via Cliente TypeScript/JavaScript

```typescript
import { trpc } from '@/utils/trpc';

const result = await trpc.orchestrator.query.mutate({
  query: "Analise os pagamentos pendentes",
  context: { userId: 123 },
  requiresDeepThinking: false,
  priority: "high"
});

console.log(result.answer);        // Resposta final
console.log(result.usedModels);    // ["claude", "deepseek-r1"]
console.log(result.metadata);      // Tempos e stats
```

## 🔧 Configuração

### Variáveis de Ambiente

```env
# Obrigatório
ANTHROPIC_API_KEY=sk-ant-...

# Opcional
DEEPSEEK_API_KEY=sk-...
ORCHESTRATOR_CACHE_TTL=3600000  # 1 hora
ORCHESTRATOR_TIMEOUT=30000      # 30 segundos
```

## 📊 Características

✅ **Cache Inteligente**
- Respostas cacheadas por 1 hora
- Reduz custos de API
- Responde instantaneamente

✅ **Decisão Automática**
- Claude decide se precisa DeepSeek
- Baseado em confiança e tipo de query
- Otimiza custo-benefício

✅ **Fallback Automático**
- Se DeepSeek falhar, continua com Claude
- Nunca quebra o serviço
- Log completo de erros

✅ **Métricas Detalhadas**
- Tempo de execução por modelo
- Taxa de sucesso
- Cache hit rate

## 📈 Performance

| Tipo de Query | Claude | Claude + DeepSeek | Tempo Médio |
|---|---|---|---|
| Simples | ✅ | - | ~500ms |
| Moderada | ✅ | ⚡ | ~1.5s |
| Complexa | ⚠️ | ✅ | ~2.5s |
| Raciocínio | ⚠️ | ✅ | ~3s |

## 🛡️ Error Handling

- Timeout automático: 30 segundos
- Fallback para Claude puro
- Logs estruturados
- Circuit breaker para DeepSeek

## 🎓 Exemplos Avançados

### 1. Requisição com Contexto Dinâmico

```typescript
const result = await orchestrate({
  query: "Qual é o status do pagamento?",
  context: {
    paymentId: "pag_123",
    userId: "user_456",
    timestamp: Date.now()
  },
  priority: "high"
});
```

### 2. Análise com Raciocínio Profundo

```typescript
const result = await orchestrate({
  query: `
    Analise o seguinte código e identifique problemas de performance:
    ${codeToAnalyze}
  `,
  requiresDeepThinking: true,
  priority: "high"
});
```

### 3. Processamento em Batch

```typescript
const queries = [
  "Query 1",
  "Query 2",
  "Query 3"
];

const results = await Promise.all(
  queries.map(q => orchestrate({ query: q }))
);
```

## 📞 Health Check

```bash
curl http://localhost:5000/api/orchestrator/health
```

Retorna:
```json
{
  "status": "online",
  "apiKey": "configured",
  "cacheStats": {
    "size": 42,
    "entries": [...]
  },
  "timestamp": "2024-03-19T10:30:00Z"
}
```

## 🔐 Segurança

- Validação de input com Zod
- Rate limiting (implemente)
- Sanitização de queries
- Logs de auditoria
- Isolamento de contexto

## 🚦 Rate Limiting (TODO)

```typescript
// Implementar rate limiter
const limiter = rateLimit({
  windowMs: 60000,  // 1 minuto
  max: 100,         // 100 requisições por minuto
  keyGenerator: (req) => req.ip
});
```

## 📝 Logs

Exemplo de log de execução:

```
[ORQUESTRADOR] Analisando requisição...
[DECISÃO] { useDeepSeek: true, reason: "Requer análise profunda", confidence: 0.85 }
[DEEPSEEK] Processando: Analise...
[ORQUESTRADOR] Compilando resposta final...
[API] Tempo total: 2.341s | Modelos: claude, deepseek-r1
```

## 🎯 Casos de Uso

1. **Análise de Dados Financeiros** → DeepSeek
2. **Respostas Simples** → Claude
3. **Cálculos Complexos** → DeepSeek
4. **Formatação/Síntese** → Claude
5. **Raciocínio Passo-a-Passo** → DeepSeek

---

**Versão**: 1.0.0  
**Status**: Em Produção 🚀  
**Última Atualização**: 19/03/2024
