---
title: Protect an API
description: Decide whether to trust the access token a caller sends your API, by finding the tenant's keys and checking the token's issuer, expiry and signature.
sidebar_position: 7
---

# Protect an API

Callers reach your API with an access token in the `Authorization` header. Your API's job is to decide, on its own and without asking Odudu each time, whether to trust it. You will get a token to test with, read it, find the keys that sign it and run the checks your API runs.

You need the stack from the [quick start](../quick-start/index.mdx) with its `demo` tenant. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

## 2. Get a token to test with

Register a caller and ask for a token, the way [a service does](./machine-to-machine.md). A token a person's sign-in produced is checked the same way.

```sh {run}
CALLER_SECRET=$(openssl rand -hex 24)
```

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-api-caller --client-secret "$CALLER_SECRET" --grant-type client_credentials
```

```sh {run}
TOKEN=$(curl -fsS -u "my-api-caller:$CALLER_SECRET" --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
```

## 3. Read the token

A token has three parts joined by dots: a header, the claims and a signature. This helper decodes the first two. Give it the token and the part's number.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f"$2" | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

The header says how the token was signed and with which key.

```sh {run expect="RS256"}
decode "$TOKEN" 1
```

The claims say who issued it, who it is for and until when.

```sh {run expect="my-api-caller"}
decode "$TOKEN" 2
```

Reading a token is not trusting it. Anyone can write a token that looks like this. The next steps are what make one trustworthy.

## 4. Find the tenant's keys

Odudu publishes the public keys that verify its tokens at an address the discovery document names. Your API reads that address once, keeps the keys, and refetches when it meets a `kid` it does not know.

```sh {run expect="/certs"}
curl -fsS "$TENANT/.well-known/openid-configuration" | sed -n 's/.*"jwks_uri":"\([^"]*\)".*/\1/p'
```

The token's header names its key by `kid`. Check that the key is published.

```sh {run expect="is published"}
KID=$(decode "$TOKEN" 1 | sed -n 's/.*"kid":"\([^"]*\)".*/\1/p') && curl -fsS "$TENANT/protocol/openid-connect/certs" | grep -q "$KID" && echo "key $KID is published"
```

## 5. Run the checks

Your API runs these checks on every request, in this order, and refuses the request if any fails.

1. **The signature.** Verify it with the published key named by `kid`, and accept only the algorithm you expect, RS256 here. A JOSE library for your language does this; give it the keys from the previous step. Do not write it yourself.
2. **The issuer.** The `iss` claim must be the tenant you trust, exactly.
3. **The expiry.** The `exp` claim must be in the future.
4. **The audience.** The `aud` claim must name your API.
5. **The scope.** The `scope` claim must allow what the caller is doing.

You can run the second and third checks here. The issuer in the token must equal the issuer in the tenant's discovery document.

```sh {run expect="issuer matches"}
ISS=$(decode "$TOKEN" 2 | sed -n 's/.*"iss":"\([^"]*\)".*/\1/p') && DISCOVERED=$(curl -fsS "$TENANT/.well-known/openid-configuration" | sed -n 's/.*"issuer":"\([^"]*\)".*/\1/p') && test "$ISS" = "$DISCOVERED" && echo "issuer matches: $ISS"
```

The expiry must be ahead of the clock.

```sh {run expect="not expired"}
EXP=$(decode "$TOKEN" 2 | sed -n 's/.*"exp":\([0-9]*\).*/\1/p') && NOW=$(date +%s) && test "$EXP" -gt "$NOW" && echo "not expired: $((EXP - NOW)) seconds left"
```

For the audience, the token above names the tenant's own address. A token that names your API in particular needs the client's audiences set, which the command line does not do yet: the [roadmap](../roadmap.md) places it, and the admin API does it today.

## 6. Notice what a local check cannot see

Checking a token yourself is fast, and it cannot know that a session just ended or that the token was revoked. Until the token's `exp`, a signature check still passes. For an API where that matters, ask Odudu: [token introspection](../reference/transcripts/request-paths/rp-initiated-logout.md#token-introspection-and-revocation) answers whether a token is still active, immediately. Keep access tokens short, as Odudu does by default at five minutes, and a local check is usually enough.

## 7. Run a finished API

A JOSE library runs the checks above in one call: the signature against the tenant's keys, the issuer, the audience, the type and the expiry. [The API example](https://github.com/wizzywit/odudu/tree/main/examples/api) is a small server that does exactly that with the `@odudu-io/node` SDK, answers a token it trusts and refuses an ID token and a token for another audience. Its README says how to run it against your stack.

## Where to go next

- Get a token for a person with [Sign people in to a web app](./web-app.md) or [Sign people in to a single-page app](./single-page-app.md).
- Read what your API should do when a token is refused in [Read a refusal](./read-a-refusal.md).
