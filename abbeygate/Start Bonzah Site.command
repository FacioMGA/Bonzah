#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==> Checking Docker Desktop..."
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop isn't running yet. Opening it now..."
  open -a Docker
  echo "Waiting for Docker to finish starting (this can take ~30-60s)..."
  until docker info >/dev/null 2>&1; do
    sleep 2
  done
  echo "Docker is up."
fi

echo "==> Starting Postgres / Redis / Neo4j / Adminer containers (no-op if already running)..."
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

echo "==> Starting the API + frontend (npm run dev)..."
echo "    Frontend: http://localhost:5173/bonzah"
echo "    API health: http://localhost:3000/health"
echo "    Press Ctrl+C in this window to stop everything."
npm run dev
