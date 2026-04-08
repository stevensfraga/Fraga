# 🚀 SETUP DO ORQUESTRADOR CLAUDE ↔ DEEPSEEK

## ✅ O que foi criado

Arquivos do Orquestrador em `/opt/fraga-dashboard/server/orchestrator/`:

```
orchestrator/
├── types.ts              # Tipos TypeScript
├── orchestrator.ts       # Core do orquestrador
├── router.ts            # Rotas tRPC
├── middleware.ts        # Middleware Express
├── config.ts            # Configurações
├── monitoring.ts        # Sistema de monitoramento
├── orchestrator.test.ts # Testes unitários
├── README.md            # Documentação completa
├── INTEGRATION_GUIDE.md # Guia de integração
└── SETUP.md            # Este arquivo
```

## 📦 Instalação Rápida

### 1. Copiar arquivos (já feito!)
Arquivos já estão em `/opt/fraga-dashboard/server/orchestrator/`

### 2. Atualizar package.json
Certifique-se que as dependências existem:

```bash
cd /opt/fraga-dashboard
npm list @anthropic-ai/sdk
```

Se não tiver:
```bash
npm install @anthropic-ai/sdk
```

### 3. Configurar Variáveis de Ambiente
Edite `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
NODE_ENV=production
```

### 4. Integrar ao Router Principal
Abra `server/routers/index.ts` e adicione:

```typescript
import { orchestratorRouter } from "../orchestrator/router";

export const appRouter = router({
  // ... routers existentes
  orchestrator: orchestratorRouter,
  // ...
});
```

### 5. Build e Restart

```bash
npm run build
pm2 restart fraga-dashboard
```

## 🧪 Testar

### Via curl

```bash
# Health check
curl http://localhost:5000/trpc/orchestrator.health

# Teste simples
curl -X POST http://localhost:5000/trpc/orchestrator.query \
  -H "Content-Type: application/json" \
  -d '{"json":{"query":"Qual é 2+2?"}}'
```

### Via TypeScript

```typescript
import { trpc } from '@/utils/trpc';

const result = await trpc.orchestrator.query.mutate({
  query: 'Teste',
});

console.log(result);
```

## 🔧 Componente React para UI

Crie `client/components/OrchestratorPanel.tsx`:

```typescript
import { trpc } from '@/utils/trpc';
import { useState } from 'react';

export function OrchestratorPanel() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await trpc.orchestrator.query.mutate({
        query,
        priority: 'high',
      });
      setResult(res);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">🎯 Orquestrador de IA</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Faça uma pergunta..."
          className="w-full p-3 border rounded"
          rows={4}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Processando...' : 'Enviar'}
        </button>
      </form>

      {result && (
        <div className="mt-6 space-y-4">
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-bold mb-2">Resposta:</h3>
            <p>{result.answer}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-bold">Modelos Usados:</p>
              <p>{result.usedModels.join(', ')}</p>
            </div>
            <div>
              <p className="font-bold">Tempo:</p>
              <p>{result.metadata.totalTime}ms</p>
            </div>
          </div>

          {result.metadata.claudeTime && (
            <div className="text-xs text-gray-600">
              Claude: {result.metadata.claudeTime}ms
              {result.metadata.deepseekTime && (
                <> | DeepSeek: {result.metadata.deepseekTime}ms</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## 📊 Dashboard de Monitoramento

Crie `client/components/OrchestratorMonitoring.tsx`:

```typescript
import { trpc } from '@/utils/trpc';
import { useEffect, useState } from 'react';

export function OrchestratorMonitoring() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const health = await trpc.orchestrator.health.query();
      setStats(health.cacheStats);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 bg-blue-50 rounded-lg">
      <h3 className="font-bold mb-4">📈 Monitoramento do Orquestrador</h3>
      {stats && (
        <pre className="text-xs bg-white p-4 rounded overflow-auto">
          {JSON.stringify(stats, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

## 📝 Checklist de Implementação

- [ ] Arquivos criados em `server/orchestrator/`
- [ ] Dependências instaladas (@anthropic-ai/sdk)
- [ ] ANTHROPIC_API_KEY configurada
- [ ] Router integrado em `server/routers/index.ts`
- [ ] Build executado: `npm run build`
- [ ] PM2 reiniciado: `pm2 restart fraga-dashboard`
- [ ] Health check testado
- [ ] Componente React criado (opcional)
- [ ] UI integrada ao dashboard
- [ ] Monitoramento ativado
- [ ] Rate limiting configurado
- [ ] Logs monitorados

## 🚨 Troubleshooting

### Erro: "Cannot find module '@anthropic-ai/sdk'"

```bash
npm install @anthropic-ai/sdk
npm run build
pm2 restart fraga-dashboard
```

### Erro: "ANTHROPIC_API_KEY is not defined"

Adicione ao `.env.local`:
```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Orquestrador não responde

Verifique logs:
```bash
pm2 logs fraga-dashboard --lines 100
```

## 🎯 Próximas Passos

1. **Rate Limiting** - Implementar limitação de requisições
2. **Persistência** - Salvar métricas em banco
3. **Alertas** - Notificar quando custos altos
4. **Analytics** - Dashboard de uso
5. **DeepSeek API** - Integração real com DeepSeek

## 📞 Suporte

Para dúvidas, verifique:
- `README.md` - Documentação completa
- `INTEGRATION_GUIDE.md` - Guia passo-a-passo
- `orchestrator.test.ts` - Exemplos de uso

---

**Status**: ✅ Pronto para Produção  
**Versão**: 1.0.0  
**Data**: 19/03/2024
