#!/usr/bin/env bash
# Adds ODUDU_CONSOLE_CLIENT_KEY to infra/docker/.env when it holds none, and
# changes nothing when it does. The compose stack refuses to start without
# one, and a private key is not something .env.example may carry. Every tenant
# registers the key's public half when it is created, so a stack's key must
# outlive the stack's volume: change it and `odudu console provision` has to
# run (README, "Rotating the console's key").
set -euo pipefail

ENV_FILE="${1:-$(cd "$(dirname "$0")" && pwd)/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE is missing. Run: cp infra/docker/.env.example infra/docker/.env" >&2
  exit 1
fi

if grep -q '^ODUDU_CONSOLE_CLIENT_KEY=.' "$ENV_FILE"; then
  exit 0
fi

key="$("$(dirname "$0")/console-key.sh")"
printf '\nODUDU_CONSOLE_CLIENT_KEY=%s\n' "$key" >> "$ENV_FILE"
echo "added ODUDU_CONSOLE_CLIENT_KEY to $ENV_FILE" >&2
