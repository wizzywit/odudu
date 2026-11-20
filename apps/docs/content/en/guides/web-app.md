---
title: Sign people in to a web app
description: Register a web app that keeps a secret, send a person to Odudu to sign in and swap the code you get back for tokens, with commands you can run.
sidebar_position: 5
---

# Sign people in to a web app

Your web app has a server, and the server can keep a secret. That makes it a confidential client: it proves who it is to Odudu when it swaps a sign-in code for tokens. You will register the app, send a person to Odudu, and finish with their ID token in your hands.

You need the stack from the [quick start](../quick-start/index.mdx), with its `demo` tenant and its user `ada`. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed.

## 1. Point the commands at your server

The commands read the server's address from one variable. If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

## 2. Register the app

Make a secret for the app. Keep it on your server and out of the code you ship.

```sh {run}
CLIENT_SECRET=$(openssl rand -hex 24)
```

Register `my-web-app` with that secret. The redirect address is where Odudu sends the person after they sign in. It has to match the address your app sends later, character for character.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-web-app --client-secret "$CLIENT_SECRET" --redirect-uri http://localhost:8080/callback
```

## 3. Send the person to Odudu

Before you send anyone, your server makes a random value, the verifier, and its fingerprint, the challenge. It keeps the verifier and sends only the challenge. When the code comes back, the verifier proves that the same server is asking for the tokens.

```sh {run}
VERIFIER=$(openssl rand -hex 32)
```

```sh {run}
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

Now build the address your app redirects the browser to. `state` is a value you will compare when the person comes back, and `nonce` will appear in the ID token.

```sh {run}
AUTHORIZE_URL="$TENANT/protocol/openid-connect/auth?response_type=code&client_id=my-web-app&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid%20profile%20email&state=abc123&nonce=n-0S6_WzA2Mj&code_challenge=$CHALLENGE&code_challenge_method=S256" && echo "$AUTHORIZE_URL"
```

In a real app the person's browser opens that address. They see Odudu's sign-in page, named for your app, and sign in there. Your app never sees their password. A "Sign up" button is the same address with `prompt=create` added, which shows the registration page instead; see [a sign-up button](./sign-a-user-in.md#a-sign-up-button).

## 4. The person signs in

You can open the address above in a browser and sign in as `ada`. To keep going in the terminal, the next commands play the browser's part: they fetch the sign-in page, then post `ada`'s username and password to it.

```sh {run}
COOKIES=$(mktemp) && PAGE=$(curl -fsS -c "$COOKIES" "$AUTHORIZE_URL")
```

```sh {run}
AUTH_SESSION=$(printf '%s' "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
```

When the password is right, Odudu answers with a redirect to your callback address and a one-time code. Here the command prints the address it redirects to.

```sh {run expect="http://localhost:8080/callback?code="}
CALLBACK=$(curl -sS -o /dev/null -D - -b "$COOKIES" --data-urlencode "auth_session_id=$AUTH_SESSION" --data-urlencode username=ada --data-urlencode 'password=a long and unremarkable passphrase' "$TENANT/login-actions/authenticate" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r') && echo "$CALLBACK"
```

The address carries the `code`, your `state` and the issuer, `iss`. Before your server uses the code it checks that `state` is the value it sent and that `iss` is the tenant it started with. The code works once and is good for 60 seconds by default.

```sh {run}
CODE=$(printf '%s' "$CALLBACK" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
```

## 5. Swap the code for tokens

Your server sends the code, the verifier and the app's secret to the token endpoint. The secret travels in the `Authorization` header, which `curl -u` builds.

```sh {run expect="Bearer"}
TOKENS=$(curl -fsS -u "my-web-app:$CLIENT_SECRET" --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode "code_verifier=$VERIFIER" "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$TOKENS" | sed -E 's/("(access|id|refresh)_token":"[^"]{12})[^"]*"/\1…"/g'
```

You get three tokens. The access token is what your app sends to your APIs. The ID token says who signed in. The refresh token gets new tokens later, as [Refresh and end a session](./refresh-and-end-a-session.md) shows.

## 6. Check who signed in

An ID token is a signed document. Its middle part holds claims about the person. This command defines a small helper that decodes it, then shows the claims.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

```sh {run expect="n-0S6_WzA2Mj"}
ID_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"id_token":"\([^"]*\)".*/\1/p') && decode "$ID_TOKEN"
```

`sub` is the person, `aud` is your app, and `nonce` is the value you sent. Your server compares the nonce before it trusts the token.

Decoding is not trusting. Before it relies on any claim, your server also checks the token's signature against the tenant's public keys, which Odudu publishes.

```sh {run expect="kid"}
curl -fsS "$TENANT/protocol/openid-connect/certs" | sed -E 's/"n":"[^"]*"/"n":"…"/'
```

Use your language's OpenID Connect or JOSE library for that check. Give it the tenant's address, `$TENANT` above, and it finds these keys from the discovery document.

## 7. Run a finished app

The steps above are what a web app's server does, by hand. A working version is one short file, written with the `@odudu-io/oidc` SDK, which makes the `state`, the `nonce` and the PKCE pair, checks them when the person comes back, and verifies the ID token for you. [The web app example](https://github.com/wizzywit/odudu/tree/main/examples/web-app) signs `ada` in and shows who she is. Its README says how to run it against your stack.

## Where to go next

- Keep people signed in with [Refresh and end a session](./refresh-and-end-a-session.md).
- Protect the API behind your app with [Protect an API](./api.md).
- See every header and byte of this flow in [Path A as a confidential client](../reference/transcripts/request-paths/path-a-as-a-confidential-client.md).
