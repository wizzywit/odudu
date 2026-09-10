#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "infra/docker/.env is missing. Run: cp infra/docker/.env.example infra/docker/.env" >&2
  echo "This is not done for you: .env holds the values the stack refuses to start without (see docs/adr/0015-environment-driven-credentials.md)." >&2
  exit 1
fi

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
docker compose exec -T postgres \
  psql -U odudu -d odudu -c \
  "insert into realms (id, name) values ('00000000-0000-0000-0000-000000000001', 'smoke-test-realm') on conflict (id) do nothing;" \
  > /dev/null

count_output="$(docker compose exec -T postgres \
  psql -U odudu_svc -d odudu -tAc 'select count(*) from realms;')" || {
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
  psql -U odudu -d odudu -tAc "select policyname from pg_policies where tablename = 'realms';")"
policy_output="$(echo "$policy_output" | tr -d '[:space:]')"
if [ "$policy_output" != "realms_isolation" ]; then
  echo "expected realms_isolation policy on realms, got '$policy_output'" >&2
  exit 1
fi
echo "realms_isolation policy is present"

exit 0
