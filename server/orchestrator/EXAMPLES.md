# 📚 Exemplos Práticos do Orquestrador

## 1. Exemplo Básico: Query Simples

```typescript
import { orchestrate } from './orchestrator';

// Pergunta simples - apenas Claude
const result = await orchestrate({
  query: "Qual é a capital da França?"
});

console.log(result.answer);        // "Paris"
console.log(result.usedModels);    // ["claude"]
console.log(result.metadata);      // { totalTime: 523, claudeTime: 523 }
```

## 2. Exemplo: Query Complexa (DeepSeek)

```typescript
// Pergunta com análise profunda
const result = await orchestrate({
  query: `
    Analise este algoritmo de busca binária e identifique:
    1. Complexidade de tempo
    2. Complexidade de espaço
    3. Casos extremos
    4. Comparação com busca linear
    
    function binarySearch(arr, target) {
      let left = 0, right = arr.length - 1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
      }
      return -1;
    }
  `,
  requiresDeepThinking: true,
  priority: "high"
});

console.log(result.answer);           // Análise detalhada
console.log(result.usedModels);       // ["claude", "deepseek-r1"]
console.log(result.metadata.deepseekTime); // ~1500ms
```

## 3. Exemplo: Com Contexto de Dados

```typescript
// Query com contexto de um usuário
const paymentData = {
  userId: "user_123",
  totalPaid: 50000,
  totalOwed: 12500,
  daysOverdue: 45,
  lastPaymentDate: "2024-02-01",
  lastDueDate: "2024-01-30"
};

const result = await orchestrate({
  query: "Qual deve ser a próxima ação para este cliente?",
  context: paymentData,
  priority: "high"
});

// Resultado: Análise baseada nos dados do cliente
```

## 4. Exemplo: Em Componente React

```typescript
import { trpc } from '@/utils/trpc';
import { useState } from 'react';

export function PaymentAnalyzer() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const res = await trpc.orchestrator.query.mutate({
        query,
        context: {
          // Dados do pagamento
          status: 'pending',
          amount: 5000
        },
        priority: 'high'
      });
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Faça uma análise..."
      />
      <button onClick={handleAnalyze} disabled={loading}>
        {loading ? 'Analisando...' : 'Analisar'}
      </button>

      {result && (
        <div>
          <h3>Resultado:</h3>
          <p>{result.answer}</p>
          <p className="text-sm text-gray-600">
            Tempo: {result.metadata.totalTime}ms | 
            Modelos: {result.usedModels.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}
```

## 5. Exemplo: Processamento em Batch

```typescript
const queries = [
  "Qual é a taxa de conversão padrão?",
  "Como otimizar custos de operação?",
  "Qual é a melhor estratégia de cobrança?"
];

// Processar todas em paralelo
const results = await Promise.all(
  queries.map(q => orchestrate({ query: q }))
);

results.forEach((r, i) => {
  console.log(`Query ${i + 1}: ${r.answer}`);
  console.log(`Tempo: ${r.metadata.totalTime}ms\n`);
});
```

## 6. Exemplo: Análise Sequencial com Cache

```typescript
// Primeira requisição (sem cache)
const firstCall = await orchestrate({
  query: "Quais são as melhores práticas de cobrança?"
});
console.log(firstCall.metadata.totalTime); // ~1200ms

// Segunda requisição idêntica (com cache)
const cachedCall = await orchestrate({
  query: "Quais são as melhores práticas de cobrança?"
});
console.log(cachedCall.metadata.totalTime); // ~5ms (do cache!)

// Economia: 1195ms + redução de custo de API
```

## 7. Exemplo: Monitoramento em Tempo Real

```typescript
import { monitor } from './monitoring';
import { orchestrate } from './orchestrator';

// Fazer requisição
const result = await orchestrate({
  query: "Teste"
});

// Registrar métrica
monitor.logRequest({
  id: "req_123",
  query: result.answer.substring(0, 50),
  timestamp: Date.now(),
  duration: result.metadata.totalTime,
  modelsUsed: result.usedModels,
  status: 'success',
  costUSD: 0.0003
});

// Obter estatísticas
const stats = monitor.getStats();
console.log(stats);
// {
//   totalRequests: 42,
//   successRate: "95.24%",
//   avgResponseTime: "1,234ms",
//   totalCost: "$0.45",
//   claudeOnlyPercentage: "71.4%",
//   deepseekPercentage: "28.6%"
// }
```

