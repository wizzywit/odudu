#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "infra/docker/.env is missing. Run: cp infra/docker/.env.example infra/docker/.env" >&2
  echo "This is not done for you: .env holds the values the stack refuses to start without (see docs/adr/0015-environment-driven-credentials.md)." >&2
  exit 1
fi

set -a
source .env
set +a
# The stack refuses to start without the console's private key. Its database is
# new on every run, so a key made for this run is enough and .env stays as it was.
export ODUDU_CONSOLE_CLIENT_KEY="${ODUDU_CONSOLE_CLIENT_KEY:-$(./console-key.sh)}"

# Its own project and ports, so that it runs beside the development stack
# and tearing it down below never takes that stack's containers with it.
export COMPOSE_PROJECT_NAME=odudu-smoke
export ODUDU_HOST_PORT=3100
export POSTGRES_HOST_PORT=5452
BASE="http://localhost:$ODUDU_HOST_PORT"

cleanup() { docker compose down -v --remove-orphans || true; }
trap cleanup EXIT

docker compose up -d --build

ready=0
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/health/ready" > /dev/null 2>&1; then
    echo "odudu became ready"
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "odudu did not become ready within 120s" >&2
  docker compose logs odudu >&2
  exit 1
fi

# /health/ready only runs `select 1`, which needs no table privilege at
# all — it proves odudu_svc can authenticate and nothing more. The checks
# below are the only thing that distinguishes a working RLS grant from
# "permission denied for table tenants" on every real request, and they
# must run against the restricted role from inside the running stack, not
# be asserted from a transcript.
#
# A count of 0 against an empty table is vacuous — it holds whether RLS
# filters, whether the policy exists at all, or even if odudu_svc had
# BYPASSRLS. Inserting a real row as the owner first, then asserting
# odudu_svc still sees 0, is what actually exercises the policy predicate.
# -v ON_ERROR_STOP=1 and letting psql's own output through (rather than
# discarding it) means a failed insert fails this script loudly instead of
# leaving the RLS assertion below vacuous.
docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "insert into tenants (id, name) values ('00000000-0000-0000-0000-000000000001', 'smoke-test-tenant') on conflict (id) do nothing;"

count_output="$(docker compose exec -T postgres \
  psql -U odudu_svc -d "$POSTGRES_DB" -tAc 'select count(*) from tenants;')" || {
  echo "odudu_svc cannot query tenants (grant/RLS wiring is broken)" >&2
  docker compose logs odudu >&2
  exit 1
}
count_output="$(echo "$count_output" | tr -d '[:space:]')"
if [ "$count_output" != "0" ]; then
  echo "expected odudu_svc to see 0 rows in tenants (one row exists, owned by no tenant context), got '$count_output'" >&2
  exit 1
fi
echo "odudu_svc sees 0 rows in tenants despite a real row existing (RLS filters it)"

policy_output="$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select policyname from pg_policies where tablename = 'tenants';")"
policy_output="$(echo "$policy_output" | tr -d '[:space:]')"
if [ "$policy_output" != "tenants_isolation" ]; then
  echo "expected tenants_isolation policy on tenants, got '$policy_output'" >&2
  exit 1
fi
echo "tenants_isolation policy is present"

# A container that boots but never issues a token is not a working server —
# the same trap /health/ready's vacuous pass was, one layer up. This drives
# a full authorization_code-with-PKCE exchange against the running stack:
# seed a tenant and client, request /authorize, submit the login form the
# way a browser would (no browser involved — the code below is that
# browser), redeem the code at /token, and check the access token's typ.
# Every step below uses -f or an explicit status check.
set -o pipefail

docker compose exec -T odudu node dist/main.js seed \
  --tenant smoke --client smoke-app --client-secret smoke-secret \
  --redirect-uri "$BASE/cb" --user smoke --password correct-horse-battery \
  --email smoke@example.com

VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')

