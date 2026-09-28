#!/usr/bin/env bash
# Builds the image, starts infra/docker as a project of its own, and runs the
# console's browser tests against it. CI and a developer both run this.
#   ODUDU_HOST_PORT / POSTGRES_HOST_PORT  host ports (default 3080 / 5462)
#   E2E_KEEP_STACK=1                      leave the stack up afterwards
#   Extra arguments go to `playwright test`.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
DOCKER_DIR="$REPO/infra/docker"

if [ ! -f "$DOCKER_DIR/.env" ]; then
  echo "infra/docker/.env is missing. Run: cp infra/docker/.env.example infra/docker/.env" >&2
  exit 1
fi

# The caller's ports win over whatever .env names for the development stack,
# so this never lands on that stack's ports.
host_port="${ODUDU_HOST_PORT:-3080}"
postgres_port="${POSTGRES_HOST_PORT:-5462}"
set -a
# shellcheck source=/dev/null
source "$DOCKER_DIR/.env"
set +a
export ODUDU_HOST_PORT="$host_port"
export POSTGRES_HOST_PORT="$postgres_port"
export COMPOSE_PROJECT_NAME=odudu-e2e
export COMPOSE_FILE="$DOCKER_DIR/compose.yaml"
# Every test signs in, from one origin, more often than a person would.
export ODUDU_THROTTLE_LIMIT=10000
export E2E_BASE_URL="http://localhost:$ODUDU_HOST_PORT"

compose() { docker compose --project-directory "$DOCKER_DIR" "$@"; }

cleanup() {
  if [ "${E2E_KEEP_STACK:-}" = "1" ]; then
    echo "leaving $COMPOSE_PROJECT_NAME up on $E2E_BASE_URL" >&2
    return
  fi
  compose down -v --remove-orphans || true
}
trap cleanup EXIT

compose up -d --build --wait --wait-timeout 180 postgres odudu

cd "$REPO/apps/admin-console"
pnpm exec playwright install chromium
pnpm exec playwright test --config e2e/playwright.config.ts "$@"
