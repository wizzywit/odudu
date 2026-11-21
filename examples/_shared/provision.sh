#!/usr/bin/env bash
# Makes what the examples sign in with, in the `demo` tenant of a running
# quickstart stack: the people `ada` and `ben`, a web app, a single-page app,
# a Next.js app, a React app behind a backend for frontend and a service. Run
# it from the folder that holds compose.yaml, or set COMPOSE_FILE. Running it
# again changes nothing.
#
# Every secret here is published in this repository. They are for a stack on
# your own machine and must never be used anywhere else.
set -euo pipefail

WEB_APP_ORIGIN="${WEB_APP_ORIGIN:-http://localhost:8081}"
SPA_ORIGIN="${SPA_ORIGIN:-http://localhost:8084}"
NEXT_APP_ORIGIN="${NEXT_APP_ORIGIN:-http://localhost:8085}"
REACT_BFF_ORIGIN="${REACT_BFF_ORIGIN:-http://localhost:8083}"

seed() {
  local output
  if ! output=$(docker compose exec -T odudu odudu seed "$@" 2>&1); then
    case "$output" in
      *"already exists"*) return 0 ;;
      *) printf '%s\n' "$output" >&2; return 1 ;;
    esac
  fi
  printf '%s\n' "$output"
}

seed tenant --name demo
# Sign-in is limited to five tries a minute per person and ten per address, so
# the tests that sign in over and over share the load between two people.
seed user --tenant demo --username ada --password 'a long and unremarkable passphrase'
seed user --tenant demo --username ben --password 'a long and unremarkable passphrase'
seed client --tenant demo --client-id example-web --client-secret example-web-secret \
  --redirect-uri "$WEB_APP_ORIGIN/callback" --post-logout-redirect-uri "$WEB_APP_ORIGIN/"
seed client --tenant demo --client-id example-m2m --client-secret example-m2m-secret \
  --grant-type client_credentials --client-credentials-scope reports:read
seed client --tenant demo --client-id example-spa --public --grant-type authorization_code \
  --redirect-uri "$SPA_ORIGIN/callback" --post-logout-redirect-uri "$SPA_ORIGIN/" \
  --web-origin "$SPA_ORIGIN"
seed client --tenant demo --client-id example-next --client-secret example-next-secret \
  --grant-type authorization_code --grant-type refresh_token \
  --redirect-uri "$NEXT_APP_ORIGIN/api/auth/callback" --post-logout-redirect-uri "$NEXT_APP_ORIGIN/"
seed client --tenant demo --client-id example-react-bff --client-secret example-react-bff-secret \
  --grant-type authorization_code --grant-type refresh_token \
  --redirect-uri "$REACT_BFF_ORIGIN/bff/callback" --post-logout-redirect-uri "$REACT_BFF_ORIGIN/"
