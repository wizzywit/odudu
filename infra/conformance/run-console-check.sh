#!/usr/bin/env bash
# Signs an administrator in to the console through this stack's TLS proxy
# and fails on any console cookie that comes back without its __Host- name,
# Secure, HttpOnly, SameSite and Path=/. The compose stack in infra/docker
# serves plain HTTP, so this is the only run in which the console's https
# mode is observed rather than unit-tested. The `conformance` job in
# .github/workflows/verify.yml runs it; it brings up and removes its own
# compose project, so it runs the same way locally.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The stack refuses to start without the console's key, and none is committed.
export ODUDU_CONSOLE_CLIENT_KEY="${ODUDU_CONSOLE_CLIENT_KEY:-$("$SCRIPT_DIR/../docker/console-key.sh")}"
PROJECT=odudu-console-check
NETWORK=odudu-conformance
TENANT=console-check
USERNAME=grace
PASSWORD=console-check-throwaway-password
WORK="$(mktemp -d)"
created_network=0

compose() {
  docker compose -p "$PROJECT" -f "$SCRIPT_DIR/compose.yaml" "$@"
}

cleanup() {
  compose down -v --remove-orphans || true
  if [ "$created_network" -eq 1 ]; then docker network rm "$NETWORK" > /dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "console check failed: $*" >&2
  exit 1
}

if ! docker network inspect "$NETWORK" > /dev/null 2>&1; then
  docker network create "$NETWORK" > /dev/null
  created_network=1
fi

compose up -d --build --wait odudu proxy
compose cp proxy:/etc/nginx/conformance.crt "$WORK/ca.crt"

# The browser's view: https://odudu, the ODUDU_PUBLIC_BASE_URL compose.yaml
# sets, reached through the proxy's published port and trusted by its CA.
browse() {
  curl -sS --cacert "$WORK/ca.crt" --connect-to odudu:443:127.0.0.1:8543 \
    -c "$WORK/jar" -b "$WORK/jar" -D "$WORK/headers" -o "$WORK/body" "$@"
}

status() {
  head -n 1 "$WORK/headers" | cut -d' ' -f2
}

location() {
  grep -i '^location:' "$WORK/headers" | cut -d' ' -f2- | tr -d '\r'
}

expect_status() {
  [ "$(status)" = "$1" ] || { cat "$WORK/headers" "$WORK/body" >&2; fail "$2 answered $(status), not $1"; }
}

# Every attribute named must be present exactly as written.
expect_cookie() {
  local name="$1"
  shift
  local line
  line="$(grep -i "^set-cookie: $name=" "$WORK/headers" | tr -d '\r' || true)"
  [ -n "$line" ] || fail "no $name cookie was set"
  local attributes shown
  attributes="$(echo "${line#*: }" | tr ';' '\n' | tail -n +2 | sed 's/^ *//')"
  shown="$(echo "$line" | sed 's/=[^;]*;/=…;/')"
  for want in "$@"; do
    echo "$attributes" | grep -qx -- "$want" || fail "$name lacks $want: $shown"
  done
  echo "ok: $shown"
}

ready=0
for _ in $(seq 1 60); do
  if browse https://odudu/health/ready && [ "$(status)" = "200" ]; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || fail "odudu did not become ready behind the proxy"

compose exec -T odudu node dist/main.js seed tenant --name "$TENANT"
compose exec -T odudu node dist/main.js seed user --tenant "$TENANT" \
  --username "$USERNAME" --password "$PASSWORD" --email grace@example.com
compose exec -T odudu node dist/main.js seed grant-role --tenant "$TENANT" \
  --username "$USERNAME" --role odudu-admin:tenant-admin

browse "https://odudu/console/auth/login?tenant=$TENANT&return_to=/console/"
expect_status 302 "GET /console/auth/login"
expect_cookie __Host-odudu-console-login Secure HttpOnly SameSite=Lax Path=/
authorize="$(location)"

browse "$authorize"
expect_status 200 "the tenant's authorization endpoint"
auth_session_id="$(sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' "$WORK/body" | head -n 1)"
[ -n "$auth_session_id" ] || fail "the sign-in form carried no auth_session_id"

browse -X POST \
  --data-urlencode "auth_session_id=$auth_session_id" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  "https://odudu/tenants/$TENANT/login-actions/authenticate"
expect_status 302 "the tenant's sign-in"
callback="$(location)"
case "$callback" in
  https://odudu/console/auth/callback\?*) ;;
  *) fail "the sign-in redirected to $callback, not the console's callback" ;;
esac

browse "$callback"
expect_status 302 "GET /console/auth/callback"
expect_cookie __Host-odudu-console Secure HttpOnly SameSite=Strict Path=/

browse https://odudu/console/api/session
expect_status 200 "GET /console/api/session"
grep -q "\"tenant\":\"$TENANT\"" "$WORK/body" || fail "the session names another tenant: $(cat "$WORK/body")"

echo "console check passed"