# Portable base64url decode (macOS's `base64` and Linux's disagree on their
# decode flag; openssl's is the same on both, and this script already
# leans on openssl for the challenge above).
b64url_decode() {
  local input="$1"
  local rem=$(( ${#input} % 4 ))
  if [ "$rem" -eq 2 ]; then input="${input}=="; elif [ "$rem" -eq 3 ]; then input="${input}="; fi
  printf '%s' "$input" | tr -- '-_' '+/' | openssl base64 -d -A
}

# GET /authorize renders the login form the browser would see; the hidden
# auth_session_id field is this flow's CSRF token, so it has to come from a
# real response, not be fabricated.
AUTH_HTML=$(curl -sS -f --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=smoke-app' \
  --data-urlencode "redirect_uri=$BASE/cb" \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=s' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/tenants/smoke/protocol/openid-connect/auth")

# First match only, and `q` rather than a pipe to `head`, which would
# leave sed to be killed by SIGPIPE under the `pipefail` set above. The
# page carries this field once per form — the password form and the
# passkey one each need it — and a browser submits one form, so taking
# every match would join two ids with a newline and send something no
# `uuid` column can parse. Any form added later is covered by the same
# `q`.
AUTH_SESSION_ID=$(printf '%s' "$AUTH_HTML" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')
test -n "$AUTH_SESSION_ID" || { echo "smoke: no auth_session_id in the rendered login form" >&2; exit 1; }

# POST the credentials the way the login form would, then read the
# authorization code out of the redirect's Location header — no browser
# involved, this is what one would have driven.
LOGIN_HEADERS="$(mktemp)"
curl -sS -f -D "$LOGIN_HEADERS" -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=smoke' \
  --data-urlencode 'password=correct-horse-battery' \
  "$BASE/tenants/smoke/login-actions/authenticate"

CODE=$(grep -i '^location:' "$LOGIN_HEADERS" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r\n')
rm -f "$LOGIN_HEADERS"
test -n "$CODE" || { echo "smoke: no authorization code issued" >&2; exit 1; }

TOKEN_RESPONSE=$(curl -sS -f -u smoke-app:smoke-secret \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$BASE/cb" \
  --data-urlencode "code_verifier=$VERIFIER" \
  "$BASE/tenants/smoke/protocol/openid-connect/token")

ACCESS=$(printf '%s' "$TOKEN_RESPONSE" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
test -n "$ACCESS" || { echo "smoke: no access token issued" >&2; exit 1; }

TYP=$(b64url_decode "${ACCESS%%.*}" | sed -n 's/.*"typ":"\([^"]*\)".*/\1/p')
test "$TYP" = "at+jwt" || { echo "smoke: access token typ was '$TYP', expected at+jwt" >&2; exit 1; }

echo "smoke: full code+PKCE exchange completed against the container"

# The image carries the console build, and the gateway serves it: the shell
# with the exact policy the gateway sets, and a content-hashed asset the
# shell names, cached as immutable. The policy is read from the gateway's
# source, since this job runs with no node_modules to import it through.
EXPECTED_CSP=$(awk '/^export const SHELL_CSP =/{f=1;next} f{print; if (/;$/) exit}' \
  ../../packages/console-gateway/src/view/spa.ts \
  | sed 's/^[^"]*"\(.*\)".*$/\1/' | tr -d '\n')
test -n "$EXPECTED_CSP" || { echo "smoke: could not read SHELL_CSP from spa.ts" >&2; exit 1; }

SHELL_HEADERS="$(mktemp)"
SHELL_HTML=$(curl -sS -D "$SHELL_HEADERS" "$BASE/console/")
SHELL_STATUS=$(sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p' "$SHELL_HEADERS")
SHELL_CSP=$({ grep -i '^content-security-policy:' "$SHELL_HEADERS" || true; } | sed 's/^[^:]*: //' | tr -d '\r\n')
rm -f "$SHELL_HEADERS"
test "$SHELL_STATUS" = "200" || { echo "smoke: GET /console/ answered $SHELL_STATUS, expected 200" >&2; exit 1; }
test "$SHELL_CSP" = "$EXPECTED_CSP" || {
  echo "smoke: the shell's CSP was '$SHELL_CSP', expected '$EXPECTED_CSP'" >&2
  exit 1
}

ASSET=$(printf '%s' "$SHELL_HTML" | sed -n 's/.*src="\(\/console\/assets\/[^"]*\)".*/\1/p' | sed -n 1p)
test -n "$ASSET" || { echo "smoke: the shell names no /console/assets/ script" >&2; exit 1; }
ASSET_HEADERS=$(curl -sS -D - -o /dev/null "$BASE$ASSET")
ASSET_STATUS=$(printf '%s' "$ASSET_HEADERS" | sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
test "$ASSET_STATUS" = "200" || { echo "smoke: GET $ASSET answered $ASSET_STATUS, expected 200" >&2; exit 1; }
printf '%s' "$ASSET_HEADERS" | grep -i '^cache-control:.*immutable' > /dev/null || {
  echo "smoke: $ASSET is not cached as immutable" >&2
  exit 1
}

echo "smoke: the console shell and $ASSET are served from the image"

exit 0
