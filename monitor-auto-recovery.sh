#!/bin/bash

# Sistema de Monitoramento com Auto-Recuperação
# Fraga Dashboard - DevOps Orchestration

LOG_FILE="/tmp/fraga-monitor-$(date +%Y%m%d).log"
RECOVERY_LOG="/tmp/fraga-recovery-$(date +%Y%m%d).log"
CHECK_INTERVAL=30  # segundos
MAX_RETRIES=3

echo "[$(date)] === INICIANDO MONITOR DE AUTO-RECUPERAÇÃO ===" | tee -a $LOG_FILE

monitor_and_recover() {
    while true; do
        # Verifica se o processo está rodando
        if ! pm2 status | grep -q "fraga-dashboard.*online"; then
            echo "[$(date)] ⚠️  ALERTA: fraga-dashboard offline!" | tee -a $RECOVERY_LOG
            
            # Tenta recuperar
            for attempt in $(seq 1 $MAX_RETRIES); do
                echo "[$(date)] Tentativa $attempt/$MAX_RETRIES de recuperação..." | tee -a $RECOVERY_LOG
                pm2 restart fraga-dashboard
                sleep 5
                
                if pm2 status | grep -q "fraga-dashboard.*online"; then
                    echo "[$(date)] ✅ Sistema recuperado com sucesso!" | tee -a $RECOVERY_LOG
                    break
                fi
            done
        else
            echo "[$(date)] ✓ Sistema online - Status OK" | tee -a $LOG_FILE
        fi
        
        sleep $CHECK_INTERVAL
    done
}

# Executa monitoramento
monitor_and_recover
