#!/bin/bash
set -a
source /opt/fraga-dashboard/.env.production
set +a
exec /usr/bin/node /opt/fraga-dashboard/dist/index.js
