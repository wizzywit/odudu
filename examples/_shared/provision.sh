#!/usr/bin/env bash
# Makes what the examples sign in with, in the `demo` tenant of a running
# quickstart stack: the people `ada` and `ben`, a web app, a single-page app,
# a Next.js app, a React app behind a backend for frontend, services and a
# command-line tool. Run it from the folder that holds compose.yaml, or set
# COMPOSE_FILE. Running it again changes nothing: `seed` does not amend, so a
# rerun with another ODUDU_BASE keeps the audience of the clients it made the
# first time, and does not repair a client made without --capability or by an
# older version of this script. Reset the stack for either.
#
# Every secret here is published in this repository. They are for a stack on
# your own machine and must never be used anywhere else.
set -euo pipefail

WEB_APP_ORIGIN="${WEB_APP_ORIGIN:-http://localhost:8081}"
SPA_ORIGIN="${SPA_ORIGIN:-http://localhost:8084}"
NEXT_APP_ORIGIN="${NEXT_APP_ORIGIN:-http://localhost:8085}"
REACT_BFF_ORIGIN="${REACT_BFF_ORIGIN:-http://localhost:8083}"
ADMIN_CLI_ORIGIN="${ADMIN_CLI_ORIGIN:-http://127.0.0.1:8086}"
ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}"
ADMIN_API_AUDIENCE=urn:odudu:params:admin-api

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
# A command-line tool signs a person in at a loopback address (RFC 8252). It
# asks for the person's own account, so it may name the me audience and holds
# me:read, which --allow-action gives a client.
seed client --tenant demo --client-id example-admin-cli --public --grant-type authorization_code \
  --redirect-uri "$ADMIN_CLI_ORIGIN/callback" --audience "$ODUDU_BASE/tenants/demo/me" \
  --allow-action verify-email

# A service that calls the admin API asks for its audience, and what it may do
# there is the admin capabilities its account holds, which --capability gives it.
seed client --tenant demo --client-id example-admin --client-secret example-admin-secret \
  --grant-type client_credentials --audience "$ADMIN_API_AUDIENCE" --capability manage-clients
# The key an MCP client signs in with is made by whoever runs it and registered
# on this client; the secret here is never used again after that.
seed client --tenant demo --client-id example-mcp --client-secret example-mcp-secret \
  --grant-type client_credentials --client-credentials-scope mcp:read \
  --audience "$ADMIN_API_AUDIENCE" --capability manage-clients
