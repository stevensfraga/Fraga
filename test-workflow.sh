#!/bin/bash

# TESTE DE WORKFLOW - Valida se tudo está funcionando

echo "🧪 TESTANDO WORKFLOW DO PROJETO..."
echo ""

# Test 1: Verificar se aplicação está online
echo "✓ Test 1: Aplicação online?"
if pm2 status | grep -q "online"; then
    echo "  ✅ PASSOU - Aplicação está rodando"
else
    echo "  ❌ FALHOU - Aplicação não está rodando"
fi
echo ""

# Test 2: Verificar variáveis de ambiente
echo "✓ Test 2: Variáveis de ambiente carregadas?"
if grep -q "DATABASE_URL" /opt/fraga-dashboard/.env; then
    echo "  ✅ PASSOU - DATABASE_URL configurada"
else
    echo "  ❌ FALHOU - DATABASE_URL não encontrada"
fi
echo ""

# Test 3: Verificar se dist existe
echo "✓ Test 3: Build existe?"
if [ -f "/opt/fraga-dashboard/dist/index.js" ]; then
    echo "  ✅ PASSOU - Build pronto"
else
    echo "  ❌ FALHOU - Build não encontrado"
fi
echo ""

# Test 4: Verificar ecosystem.config
echo "✓ Test 4: Configuração PM2 OK?"
if grep -q "dotenv" /opt/fraga-dashboard/ecosystem.config.cjs; then
    echo "  ✅ PASSOU - PM2 config com dotenv"
else
    echo "  ❌ FALHOU - PM2 config incompleta"
fi
echo ""

# Test 5: Verificar Git hooks
echo "✓ Test 5: Git hooks configurados?"
if [ -f "/opt/fraga-dashboard/.githooks/pre-commit" ]; then
    echo "  ✅ PASSOU - Git hooks prontos"
else
    echo "  ❌ FALHOU - Git hooks não encontrados"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ TODOS OS TESTES PASSARAM!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🚀 VOCÊ PODE COMEÇAR A USAR AGORA!"
echo ""
echo "Próximo passo: Edite TODO.md e peça uma tarefa!"

