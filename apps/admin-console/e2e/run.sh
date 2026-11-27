#!/usr/bin/env bash
# Builds the image, starts infra/docker as a project of its own, and runs the
# console's browser tests against it. CI and a developer both run this.
#   ODUDU_HOST_PORT / POSTGRES_HOST_PORT  host ports (default 3080 / 5462)
#   E2E_KEEP_STACK=1                      leave the stack up afterwards
#   E2E_COMPOSE_PROJECT                   the stack's project name (default odudu-e2e)
#   E2E_PREBUILT=1                        do not rebuild the image: compose starts the
#                                         one tagged <project>-odudu if it exists (CI
#                                         builds it against a layer cache), and builds
#                                         only if it does not. It must carry the revision
#                                         label of ODUDU_REVISION, or of HEAD if unset
#   E2E_SHARD=<n>/<total>                 run one slice of the specs (playwright --shard)
#   E2E_PLAYWRIGHT                        a playwright binary to run, in place of
#                                         `pnpm exec playwright`; the browser install is skipped
#   PROVIDER_STUB_PORT                    the host port of the stand-in model server the assistant
#                                         tests talk to (default 4100)
#   E2E_TRACE=<file>                      record the requests each test makes (see docs/phases/p4d.md)
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
# The stack refuses to start without the console's private key. Its database is
# new on every run, so a key made for this run is enough, and nothing is written
# to .env: a developer's own stack keeps the key it registered on its tenants.
export ODUDU_CONSOLE_CLIENT_KEY="${ODUDU_CONSOLE_CLIENT_KEY:-$("$DOCKER_DIR/console-key.sh")}"
export ODUDU_HOST_PORT="$host_port"
export POSTGRES_HOST_PORT="$postgres_port"
export COMPOSE_PROJECT_NAME="${E2E_COMPOSE_PROJECT:-odudu-e2e}"
export COMPOSE_FILE="$DOCKER_DIR/compose.yaml"
build_flag=(--build)
if [ "${E2E_PREBUILT:-}" = "1" ]; then
  build_flag=()
  expected_revision="${ODUDU_REVISION:-$(git -C "$REPO" rev-parse HEAD)}"
  actual_revision="$(docker image inspect "$COMPOSE_PROJECT_NAME-odudu" \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [ -n "$actual_revision" ] && [ "$actual_revision" != "$expected_revision" ]; then
    echo "$COMPOSE_PROJECT_NAME-odudu was built from '$actual_revision', not '$expected_revision'." >&2
    echo "Build it from this commit (ODUDU_REVISION=$expected_revision), or run without E2E_PREBUILT." >&2
    exit 1
  fi
fi
shard_flag=()
if [ -n "${E2E_SHARD:-}" ]; then
  shard_flag=(--shard "$E2E_SHARD")
fi
# Every test signs in, from one origin, more often than a person would.
export ODUDU_THROTTLE_LIMIT=10000
export ODUDU_LOGIN_THROTTLE_LIMIT=10000
export E2E_BASE_URL="http://localhost:$ODUDU_HOST_PORT"

compose() { docker compose --project-directory "$DOCKER_DIR" "$@"; }

# A stand-in model server on the host, which the stack reaches as
# host.docker.internal: the assistant tests need an answer and no real model.
export PROVIDER_STUB_PORT="${PROVIDER_STUB_PORT:-4100}"
node --input-type=module -e "
  import { startProviderStub } from '$REPO/apps/server/src/testing/provider-stub.ts';
  await startProviderStub(Number(process.env.PROVIDER_STUB_PORT));
" &
stub_pid=$!
export COMPOSE_FILE="$COMPOSE_FILE:$DOCKER_DIR/compose.e2e-assistant.yaml"

cleanup() {
  kill "$stub_pid" 2>/dev/null || true
  if [ "${E2E_KEEP_STACK:-}" = "1" ]; then
    echo "leaving $COMPOSE_PROJECT_NAME up on $E2E_BASE_URL" >&2
    return
  fi
  compose down -v --remove-orphans || true
}
trap cleanup EXIT

compose up -d ${build_flag[@]+"${build_flag[@]}"} --wait --wait-timeout 180 postgres odudu

cd "$REPO/apps/admin-console"
if [ -n "${E2E_PLAYWRIGHT:-}" ]; then
  "$E2E_PLAYWRIGHT" test --config e2e/playwright.config.ts ${shard_flag[@]+"${shard_flag[@]}"} "$@"
else
  # For a developer's own machine; CI installs Chromium with its OS deps first.
  pnpm exec playwright install chromium
  pnpm exec playwright test --config e2e/playwright.config.ts ${shard_flag[@]+"${shard_flag[@]}"} "$@"
fi
