#!/bin/bash
set -a
source /opt/fraga-dashboard/.env.production
set +a

# Função para tratar sinais
trap "exit 0" SIGTERM SIGINT

# Loop de supervisão
while true; do
    echo "[$(date)] Iniciando Fraga Dashboard..."
    /usr/bin/node /opt/fraga-dashboard/dist/index.js &
    PID=$!
    
    # Aguardar o processo
    wait $PID
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] Processo saiu com sucesso (código 0). Reiniciando em 5 segundos..."
        sleep 5
    else
        echo "[$(date)] Processo saiu com erro (código $EXIT_CODE). Reiniciando em 5 segundos..."
        sleep 5
    fi
done
