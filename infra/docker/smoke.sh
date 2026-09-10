#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

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
count_output="$(docker compose exec -T postgres \
  psql -U odudu_svc -d odudu -tAc 'select count(*) from realms;')" || {
  echo "odudu_svc cannot query realms (grant/RLS wiring is broken)" >&2
  docker compose logs odudu >&2
  exit 1
}
count_output="$(echo "$count_output" | tr -d '[:space:]')"
if [ "$count_output" != "0" ]; then
  echo "expected odudu_svc to see 0 rows in realms, got '$count_output'" >&2
  exit 1
fi
echo "odudu_svc can query realms and sees 0 rows"

policy_output="$(docker compose exec -T postgres \
  psql -U odudu -d odudu -tAc "select policyname from pg_policies where tablename = 'realms';")"
policy_output="$(echo "$policy_output" | tr -d '[:space:]')"
if [ "$policy_output" != "realms_isolation" ]; then
  echo "expected realms_isolation policy on realms, got '$policy_output'" >&2
  exit 1
fi
echo "realms_isolation policy is present"

exit 0
