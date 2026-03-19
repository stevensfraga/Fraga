#!/bin/bash

# FRAGA DASHBOARD - PROJECT STATUS MONITOR
# Use: ./scripts/project-dashboard.sh

clear

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         🚀 FRAGA DASHBOARD - PROJECT COMMAND CENTER           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "📊 STATUS ATUAL:"
echo "─────────────────────────────────────────────────────────────────"
pm2 status | grep fraga-dashboard || echo "❌ PM2 não está rodando"
echo ""

echo "📈 LOGS RECENTES (últimas 20 linhas):"
echo "─────────────────────────────────────────────────────────────────"
pm2 logs fraga-dashboard --lines 20 --nostream 2>/dev/null | tail -10
echo ""

echo "💾 ESPAÇO EM DISCO:"
echo "─────────────────────────────────────────────────────────────────"
df -h /opt/fraga-dashboard | awk '{print $5, $6}' | column -t
echo ""

echo "🔧 VERSÃO E BUILD:"
echo "─────────────────────────────────────────────────────────────────"
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"
echo "Last Build: $(stat -c %y dist/index.js 2>/dev/null || echo 'N/A')"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    COMANDOS RÁPIDOS                          ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║ npm run build           - Buildar aplicação                   ║"
echo "║ pm2 restart fraga-*     - Reiniciar serviço                   ║"
echo "║ pm2 logs fraga-*        - Ver logs em tempo real              ║"
echo "║ npm start               - Rodacomunalmente                     ║"
echo "║ cat .devops-workflow.md - Ver workflow de trabalho            ║"
echo "╚════════════════════════════════════════════════════════════════╝"

