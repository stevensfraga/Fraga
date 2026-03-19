#!/bin/bash

# Script para facilitar push para GitHub
# Uso: ./push-to-github.sh "mensagem do commit"

if [ -z "$1" ]; then
    echo "❌ Erro: Forneça uma mensagem de commit"
    echo "Uso: ./push-to-github.sh \"Mensagem do commit\""
    exit 1
fi

cd /opt/fraga-dashboard

echo "📦 Adicionando arquivos..."
git add .

echo "💾 Commitando: $1"
git commit -m "$1"

echo "🚀 Fazendo push para GitHub..."
git push -u origin main 2>/dev/null || git push -u origin master

echo "✅ Push concluído!"
echo ""
echo "Verifique em: https://github.com/SEU_USUARIO/fraga-dashboard"
