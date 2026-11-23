---
title: Sign people in to a single-page app
description: Register a single-page app that cannot keep a secret, let its origin call Odudu and sign people in with @odudu-io/oidc or @odudu-io/react.
sidebar_position: 6
---

# Sign people in to a single-page app

A single-page app runs in the person's browser, so anything you put in it can be read. It cannot keep a secret. That makes it a public client: instead of a secret it uses PKCE, a one-time proof that only the app that started a sign-in can finish it. You will register the app, check that its browser may call Odudu, sign a person in with the `@odudu-io/oidc` package, and then follow the requests it makes one at a time, so you can see what it does for you.

You need the stack from the [quick start](../quick-start/index.mdx), with its `demo` tenant and its user `ada`. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed. The packages in this guide run in a browser, in Node and on edge runtimes, so they are not for a native mobile app, which [the roadmap](../roadmap.md) places later; the requests below are the ones such an app makes.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

## 2. Register the app

Register `my-spa` as a public client. Give it three addresses: where Odudu sends the person after they sign in, where it may send them after they sign out, and the origin your app is served from. The origin is what lets the browser talk to Odudu directly.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-spa --public --redirect-uri http://localhost:8080/callback --post-logout-redirect-uri http://localhost:8080/ --web-origin http://localhost:8080
```

## 3. Check the browser may call Odudu

Before a browser calls another origin it asks permission with a preflight request. Odudu answers it for the origins you registered and for no others. Here is the preflight your app's origin sends before it swaps a code.

```sh {run expect="access-control-allow-origin: http://localhost:8080"}
curl -sS -D - -o /dev/null -X OPTIONS -H "Origin: http://localhost:8080" -H 'Access-Control-Request-Method: POST' "$TENANT/protocol/openid-connect/token"
```

An origin you did not register gets no permission.

```sh {run expect="404"}
curl -sS -o /dev/null -w '%{http_code}\n' -X OPTIONS -H "Origin: http://evil.example" -H 'Access-Control-Request-Method: POST' "$TENANT/protocol/openid-connect/token"
```

The full exchange, with the header on the real request too, is in [CORS: the preflight and the request differ](../reference/transcripts/request-paths/cors-the-preflight-and-the-request-differ.md).

## 4. Sign people in with the SDK

[`@odudu-io/oidc`](../sdks/oidc.md) runs in the browser. It makes the PKCE pair, the `state` and the `nonce`, checks the answer when the person comes back, and builds the sign-out address. It keeps nothing: the app holds the tokens, and the short record a sign-in needs between the redirect out and the redirect back.

```text
npm install @odudu-io/oidc
```

The package runs in a browser or an edge runtime, and in Node 24 or later.

Install it with `npm install @odudu-io/oidc`, and for the React block below `npm install @odudu-io/react` too. The code below is [the single-page app example](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), which runs from its folder after `npm install`.

The example is one file, `src/main.ts`, built and served by Vite. When the person chooses **Sign in**, `beginSignIn` returns the address to send the browser to and `pending`, the record that holds the verifier, the state and the nonce. The page is replaced when the browser leaves, so the record waits in session storage, which stays in one tab.

From `examples/single-page-app/src/main.ts`:

```ts
async function signIn(): Promise<void> {
  const { url, pending } = await beginSignIn(
    { issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: 'openid profile' },
    deps,
  );
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  location.assign(url);
}
```

When the browser comes back to `/callback`, the app takes the record out and deletes it, because an answer can be used once. `completeSignIn` checks the answer and swaps the code for tokens by calling Odudu from the browser.

From `examples/single-page-app/src/main.ts`:

```ts
async function finishSignIn(): Promise<TokenSet> {
  const stored = sessionStorage.getItem(PENDING);
  // A callback can be used once: the record it needs is gone after the first.
  sessionStorage.removeItem(PENDING);
  if (stored === null) throw new Error('No sign-in is under way');
  // Checks the state and the issuer, exchanges the code and checks the ID token's issuer,
  // audience, expiry and nonce, not its signature.
  return completeSignIn(location.href, JSON.parse(stored) as Pending, {}, deps);
}
```

The tokens it returns live in a variable, so a reload signs the person out of the app, and Odudu still holds their own session, so signing in again usually returns at once. Keep them there rather than in `localStorage`, where any script on the page can read them. A refusal is an `OduduError` whose `code` says which check failed; [`@odudu-io/oidc`](../sdks/oidc.md#errors) lists them. On sign-out, `signOutUrl` builds the address that ends the person's session at Odudu too, with the ID token as the hint.

From `examples/single-page-app/src/main.ts`:

```ts
async function signOut(): Promise<void> {
  const idToken = tokens?.idToken ?? '';
  tokens = undefined;
  location.assign(
    await signOutUrl(
      { issuer: ISSUER, idToken, postLogoutRedirectUri: `${location.origin}/` },
      deps,
    ),
  );
}
```

`deps` is `{ allowInsecureRequests: true }`, which lets the package talk to an `http` issuer such as your stack on localhost. A real app is served over https and never sets it.

An app whose page runs in React can let `@odudu-io/react` do this in its `browser` mode, which runs the same calls inside a provider and keeps the tokens in memory. It needs React 19 and installs the core with it.

```text
npm install @odudu-io/react
```

This block is written for this page, and no example uses `browser` mode.

```tsx
import { createRoot } from 'react-dom/client';
import { OduduProvider, SignedIn, SignedOut, useAuth, useUser } from '@odudu-io/react';

