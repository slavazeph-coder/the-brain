#!/bin/sh
# Starts the hosted worker. Railway sets PORT; the site reaches it over the private network at
# http://<service>.railway.internal:$PORT, and nothing else should (the service needs no public domain).
set -eu
mkdir -p "$WORLD_WORKER_DIR"
umask 077
export WORLD_ADAPTERS_FILE="${WORLD_ADAPTERS_FILE:-/app/robotics/world_worker/deploy/railway/adapters.json}"
/opt/worker/bin/python /app/robotics/world_worker/deploy/railway/tenants.py > /tmp/tenants.json
export WORLD_TENANTS_FILE=/tmp/tenants.json
# The operator credential is never handed to anyone: a fresh one each start unless the operator sets their own.
WORLD_WORKER_TOKEN="${WORLD_WORKER_TOKEN:-$(/opt/worker/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')}"
export WORLD_WORKER_TOKEN
cd /app
# The site serves this worker under /api/world/worker and puts that prefix on download links itself: with uvicorn's
# --root-path, the worker's own path checks no longer see /healthz or /v1/download/ as public.
# Railway's private network is reached over IPv6, hence "::"; a host without IPv6 sets WORLD_WORKER_HOST=0.0.0.0.
exec /opt/worker/bin/python -m uvicorn robotics.world_worker.app:create_app --factory \
  --host "${WORLD_WORKER_HOST:-::}" --port "${PORT:-8080}" --no-server-header
