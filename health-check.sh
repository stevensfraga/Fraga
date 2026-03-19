#!/bin/bash

# Health Check - Fraga Dashboard
# Retorna status em JSON para monitoramento

HEALTH_LOG="/tmp/fraga-health-$(date +%Y%m%d).log"

check_health() {
    local app_status="UNKNOWN"
    local http_status="UNKNOWN"
    local db_status="UNKNOWN"
    local memory_usage="0"
    local cpu_usage="0"
    
    # Verifica se app está online no PM2
    if pm2 status | grep -q "fraga-dashboard.*online"; then
        app_status="ONLINE"
    else
        app_status="OFFLINE"
    fi
    
    # Verifica HTTP
    http_response=$(curl -s -w "\n%{http_code}" http://localhost:3000/health 2>/dev/null)
    http_code=$(echo "$http_response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        http_status="OK"
    elif [ -z "$http_code" ]; then
        http_status="UNREACHABLE"
    else
        http_status="ERROR_$http_code"
    fi
    
    # Pega recursos
    memory_usage=$(ps aux | grep "fraga-dashboard" | grep -v grep | awk '{print $6}')
    cpu_usage=$(ps aux | grep "fraga-dashboard" | grep -v grep | awk '{print $3}')
    
    # Retorna JSON
    cat << JSONEOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "application": {
    "name": "fraga-dashboard",
    "status": "$app_status",
    "version": "1.0.0"
  },
  "health": {
    "http": "$http_status",
    "database": "$db_status",
    "overall": "$([ "$app_status" = "ONLINE" ] && [ "$http_status" = "OK" ] && echo 'HEALTHY' || echo 'DEGRADED')"
  },
  "resources": {
    "memory_kb": $memory_usage,
    "cpu_percent": $cpu_usage
  },
  "timestamp_unix": $(date +%s)
}
JSONEOF
    
    echo "[$(date)] Health Check Executado" >> $HEALTH_LOG
}

# Executa health check
check_health