## 8. Exemplo: Análise de Pagamentos com IA

```typescript
// Caso real: Análise de histórico de pagamentos
const paymentsData = {
  totalRecebido: 125000,
  totalAtrasado: 35000,
  mediaPagamento: 7.5, // dias
  clientes: [
    { id: 1, status: "em dia", dias: 0 },
    { id: 2, status: "atrasado", dias: 45 },
    { id: 3, status: "crítico", dias: 90 }
  ]
};

const result = await orchestrate({
  query: `
    Com base nestes dados de pagamento:
    ${JSON.stringify(paymentsData, null, 2)}
    
    Forneça:
    1. Análise da saúde financeira
    2. Clientes em risco
    3. Recomendações de ação
  `,
  requiresDeepThinking: true,
  priority: "high"
});

console.log(result.answer);
```

## 9. Exemplo: Integração com API Externa

```typescript
// Combinar dados de API externa com orquestrador
const fetchPaymentData = async (id: string) => {
  const res = await fetch(`/api/payments/${id}`);
  return res.json();
};

export async function analyzePayment(paymentId: string) {
  const paymentData = await fetchPaymentData(paymentId);
  
  const result = await orchestrate({
    query: `Analise este pagamento e sugira próximas ações`,
    context: paymentData,
    priority: 'high'
  });
  
  return result;
}
```

## 10. Exemplo: Error Handling

```typescript
try {
  const result = await orchestrate({
    query: "Pergunta",
    timeout: 10000 // 10 segundos max
  });
  
  console.log(result.answer);
} catch (error) {
  if (error instanceof Error) {
    console.error("Erro no orquestrador:", error.message);
  }
  
  // Fallback: usar resposta genérica
  const fallback = {
    answer: "Desculpe, não consegui processar. Tente novamente.",
    usedModels: [],
    reasoning: "Erro na execução",
    metadata: {
      totalTime: 0,
      fallbackUsed: true
    }
  };
}
```

## 11. Exemplo: Performance Testing

```typescript
import { performance } from 'perf_hooks';

async function benchmarkOrchestrator() {
  const queries = [
    "Pergunta simples",
    "Análise de dados",
    "Raciocínio profundo"
  ];
  
  for (const query of queries) {
    const start = performance.now();
    const result = await orchestrate({ query });
    const duration = performance.now() - start;
    
    console.log(`
      Query: ${query.substring(0, 30)}...
      Tempo: ${duration.toFixed(0)}ms
      Modelos: ${result.usedModels.join(', ')}
      Resposta: ${result.answer.substring(0, 100)}...
    `);
  }
}

benchmarkOrchestrator();
```

## 12. Exemplo: Custom Decision Logic

```typescript
// Forçar uso de modelo específico
const mustUseDeepSeek = await orchestrate({
  query: "Análise de complexidade algorítmica",
  requiresDeepThinking: true // Força DeepSeek
});

// Apenas Claude (rápido e barato)
const quickReply = await orchestrate({
  query: "Qual é a data de hoje?",
  requiresDeepThinking: false
});
```

---

## 🎯 Quando Usar Cada Padrão

| Padrão | Uso | Benefício |
|---|---|---|
| 1. Básico | Respostas simples | Rápido e barato |
| 2. DeepSeek | Análise complexa | Precisão máxima |
| 3. Contexto | Dados estruturados | Resposta personalizada |
| 4. React | UI interativa | Melhor UX |
| 5. Batch | Múltiplas queries | Eficiência |
| 6. Cache | Queries repetidas | Economia |
| 7. Monitor | Análise de performance | Otimização |
| 8. Real-world | Dados reais | Aplicação prática |
| 9. Integration | APIs externas | Dados enriquecidos |
| 10. Error-handling | Robustez | Confiabilidade |
| 11. Benchmark | Performance | Otimização |
| 12. Custom | Lógica específica | Flexibilidade |

---

**Para mais exemplos, veja `README.md` e `INTEGRATION_GUIDE.md`**
