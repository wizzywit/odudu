---
title: Sign people in to a web app
description: Register a web app that keeps a secret and sign people in with @odudu-io/oidc, then follow each step it takes with commands you can run.
sidebar_position: 5
---

# Sign people in to a web app

Your web app has a server, and the server can keep a secret. That makes it a confidential client: it proves who it is to Odudu when it swaps a sign-in code for tokens. You will register the app, sign people in with the `@odudu-io/oidc` package, and then follow the requests it makes one at a time, so you can see what it does for you.

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

Register `my-web-app` with that secret. The redirect address is where Odudu sends the person after they sign in. It has to match the address your app sends later, character for character. The post-logout address is where Odudu may send them after they sign out.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-web-app --client-secret "$CLIENT_SECRET" --redirect-uri http://localhost:8080/callback --post-logout-redirect-uri http://localhost:8080/
```

## 3. Sign people in with the SDK

[`@odudu-io/oidc`](../sdks/oidc.md) makes the sign-in request, checks the answer and builds the sign-out address. It keeps nothing: your server holds the short record a sign-in needs between the redirect out and the redirect back, and the person's session afterwards.

```text
npm install @odudu-io/oidc
```

Until the first release is published, the package is not on npm. Install it from a checkout of this repository by running `../_shared/install.sh . oidc` in the folder of [the web app example](https://github.com/wizzywit/odudu/tree/main/examples/web-app); it needs Node 24 or later, which the package needs too.

The example is one file, `app.ts`. It keeps each person's session on the server, in a cookie that holds only an opaque id. This is the session it keeps. It lives in memory and never expires, which is fine for an example and not for an app you ship.

From `examples/web-app/app.ts`:

```ts
interface Session {
  pending?: Pending;
  person?: { sub: string; name: string; idToken: string };
}
const sessions = new Map<string, Session>();
```

On `/login`, `beginSignIn` makes the PKCE pair, the `state` and the `nonce`, and returns the address to send the browser to together with `pending`, the record that holds all three. The app keeps `pending` in the session.

From `examples/web-app/app.ts`:

```ts
// `pending` holds the PKCE verifier, the state and the nonce for the round trip.
beginSignIn(
  {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: `${ORIGIN}/callback`,
    scope: 'openid profile',
  },
  deps,
).then(
  ({ url: target, pending }) => redirect(target, cookieFor(begin({ pending }))),
  () => send(500, '<p>Could not start sign-in.</p>'),
);
```

On `/callback`, `completeSignIn` takes the address the browser arrived at, the record, and the app's secret. It checks the answer and swaps the code for tokens. The record can be used once, so the app deletes the session before it calls.

From `examples/web-app/app.ts`:

```ts
// Checks state, the issuer, the code's PKCE proof and the ID token's issuer, audience,
// expiry and nonce. The signature is not checked.
completeSignIn(url.href, pending, deps, { auth: { secret: SECRET } }).then(
  (tokens) => {
    const sub = tokens.claims.sub;
    const name = String(tokens.claims.preferred_username ?? sub);
    redirect('/', cookieFor(begin({ person: { sub, name, idToken: tokens.idToken } })));
  },
  (error: unknown) => {
    console.error(`sign-in refused: ${why(error)}`);
    send(400, '<p>Sign-in was refused.</p>');
  },
);
```

A refusal is an `OduduError` whose `code` says which check failed, such as `invalid_state` or `invalid_id_token`. [`@odudu-io/oidc`](../sdks/oidc.md#errors) lists them. On sign-out, `signOutUrl` builds the address that ends the person's session at Odudu too, with their ID token as the hint.

From `examples/web-app/app.ts`:

```ts
signOutUrl(
  { issuer: ISSUER, idToken: session.person.idToken, postLogoutRedirectUri: `${ORIGIN}/` },
  deps,
).then(
  (target) => redirect(target, clear),
  () => redirect('/', clear),
);
```

`deps` is `{ allowInsecureRequests: true }`, which lets the package talk to an `http` issuer such as your stack on localhost. A real app serves everything over https and never sets it.

This app renders its own pages from a session on its server, so it uses the package directly. An app whose browser code needs to read the session as JSON is better served by a backend for frontend; [Backend for frontend](../concepts/backend-for-frontend.mdx) explains that choice.

To run the example as the app you registered above, give it the client, its secret and the port that matches the redirect address, in the example's folder:

```text
CLIENT_ID=my-web-app CLIENT_SECRET="$CLIENT_SECRET" PORT=8080 npm start
```

Open `http://localhost:8080` and sign in as `ada`. The rest of this guide runs the same exchange as plain requests.

