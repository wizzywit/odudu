#!/usr/bin/env bash
# Drives two MCP clients we did not write against a built server: the MCP
# Inspector's CLI and the TypeScript SDK's client. Together they discover the
# sign-in from the 401 challenge, register under the `mcp` policy, run the
# authorization code flow with PKCE and the `resource` parameter, list the
# tools and call some in each protocol era, and are refused a write by a read
# token. A scripted person signs in and approves (mcp/signin.mjs). The
# `mcp` job in .github/workflows/verify.yml runs it; it brings up and removes
# its own compose project, so it runs the same way locally. With
# MCP_PREBUILT=1 it starts the image `odudu-mcp-odudu`, the name compose gives it, instead of building it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Exact, and older than pnpm-workspace.yaml's minimumReleaseAge: npm has no
# such floor, so the pin is the floor.
INSPECTOR_VERSION=2.13.0
SDK_CLIENT_VERSION=2.4.0
# The read tools a token holding mcp:read lists for a tenant's administrator;
# the two that list tenants are the system tenant's agent's alone.
export EXPECT_READ_TOOLS=62

PROJECT=odudu-mcp
export ODUDU_MCP_PORT="${ODUDU_MCP_PORT:-3190}"
export ODUDU_CONSOLE_CLIENT_KEY="${ODUDU_CONSOLE_CLIENT_KEY:-$("$SCRIPT_DIR/../docker/console-key.sh")}"
TENANT=mcp-conformance
USERNAME=ada
PASSWORD=mcp-conformance-throwaway-password
TENANT_URL="http://localhost:$ODUDU_MCP_PORT/tenants/$TENANT"
WORK="$(mktemp -d)"
STARTED=$SECONDS

compose() {
  docker compose -p "$PROJECT" -f "$SCRIPT_DIR/mcp-compose.yaml" "$@"
}

odudu() {
  compose exec -T odudu node dist/main.js "$@" > /dev/null
}

cleanup() {
  compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "mcp run failed: $*" >&2
  exit 1
}

build_flag=(--build)
if [ "${MCP_PREBUILT:-}" = "1" ]; then build_flag=(); fi
compose up -d ${build_flag[@]+"${build_flag[@]}"} --wait odudu > "$WORK/compose.log" 2>&1 \
  || { cat "$WORK/compose.log" >&2; fail "the stack did not come up"; }

odudu seed tenant --name "$TENANT" --set client_registration_policy=mcp
odudu seed user --tenant "$TENANT" --username "$USERNAME" --password "$PASSWORD" --email ada@example.com
odudu seed grant-role --tenant "$TENANT" --username "$USERNAME" --role odudu-admin:tenant-admin

cat > "$WORK/package.json" <<JSON
{ "name": "mcp-clients", "private": true, "type": "module" }
JSON
(
  cd "$WORK"
  npm install --ignore-scripts --no-audit --no-fund --save-exact \
    "@modelcontextprotocol/inspector@$INSPECTOR_VERSION" \
    "@modelcontextprotocol/client@$SDK_CLIENT_VERSION" > npm.log 2>&1
) || { cat "$WORK/npm.log" >&2; fail "could not install the clients"; }
cp "$SCRIPT_DIR"/mcp/*.mjs "$WORK/"

(
  cd "$WORK"
  node inspector.mjs "$WORK/node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js" \
    "$WORK" "$TENANT_URL" "$USERNAME" "$PASSWORD"
) || fail "the Inspector run"
(
  cd "$WORK"
  node sdk.mjs "$TENANT_URL" "$USERNAME" "$PASSWORD"
) || fail "the SDK run"

echo "mcp run passed in $((SECONDS - STARTED))s (inspector $INSPECTOR_VERSION, sdk client $SDK_CLIENT_VERSION)"
