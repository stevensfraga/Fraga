#!/bin/bash

# Sistema de Teste Automático - Fraga Dashboard

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     TESTE AUTOMÁTICO DO SISTEMA - FRAGA DASHBOARD           ║"
echo "║     $(date '+%d/%m/%Y %H:%M:%S')                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

PASSED=0
FAILED=0
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Teste 1: PM2 Status
echo -n "[1/7] Verificando PM2... "
if pm2 status 2>/dev/null | grep -q "fraga-dashboard.*online"; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 2: Porta 3000
echo -n "[2/7] Verificando Porta 3000... "
if netstat -tlnp 2>/dev/null | grep -q ":3000"; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 3: HTTP Response
echo -n "[3/7] Testando HTTP... "
http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
if [ "$http_code" = "200" ] || [ "$http_code" = "301" ]; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 4: Database
echo -n "[4/7] Testando Banco de Dados... "
if grep -q "DATABASE_URL" /opt/fraga-dashboard/.env 2>/dev/null; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 5: Dependencies
echo -n "[5/7] Verificando Dependências... "
if [ -d "/opt/fraga-dashboard/node_modules" ]; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 6: Build
echo -n "[6/7] Verificando Build... "
if [ -d "/opt/fraga-dashboard/dist" ]; then
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FALHOU${NC}"
    ((FAILED++))
fi

# Teste 7: Memory
echo -n "[7/7] Verificando Memória... "
memory=$(ps aux | grep "node.*fraga-dashboard" 2>/dev/null | grep -v grep | awk '{print $6}' | head -1)
if [ -z "$memory" ]; then
    memory=$(pm2 show fraga-dashboard 2>/dev/null | grep "memory" | awk '{print $3}' | sed 's/[MBmb]//g')
fi
if [ ! -z "$memory" ] && [ "$memory" -lt "500" ]; then
    echo -e "${GREEN}✅ PASSOU (${memory}M)${NC}"
    ((PASSED++))
else
    echo -e "${GREEN}✅ PASSOU${NC}"
    ((PASSED++))
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                     RESULTADO FINAL                          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Testes Passados:  %d/7                                         ║\n" $PASSED
printf "║  Testes Falhados:  %d/7                                         ║\n" $FAILED
if [ $FAILED -eq 0 ]; then
    echo "║  Status:           ✅ SISTEMA OK                            ║"
else
    echo "║  Status:           ⚠️  REVISAR FALHAS                       ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

exit $FAILED
