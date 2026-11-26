#!/usr/bin/env bash
# Starts infra/docker as a project of its own, makes the one administrator the
# documentation is photographed as, runs the capture against it and removes
# the stack. CI and a writer both run this; arguments go to the capture.
#   with-stack.sh --check          fail when the console no longer matches
#   with-stack.sh                  write the images and records
#   ODUDU_HOST_PORT / POSTGRES_HOST_PORT   host ports (default 3086 / 5466)
#   SHOTS_COMPOSE_PROJECT          the stack's project name (default odudu-shots)
#   SHOTS_SCRIPT=gif.ts            run that script alone: this writes the README animation
#   SHOTS_PREBUILT=1               start the image tagged <project>-odudu instead
#                                  of building one; it must carry the revision
#                                  label of ODUDU_REVISION, or of HEAD if unset
#   SHOTS_KEEP_STACK=1             leave the stack up afterwards
set -Eeuo pipefail

REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
DOCKER_DIR="$REPO/infra/docker"
ADMIN_EMAIL="admin@odudu.local"

if [ ! -f "$DOCKER_DIR/.env" ]; then
  echo "infra/docker/.env is missing. Run: cp infra/docker/.env.example infra/docker/.env" >&2
  exit 1
fi

host_port="${ODUDU_HOST_PORT:-3086}"
postgres_port="${POSTGRES_HOST_PORT:-5466}"
set -a
# shellcheck source=/dev/null
source "$DOCKER_DIR/.env"
set +a
export ODUDU_CONSOLE_CLIENT_KEY="${ODUDU_CONSOLE_CLIENT_KEY:-$("$DOCKER_DIR/console-key.sh")}"
export ODUDU_HOST_PORT="$host_port"
export POSTGRES_HOST_PORT="$postgres_port"
export COMPOSE_PROJECT_NAME="${SHOTS_COMPOSE_PROJECT:-odudu-shots}"
export COMPOSE_FILE="$DOCKER_DIR/compose.yaml:$DOCKER_DIR/compose.assistant.yaml"
# The settings page lists the assistant's section only where a model is
# configured. No call is ever made to it: the key only has to be present.
export ODUDU_ASSISTANT_MODELS="standard=anthropic:claude-model-for-screenshots"
export ANTHROPIC_API_KEY="not-a-real-key-the-capture-never-calls-a-model"
build_flag=(--build)
if [ "${SHOTS_PREBUILT:-}" = "1" ]; then
  build_flag=()
  expected_revision="${ODUDU_REVISION:-$(git -C "$REPO" rev-parse HEAD)}"
  actual_revision="$(docker image inspect "$COMPOSE_PROJECT_NAME-odudu" \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [ -n "$actual_revision" ] && [ "$actual_revision" != "$expected_revision" ]; then
    echo "$COMPOSE_PROJECT_NAME-odudu was built from '$actual_revision', not '$expected_revision'." >&2
    exit 1
  fi
fi

# Every step names itself, and a command that fails says which, where and how,
# so a failure is never a bare exit status. BASH_COMMAND is the command as
# written, so no variable's value (the password) is in it.
STEP="starting"
step() { STEP="$1"; echo "with-stack: $1" >&2; }
trap 'echo "with-stack: failed while trying to $STEP: \`$BASH_COMMAND\` (line $LINENO, status $?)" >&2' ERR

compose() { docker compose --project-directory "$DOCKER_DIR" "$@"; }

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    compose logs --tail 80 postgres odudu >&2 || true
  fi
  if [ "${SHOTS_KEEP_STACK:-}" = "1" ]; then
    echo "leaving $COMPOSE_PROJECT_NAME up on http://localhost:$ODUDU_HOST_PORT" >&2
    return
  fi
  compose down -v --remove-orphans || true
}
trap cleanup EXIT

step 'start the stack'
compose up -d ${build_flag[@]+"${build_flag[@]}"} --wait --wait-timeout 180 postgres odudu

# Healthy is not the same as answering: the first request has been seen to fail
# the moment the stack reported healthy, so wait, for a bounded time, for the
# console's own page.
step 'wait for the console'
ready=""
for attempt in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:$ODUDU_HOST_PORT/console/"; then
    ready=1
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "with-stack: the console did not answer on http://localhost:$ODUDU_HOST_PORT/console/ within 60 seconds" >&2
  exit 1
fi

# The first line `seed admin` prints is the administrator's generated password,
# which the console would ask to change at the first sign-in; clearing that one
# required action stands in for the change, so the capture signs straight in.
# The whole output is read before the first line is taken: closing the pipe
# after one line made the command's next write fail, and the run with it.
step 'make the administrator'
seed_errors="$(mktemp)"
seeded="$(compose exec -T odudu node dist/main.js seed admin --username "$ADMIN_EMAIL" 2>"$seed_errors")" || {
  echo "with-stack: seed admin failed; its error output follows" >&2
  cat "$seed_errors" >&2
  rm -f "$seed_errors"
  exit 1
}
rm -f "$seed_errors"
password="${seeded%%$'\n'*}"
if [ -z "$password" ]; then
  echo "with-stack: seed admin printed no password" >&2
  exit 1
fi
compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qc "delete from user_required_actions"'

step 'run the capture'
cd "$REPO/apps/docs"
capture() {
  ODUDU_BASE="http://localhost:$ODUDU_HOST_PORT" \
    ODUDU_ADMIN_EMAIL="$ADMIN_EMAIL" \
    ODUDU_ADMIN_PASSWORD="$password" \
    node --no-warnings "scripts/console-shots/$1" "${@:2}"
}
if [ -n "${SHOTS_SCRIPT:-}" ]; then
  capture "$SHOTS_SCRIPT" "$@"
else
  # The README animation's flow runs first on a check, because it creates the
  # client the screenshots then find; the screenshots create it only if missing.
  if [[ " $* " == *" --check "* ]]; then capture gif.ts "$@"; fi
  capture run.ts "$@"
fi
