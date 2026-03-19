#!/bin/bash
set -a
source /opt/fraga-dashboard/.env.production
set +a

# Desabilitar sincronização de certificados
export DISABLE_CERT_SYNC_ON_BOOT=true

# Executar aplicação
exec /usr/bin/node /opt/fraga-dashboard/dist/index.js