## 4. Send the person to Odudu

`beginSignIn` does this step. Before it sends anyone, your server makes a random value, the verifier, and its fingerprint, the challenge. It keeps the verifier and sends only the challenge. When the code comes back, the verifier proves that the same server is asking for the tokens.

```sh {run}
VERIFIER=$(openssl rand -hex 32)
```

```sh {run}
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

Now build the address `beginSignIn` returns. `state` is a value you will compare when the person comes back, and `nonce` will appear in the ID token.

```sh {run}
AUTHORIZE_URL="$TENANT/protocol/openid-connect/auth?response_type=code&client_id=my-web-app&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid%20profile%20email&state=abc123&nonce=n-0S6_WzA2Mj&code_challenge=$CHALLENGE&code_challenge_method=S256" && echo "$AUTHORIZE_URL"
```

In a real app the person's browser opens that address. They see Odudu's sign-in page, named for your app, and sign in there. Your app never sees their password. A "Sign up" button is the same address with `prompt=create` added, which shows the registration page instead; see [a sign-up button](./sign-a-user-in.md#a-sign-up-button).

## 5. The person signs in

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

The address carries the `code`, your `state` and the issuer, `iss`. Before it uses the code, `completeSignIn` checks that `state` is the value it sent and that `iss` is the tenant it started with. The code works once and is good for 60 seconds by default.

```sh {run}
CODE=$(printf '%s' "$CALLBACK" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
```

## 6. Swap the code for tokens

`completeSignIn` does this step, and the checks before it. Your server sends the code, the verifier and the app's secret to the token endpoint. The secret travels in the `Authorization` header, which `curl -u` builds.

```sh {run expect="Bearer"}
TOKENS=$(curl -fsS -u "my-web-app:$CLIENT_SECRET" --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode "code_verifier=$VERIFIER" "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$TOKENS" | sed -E 's/("(access|id|refresh)_token":"[^"]{12})[^"]*"/\1…"/g'
```

You get three tokens. The access token is what your app sends to your APIs. The ID token says who signed in. The refresh token gets new tokens later, as [Refresh and end a session](./refresh-and-end-a-session.md) shows.

## 7. Check who signed in

An ID token is a signed document. Its middle part holds claims about the person. This command defines a small helper that decodes it, then shows the claims.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

```sh {run expect="n-0S6_WzA2Mj"}
ID_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"id_token":"\([^"]*\)".*/\1/p') && decode "$ID_TOKEN"
```

`sub` is the person, `aud` is your app, and `nonce` is the value you sent. `completeSignIn` compares the nonce before it hands you the token.

Decoding is not trusting: a token is trusted by its signature, which is made with the tenant's public keys.

```sh {run expect="kid"}
curl -fsS "$TENANT/protocol/openid-connect/certs" | sed -E 's/"n":"[^"]*"/"n":"…"/'
```

Odudu publishes these keys so that anyone can check a signature. `completeSignIn` does not check the signature of the ID token, because the token came straight from Odudu's token endpoint over TLS, which OpenID Connect Core section 3.1.3.7 accepts in place of a check. It does check the issuer, the audience, the expiry and the `nonce`. An ID token that reaches your server any other way, for example from the browser, has not been through that exchange, so check its signature against these keys before you trust a claim in it.

## Where to go next

- Keep people signed in with [Refresh and end a session](./refresh-and-end-a-session.md).
- Protect the API behind your app with [Protect an API](./api.md).
- See every header and byte of this flow in [Path A as a confidential client](../reference/transcripts/request-paths/path-a-as-a-confidential-client.md).
