#!/usr/bin/env bash
# Reproduces the Basic OP run recorded under results/. Not wired into CI —
# see README.md's answer to spike 3 for why Config OP is the automated
# plan and this one stays a manual, reproducible run. Exports the plan's
# results to $OUT_DIR (default: a temp directory) on the way out; it does
# not overwrite the committed results/ files. Promoting a run into results/
# is deliberate and manual: copy the summary and the zip in, then delete the
# oldest run's pair — README.md's "What results/ keeps" explains why two.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_TAG="release-v5.1.36"
SUITE_DIR="${SUITE_DIR:-$(mktemp -d)/conformance-suite}"
OUT_DIR="${OUT_DIR:-$(mktemp -d)}"
mkdir -p "$OUT_DIR"
NETWORK=odudu-conformance
REALM=conformance

cleanup() {
  docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" down -v --remove-orphans || true
  SUITE_DIR="$SUITE_DIR" docker compose -p oidf-suite -f "$SCRIPT_DIR/suite-compose.yaml" down -v --remove-orphans || true
}
trap cleanup EXIT

if [ ! -f "$SUITE_DIR/target/fapi-test-suite.jar" ]; then
  echo "Cloning and building the conformance suite ($SUITE_TAG) — this only happens once per SUITE_DIR"
  git clone --depth 1 --branch "$SUITE_TAG" \
    https://gitlab.com/openid/conformance-suite.git "$SUITE_DIR"
  MAVEN_CACHE="${MAVEN_CACHE:-$SUITE_DIR/../m2}"
  mkdir -p "$MAVEN_CACHE"
  (cd "$SUITE_DIR" && MAVEN_CACHE="$MAVEN_CACHE" docker compose -f builder-compose.yml run --rm builder)
fi

docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK"

docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" up -d --build

echo "Waiting for odudu to report ready"
ready=0
for _ in $(seq 1 60); do
  if docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
    wget -qO- http://127.0.0.1:3000/health/ready > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "odudu did not become ready" >&2; exit 1; }

docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
  node dist/main.js seed --realm "$REALM" \
  --client conformance-client --client-secret conformance-secret \
  --redirect-uri "https://localhost.emobix.co.uk:8443/test/a/odudu-basic-op/callback" \
  --user conformance-user --password conformance-password

# basic-op.json's "client2" — oidcc-refresh-token and the other
# AbstractOIDCCMultipleClient modules run a second static client, and they
# authenticate it with client_secret_basic, so it is seeded that way: odudu
# rejects a Basic header from a client registered for client_secret_post,
# and would answer invalid_client at the token endpoint otherwise.
docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
  node dist/main.js seed --realm "$REALM" \
  --client conformance-client-2 --client-secret conformance-secret-2 \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri "https://localhost.emobix.co.uk:8443/test/a/odudu-basic-op/callback"

# basic-op.json's "client_secret_post" — a distinct client, because
# oidcc-server-client-secret-post sends the secret in the request body and
# odudu only accepts that from a client registered for it. Sharing one
# client with the client2 slot would make one of the two slots unusable
# whichever method it were registered with.
docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
  node dist/main.js seed --realm "$REALM" \
  --client conformance-client-post --client-secret conformance-secret-post \
  --token-endpoint-auth-method client_secret_post \
  --redirect-uri "https://localhost.emobix.co.uk:8443/test/a/odudu-basic-op/callback"

SUITE_DIR="$SUITE_DIR" docker compose -p oidf-suite -f "$SCRIPT_DIR/suite-compose.yaml" up -d

echo "Waiting for the conformance suite to report ready"
ready=0
for _ in $(seq 1 60); do
  if curl -fsSk https://localhost:8443/api/runner/available > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "conformance suite did not become ready" >&2; exit 1; }

VARIANT='{"server_metadata":"discovery","client_registration":"static_client"}'
VARIANT_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$VARIANT")
PLAN=$(curl -fsSk -X POST \
  "https://localhost:8443/api/plan?planName=oidcc-basic-certification-test-plan&variant=$VARIANT_ENC" \
  -H "Content-Type: application/json" \
  --data @"$SCRIPT_DIR/basic-op.json")
PLAN_ID=$(echo "$PLAN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Created plan $PLAN_ID"

MODULES=$(echo "$PLAN" | python3 -c "
import json, sys
for m in json.load(sys.stdin)['modules']:
    print(m['testModule'])
")

SUMMARY="$OUT_DIR/basic-op-summary.json"
echo "[" > "$SUMMARY"
first=1
for m in $MODULES; do
  RUN=$(curl -fsSk -X POST "https://localhost:8443/api/runner?test=$m&plan=$PLAN_ID")
  TEST_ID=$(echo "$RUN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  STATUS="?"
  RESULT="?"
  for _ in $(seq 1 15); do
    sleep 2
    INFO=$(curl -fsSk "https://localhost:8443/api/info/$TEST_ID")
    STATUS=$(echo "$INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))")
    RESULT=$(echo "$INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result','?'))")
    case "$STATUS" in
      FINISHED|INTERRUPTED) break ;;
    esac
  done
  echo "$m: status=$STATUS result=$RESULT"
  [ "$first" -eq 1 ] || echo "," >> "$SUMMARY"
  first=0
  printf '{"module":"%s","testId":"%s","status":"%s","result":"%s"}' \
    "$m" "$TEST_ID" "$STATUS" "$RESULT" >> "$SUMMARY"
done
echo "]" >> "$SUMMARY"

curl -sk "https://localhost:8443/api/plan/export/$PLAN_ID" -o "$OUT_DIR/basic-op-logs.zip"

echo "Summary: $SUMMARY"
echo "Full export: $OUT_DIR/basic-op-logs.zip"
