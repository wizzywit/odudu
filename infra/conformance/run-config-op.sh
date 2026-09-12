#!/usr/bin/env bash
# Brings up the OpenID Foundation conformance suite and odudu on a shared
# docker network, seeds a realm, runs the Config OP discovery plan through
# the suite's own HTTP API (no browser, no token — see README.md), and
# fails the build on any test that does not pass. This is the script the
# `conformance` job in .github/workflows/verify.yml runs; it is also the
# fastest way to reproduce that job locally.
set -euo pipefail
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_TAG="release-v5.1.36"
SUITE_DIR="${SUITE_DIR:-$(mktemp -d)/conformance-suite}"
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
  node dist/main.js seed --realm "$REALM" --client conformance-client \
  --client-secret conformance-secret \
  --redirect-uri "https://localhost.emobix.co.uk:8443/test/a/odudu-config-op/callback"

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

PLAN=$(curl -fsSk -X POST \
  "https://localhost:8443/api/plan?planName=oidcc-config-certification-test-plan" \
  -H "Content-Type: application/json" \
  --data @"$SCRIPT_DIR/config-op.json")
PLAN_ID=$(echo "$PLAN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Created plan $PLAN_ID"

RUN=$(curl -fsSk -X POST \
  "https://localhost:8443/api/runner?test=oidcc-discovery-endpoint-verification&plan=$PLAN_ID")
TEST_ID=$(echo "$RUN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Started test $TEST_ID"

STATUS=""
for _ in $(seq 1 30); do
  sleep 2
  INFO=$(curl -fsSk "https://localhost:8443/api/info/$TEST_ID")
  STATUS=$(echo "$INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))")
  case "$STATUS" in
    FINISHED|INTERRUPTED) break ;;
  esac
done

RESULT=$(echo "$INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result','?'))")
echo "Config OP result: status=$STATUS result=$RESULT"

if [ "$RESULT" != "PASSED" ]; then
  echo "Config OP did not pass — full log follows" >&2
  curl -sk "https://localhost:8443/api/log/$TEST_ID" >&2
  exit 1
fi

echo "Config OP passed"
