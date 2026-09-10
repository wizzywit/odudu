#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

cleanup() { docker compose down -v --remove-orphans; }
trap cleanup EXIT

docker compose up -d --build

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health/ready > /dev/null 2>&1; then
    echo "odudu became ready"
    exit 0
  fi
  sleep 2
done

echo "odudu did not become ready within 120s" >&2
docker compose logs odudu >&2
exit 1
