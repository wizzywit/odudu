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

cleanup() { docker compose down -v --remove-orphans || true; }
trap cleanup EXIT

docker compose up -d --build

ready=0
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health/ready > /dev/null 2>&1; then
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
# "permission denied for table realms" on every real request, and they
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
  "insert into realms (id, name) values ('00000000-0000-0000-0000-000000000001', 'smoke-test-realm') on conflict (id) do nothing;"

count_output="$(docker compose exec -T postgres \
  psql -U odudu_svc -d "$POSTGRES_DB" -tAc 'select count(*) from realms;')" || {
  echo "odudu_svc cannot query realms (grant/RLS wiring is broken)" >&2
  docker compose logs odudu >&2
  exit 1
}
count_output="$(echo "$count_output" | tr -d '[:space:]')"
if [ "$count_output" != "0" ]; then
  echo "expected odudu_svc to see 0 rows in realms (one row exists, owned by no realm context), got '$count_output'" >&2
  exit 1
fi
echo "odudu_svc sees 0 rows in realms despite a real row existing (RLS filters it)"

policy_output="$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select policyname from pg_policies where tablename = 'realms';")"
policy_output="$(echo "$policy_output" | tr -d '[:space:]')"
if [ "$policy_output" != "realms_isolation" ]; then
  echo "expected realms_isolation policy on realms, got '$policy_output'" >&2
  exit 1
fi
echo "realms_isolation policy is present"

# A container that boots but never issues a token is not a working server —
# the same trap /health/ready's vacuous pass was, one layer up. This drives
# a full authorization_code-with-PKCE exchange against the running stack:
# seed a realm and client, request /authorize, submit the login form the
# way a browser would (no browser involved — the code below is that
# browser), redeem the code at /token, and check the access token's typ.
# Every step below uses -f or an explicit status check.
set -o pipefail

docker compose exec -T odudu node dist/main.js seed \
  --realm smoke --client smoke-app --client-secret smoke-secret \
  --redirect-uri http://localhost:3000/cb --user smoke --password smoke-password

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
  --data-urlencode 'redirect_uri=http://localhost:3000/cb' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=s' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/smoke/protocol/openid-connect/auth')

AUTH_SESSION_ID=$(printf '%s' "$AUTH_HTML" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')
test -n "$AUTH_SESSION_ID" || { echo "smoke: no auth_session_id in the rendered login form" >&2; exit 1; }

# POST the credentials the way the login form would, then read the
# authorization code out of the redirect's Location header — no browser
# involved, this is what one would have driven.
LOGIN_HEADERS="$(mktemp)"
curl -sS -f -D "$LOGIN_HEADERS" -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=smoke' \
  --data-urlencode 'password=smoke-password' \
  'http://localhost:3000/realms/smoke/login-actions/authenticate'

CODE=$(grep -i '^location:' "$LOGIN_HEADERS" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r\n')
rm -f "$LOGIN_HEADERS"
test -n "$CODE" || { echo "smoke: no authorization code issued" >&2; exit 1; }

TOKEN_RESPONSE=$(curl -sS -f -u smoke-app:smoke-secret \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:3000/cb' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/smoke/protocol/openid-connect/token')

ACCESS=$(printf '%s' "$TOKEN_RESPONSE" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
test -n "$ACCESS" || { echo "smoke: no access token issued" >&2; exit 1; }

TYP=$(b64url_decode "${ACCESS%%.*}" | sed -n 's/.*"typ":"\([^"]*\)".*/\1/p')
test "$TYP" = "at+jwt" || { echo "smoke: access token typ was '$TYP', expected at+jwt" >&2; exit 1; }

echo "smoke: full code+PKCE exchange completed against the container"

exit 0