function Account() {
  const { signOut } = useAuth();
  const claims = useUser();
  return (
    <>
      <p>Signed in as {String(claims?.preferred_username ?? claims?.sub)}</p>
      <button onClick={signOut}>Sign out</button>
    </>
  );
}

function Welcome() {
  const { signIn } = useAuth();
  return <button onClick={() => signIn()}>Sign in</button>;
}

createRoot(document.getElementById('root') ?? document.body).render(
  <OduduProvider
    mode={{
      kind: 'browser',
      issuer: 'https://id.example.com/tenants/acme',
      clientId: 'my-spa',
      redirectUri: `${location.origin}/callback`,
      postLogoutRedirectUri: `${location.origin}/`,
      scope: 'openid profile',
    }}
  >
    <SignedOut>
      <Welcome />
    </SignedOut>
    <SignedIn>
      <Account />
    </SignedIn>
  </OduduProvider>,
);
```

[`@odudu-io/react`](../sdks/react.md) lists the provider's options. Both ways keep the tokens in the page, where a script that runs there can reach them while it is open. If your app has a server that can keep them, a backend for frontend holds them there instead and gives the browser only a cookie; [Backend for frontend](../concepts/backend-for-frontend.mdx) explains the pattern.

To run the example as the app you registered above, in its folder, give Vite the port of the redirect address and the client's name:

```text
VITE_CLIENT_ID=my-spa npx vite --port 8080 --strictPort
```

Open `http://localhost:8080` and sign in as `ada`. The example's own client allows only the `authorization_code` grant, so Odudu issues it no refresh token. The `my-spa` you registered has the default grants and does get one. The rest of this guide runs the same exchange as plain requests.

## 5. Make the PKCE pair

`beginSignIn` makes this pair. The app makes a random verifier and its fingerprint, the challenge. It keeps the verifier in memory and sends only the challenge. In a browser the fingerprint is a SHA-256 hash, written in URL-safe base64 with no padding.

```sh {run}
VERIFIER=$(openssl rand -hex 32)
```

```sh {run}
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

## 6. Send the person to Odudu

The app redirects the browser to the authorization address, which is the `url` that `beginSignIn` returns. `state` is a value it compares when the person comes back, and `nonce` appears in the ID token.

```sh {run}
AUTHORIZE_URL="$TENANT/protocol/openid-connect/auth?response_type=code&client_id=my-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid%20profile&state=abc123&nonce=n-0S6_WzA2Mj&code_challenge=$CHALLENGE&code_challenge_method=S256" && echo "$AUTHORIZE_URL"
```

In a real app the browser opens that address, and the person signs in on Odudu's page. To keep going in the terminal, the next commands play the browser's part and sign in as `ada`.

```sh {run}
COOKIES=$(mktemp) && PAGE=$(curl -fsS -c "$COOKIES" "$AUTHORIZE_URL")
```

```sh {run}
AUTH_SESSION=$(printf '%s' "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
```

```sh {run expect="http://localhost:8080/callback?code="}
CALLBACK=$(curl -sS -o /dev/null -D - -b "$COOKIES" --data-urlencode "auth_session_id=$AUTH_SESSION" --data-urlencode username=ada --data-urlencode 'password=a long and unremarkable passphrase' "$TENANT/login-actions/authenticate" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r') && echo "$CALLBACK"
```

The address your app lands on carries the `code`, your `state` and the issuer. `completeSignIn` checks that `state` is the value it sent before it goes on.

```sh {run}
CODE=$(printf '%s' "$CALLBACK" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
```

## 7. Swap the code for tokens

`completeSignIn` does this step. The app sends the code and the verifier. There is no secret, so the request names the client instead. From a browser it would also carry the `Origin` header, which the command adds.

```sh {run expect="Bearer"}
TOKENS=$(curl -fsS -H "Origin: http://localhost:8080" --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode client_id=my-spa --data-urlencode "code_verifier=$VERIFIER" "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$TOKENS" | sed -E 's/("(access|id|refresh)_token":"[^"]{12})[^"]*"/\1…"/g'
```

The access token is what the app sends to your API. The ID token says who signed in. The refresh token gets new tokens later, and Odudu replaces it each time it is used, so a stolen one is caught. Keep all three in memory rather than in `localStorage`, where any script on the page can read them.

## A sign-up button

A "Sign up" button sends the person to the same address with `prompt=create` added. With the SDK, pass `prompt: 'create'` to `beginSignIn`, or to `signIn` in React. Odudu shows its registration page instead of the sign-in page, and the person comes back to your app the same way once they have an account. The tenant has to allow self-registration first.

```sh {run expect="registration_allowed"}
docker compose exec odudu odudu seed tenant --name demo --set registration_allowed=true
```

```sh {run expect="/tenants/demo/login-actions/registration?return_to="}
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$AUTHORIZE_URL&prompt=create"
```

The answer is a `303` to the registration page, which carries your request as `return_to`. [Sign a user in](./sign-a-user-in.md#a-sign-up-button) has the detail.

## Where to go next

- Keep people signed in with [Refresh and end a session](./refresh-and-end-a-session.md), which also covers signing out.
- Protect the API your app calls with [Protect an API](./api.md).
- The same flow for an app with a server, which keeps a secret, is [Sign people in to a web app](./web-app.md).
