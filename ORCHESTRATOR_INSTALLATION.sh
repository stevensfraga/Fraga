#!/bin/bash

# 🎯 Script de Instalação do Orquestrador Claude ↔ DeepSeek
# Para o Fraga Dashboard

echo "🚀 Instalando Orquestrador..."
echo "================================"

# 1. Verificar dependências
echo "✓ Verificando dependências..."
cd /opt/fraga-dashboard

# 2. Instalar @anthropic-ai/sdk se não existir
if ! npm list @anthropic-ai/sdk > /dev/null 2>&1; then
  echo "📦 Instalando @anthropic-ai/sdk..."
  npm install @anthropic-ai/sdk
fi

# 3. Verificar .env.local
if [ ! -f .env.local ]; then
  echo "⚠️ Criando .env.local..."
  touch .env.local
  echo "ANTHROPIC_API_KEY=" >> .env.local
fi

# 4. Verificar ANTHROPIC_API_KEY
if ! grep -q "ANTHROPIC_API_KEY" .env.local; then
  echo "⚠️ Adicione ANTHROPIC_API_KEY ao .env.local"
fi

# 5. Build
echo "🔨 Compilando..."
npm run build

# 6. Verificar arquivos criados
echo "✓ Verificando arquivos..."
if [ -d "server/orchestrator" ]; then
  echo "✅ Pasta orchestrator encontrada"
  ls -la server/orchestrator/ | tail -10
else
  echo "❌ Pasta orchestrator NÃO encontrada"
  exit 1
fi

# 7. Info final
echo ""
echo "================================"
echo "✅ Instalação Concluída!"
echo "================================"
echo ""
echo "📝 Próximos passos:"
echo "1. Adicione ANTHROPIC_API_KEY ao .env.local"
echo "2. Integre o router: cat server/orchestrator/INTEGRATION_GUIDE.md"
echo "3. Teste: pm2 restart fraga-dashboard"
echo "4. Verifique: curl http://localhost:5000/trpc/orchestrator.health"
echo ""
echo "📖 Documentação:"
echo "  - README.md: Documentação completa"
echo "  - SETUP.md: Setup rápido"
echo "  - INTEGRATION_GUIDE.md: Passo-a-passo"
echo ""

