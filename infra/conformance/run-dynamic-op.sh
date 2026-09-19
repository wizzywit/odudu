#!/usr/bin/env bash
# Reproduces the Dynamic OP run recorded under results/. Not wired to gate
# CI — the plan cannot pass by construction (ADR 0031) — but the
# `conformance` job still runs it, against the suite jar the Config OP step
# already built, so at minimum the plan is proven to still run to
# completion on every push. Nothing here compares a run's outcome against
# the committed baseline, so a module failing for a new reason does not
# yet surface on its own — that comparison is unbuilt, not implied. Exports
# the plan's results to $OUT_DIR (default: a temp directory) on the way
# out; it does not overwrite the committed results/ files. Promoting a run
# into results/ is deliberate and manual, exactly as run-basic-op.sh's is.
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

# The Dynamic OP plan registers its own clients through the realm's
# registration endpoint, so no client is seeded here — only a realm open to
# anonymous registration, and the one user the browser tasks log in as.
docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
  node dist/main.js seed realm --name "$REALM" --set client_registration_policy=open

docker compose -p odudu-conformance -f "$SCRIPT_DIR/compose.yaml" exec -T odudu \
  node dist/main.js seed user --realm "$REALM" \
  --username conformance-user --password conformance-password

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

# ResponseType is the one variant dimension OIDCCDynamicTestPlan leaves for
# the caller — everything else (ClientAuthType, ClientRegistration,
# ResponseMode) is fixed per module group in the plan's own source. Odudu
# is code-only, so code is the only value that could ever be selected.
VARIANT='{"response_type":"code"}'
VARIANT_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$VARIANT")
PLAN=$(curl -fsSk -X POST \
  "https://localhost:8443/api/plan?planName=oidcc-dynamic-certification-test-plan&variant=$VARIANT_ENC" \
  -H "Content-Type: application/json" \
  --data @"$SCRIPT_DIR/dynamic-op.json")
PLAN_ID=$(echo "$PLAN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Created plan $PLAN_ID"

MODULES=$(echo "$PLAN" | python3 -c "
import json, sys
for m in json.load(sys.stdin)['modules']:
    print(m['testModule'])
")

SUMMARY="$OUT_DIR/dynamic-op-summary.json"
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

curl -sk "https://localhost:8443/api/plan/export/$PLAN_ID" -o "$OUT_DIR/dynamic-op-logs.zip"

echo "Summary: $SUMMARY"
echo "Full export: $OUT_DIR/dynamic-op-logs.zip"
