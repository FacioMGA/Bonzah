#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"
COMPOSE_FILE="${ROOT_DIR}/infrastructure/docker/compose/docker-compose.yml"

echo "[staging-like] Starting local Postgres/Redis via docker compose..."
if nc -z 127.0.0.1 5433 && nc -z 127.0.0.1 6379; then
  echo "[staging-like] Reusing existing local Postgres/Redis on 5433/6379."
else
  docker compose -f "${COMPOSE_FILE}" up -d postgres redis
fi

echo "[staging-like] Waiting for Postgres/Redis readiness..."
for i in $(seq 1 90); do
  if nc -z 127.0.0.1 5433 && nc -z 127.0.0.1 6379; then
    echo "[staging-like] Dependencies reachable."
    break
  fi
  if [ "${i}" -eq 90 ]; then
    echo "[staging-like] ERROR: dependencies not ready in time." >&2
    exit 1
  fi
  sleep 1
done

export DATABASE_URL="postgresql://admin:password123@127.0.0.1:5433/abbeygate_uw"
export REDIS_HOST="127.0.0.1"
export REDIS_PORT="6379"
export REDIS_TLS="false"
export REDIS_ENABLE_CLUSTER="false"
export QUEUE_MODE="redis"

echo "[staging-like] Applying schema + seed..."
npm run prisma:generate
npm run db:push:ci
npm run db:seed

echo "[staging-like] Running quality-critical tests..."
npm run test:contracts-fast
npm run test:tenant-isolation
npm run test:webhook-inbound-auth
npm run test:auth-transport-policy
npm run test:adapters-medium
npm run test:journeys-deep

echo "[staging-like] Complete."
