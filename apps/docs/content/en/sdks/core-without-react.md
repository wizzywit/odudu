---
title: The core without React
description: 'Sign a person in with @odudu-io/oidc alone, in a plain browser page, a Node server or a script: each call in order, with errors and safety notes.'
sidebar_position: 12
---

# The core without React

[`@odudu-io/oidc`](./oidc.md) needs no framework. It is a handful of functions that build a sign-in address, check the answer and renew tokens, and it runs in a browser, in Node 24 or later, and on edge runtimes. This page walks through a sign-in with those functions and nothing else, in a plain browser page, in a server and in a script. The option tables and every field are on the [package page](./oidc.md); this page is the order of the calls and the choices around them.

## What you hold

The core keeps nothing, so you decide where two things live.

- **The `Pending` record.** `beginSignIn` returns it with the address. It is plain JSON, holds the PKCE verifier, the `state` and the `nonce`, and `completeSignIn` needs it when the person comes back. Keep it private to the person who is signing in, and use it once.
- **The `TokenSet`.** `completeSignIn` returns it. It holds the access tokens by audience, the ID token, the refresh token when the server issued one, and the validated claims.

Where each lives depends on where your code runs:

| Your code runs in             | The `Pending` record lives in                     | The `TokenSet` lives in                    |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------ |
| A plain browser page          | The tab's session storage, for the redirect only. | A variable. A reload signs the person out. |
| A Node server with sessions   | The person's server-side session.                 | The same session.                          |
| A script on a person's laptop | A variable, while a loopback listener waits.      | A variable, for the life of the script.    |

## Register the client

A client is a public client in a browser and a confidential client on a server. A browser can read Odudu's token answer only if the page's origin is registered as a web origin of the client, so a page needs `--web-origin`. This is the client of the single-page app example, from its README:

```text
odudu seed client --tenant demo --client-id example-spa --public \
  --grant-type authorization_code \
  --redirect-uri http://localhost:8084/callback \
  --post-logout-redirect-uri http://localhost:8084/ \
  --web-origin http://localhost:8084
```

Without `--web-origin` the sign-in reaches the token address and the browser then refuses to hand the answer to the page. A server calls the token address itself, so it needs no web origin, and it holds a secret that it passes to `completeSignIn`.

## Start the sign-in

`beginSignIn` reads the issuer's metadata with `discover`, so you do not need to call `discover` yourself. It checks that the metadata names the issuer you gave and keeps it for an hour. Call `discover` directly only when you want the endpoints, or want an unreachable issuer to fail early.

`beginSignIn` returns `{ url, pending }`. Keep `pending`, then send the browser to `url`. In a page:

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

In a server the same call keeps `pending` in the session, and the redirect is a `302`:

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
```

`openid` is always added to the scope. The redirect address is built from your own address, so it equals the registered one exactly.

## Finish the sign-in

The person signs in on Odudu's page, and Odudu sends the browser back to your redirect address with a code. Give `completeSignIn` the whole address you were called at and the record you kept. A record can be used once, so remove it as you read it. A page:

From `examples/single-page-app/src/main.ts`:

```ts
const stored = sessionStorage.getItem(PENDING);
// A callback can be used once: the record it needs is gone after the first.
sessionStorage.removeItem(PENDING);
if (stored === null) throw new Error('No sign-in is under way');
// Checks the state and the issuer, exchanges the code and checks the ID token's issuer,
// audience, expiry and nonce, not its signature.
return completeSignIn(location.href, JSON.parse(stored) as Pending, {}, deps);
```

A confidential client passes its secret, or a private key, as the last argument:

From `examples/web-app/app.ts`:

```ts
// Checks state, the issuer and the ID token's issuer, audience, expiry and nonce, and
// sends the PKCE verifier with the code. The signature is not checked.
completeSignIn(url.href, pending, { auth: { secret: SECRET } }, deps).then(
```

`completeSignIn` checks that the redirect arrived at the redirect address, that `state` is the one sent, that the `iss` parameter names the issuer you used, and that the code exchange carries the PKCE verifier. It then checks the ID token's issuer, audience, `azp`, expiry and `nonce`. Hold the result and read the person from `tokens.claims`; [the package page](./oidc.md#security-notes) lists each check.

A script on a person's laptop does the same with a loopback address as the redirect address: it listens on one port for the answer, as the [admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin) does, and passes the address it received to `completeSignIn`.

## Use the access token

An access token is filed in `tokens.byAudience` under the `resource` the sign-in asked for, or under the issuer when it named none. Each entry holds `accessToken`, `expiresAt` in milliseconds since the epoch, and `scope`. Send the token to your API in the `Authorization` header and read `expiresAt` before each call. A service that signs in as itself, with no person, asks the token source instead, which keeps a token and asks again shortly before it expires:

From `examples/machine-to-machine/client.ts`:

```ts
    headers: { authorization: `Bearer ${await token()}` },
```

The token source is [`createTokenSource`](./oidc.md#clientcredentialsoptions-and-tokensourceoptions), and it needs a secret or a key.

## Refresh

`refresh` renews the access tokens of a sign-in from the refresh token in the `TokenSet`. Odudu issues a refresh token only to a client that has the `refresh_token` grant, so a client registered with `authorization_code` alone, like the single-page app example's, never holds one. Without one, `refresh` rejects with `invalid_options`.

A sketch, not taken from an example:

```ts
import { refresh, type TokenSet } from '@odudu-io/oidc';

// Keep what refresh returns: a rotated refresh token replaces the old one.
async function fresh(tokens: TokenSet): Promise<TokenSet> {
  const expiresAt = Math.min(...Object.values(tokens.byAudience).map((token) => token.expiresAt));
  return expiresAt - Date.now() < 30_000 ? refresh(tokens) : tokens;
}
```

Refresh tokens rotate, and the server treats a spent one as a replay and revokes the grant. So keep the `TokenSet` that `refresh` returns and drop the one you passed in. Without `resource`, a refresh keeps only the audiences the new access token names and removes the others, so a later request for one of them rejects with `audience_not_granted`. A refresh answer without `expires_in` is read as living 60 seconds. Concurrent calls that hold the same refresh token share one request, and the refreshes of one grant run one at a time. If a refresh fails in a way that may have spent the token, such as a lost connection, the calls waiting behind it reject with the same code instead of presenting a token that may be spent. Use the tokens the last successful refresh returned, or sign in again. A confidential client passes `{ auth }` to `refresh` as it does to `completeSignIn`.

## Ask for another audience

A refresh cannot add an audience the first sign-in did not carry. `requestAudience` starts a second authorization for one more:

A sketch, not taken from an example:

```ts
import { requestAudience } from '@odudu-io/oidc';

const { url, pending } = await requestAudience({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'my-app',
  redirectUri: `${location.origin}/callback`,
  scope: 'openid',
  resource: 'https://api.example.com',
});
sessionStorage.setItem('pending', JSON.stringify(pending));
location.assign(url);
```

Finish it with `completeSignIn` as before. The token set that comes back is filed under the new audience, so you now hold two token sets. `refresh` with a `resource` the first sign-in did not carry rejects with `audience_not_granted`.

## Sign out

`signOutUrl` builds the address that ends the person's session at Odudu, with your ID token as a hint and the post-logout redirect address, which must be registered for the client. Forget the tokens first, then send the browser there. By default Odudu asks the person to confirm on its own page, whatever the hint, and then sends the browser back.

From `examples/web-app/app.ts`:

```ts
    signOutUrl(
      { issuer: ISSUER, idToken: session.person.idToken, postLogoutRedirectUri: `${ORIGIN}/` },
      deps,
    ).then(
```

## Errors

Every function rejects with an `OduduError`, whose `code` comes from a closed set. The ones you meet in this flow:

| Code                   | You see it when                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `invalid_options`      | An option is missing or contradicts another, or `refresh` has no refresh token to use.                               |
| `discovery_failed`     | The issuer's metadata could not be read or names another issuer, or `signOutUrl` finds no https end-session address. |
| `invalid_callback`     | The address you passed is not a URL, did not arrive at the redirect address, or carries no code.                     |
| `invalid_state`        | The answer carries no `state`, or one other than the sign-in sent.                                                   |
| `invalid_issuer`       | The answer's `iss` parameter is missing or names another issuer.                                                     |
| `invalid_id_token`     | The ID token is missing or refused, or a refreshed one names another subject.                                        |
| `invalid_grant`        | The server refused the code or the refresh token, for example one already used.                                      |
| `request_failed`       | A request did not complete, or an answer was unusable.                                                               |
| `audience_not_granted` | A refresh named an audience the sign-in does not carry.                                                              |

The [package page](./oidc.md#errors) has the full list. Log the code and the message and show the person a short, fixed sentence: the values a check compared hold the code and the state.

From `examples/single-page-app/src/main.ts`:

```ts
function why(error: unknown): string {
  return error instanceof OduduError ? `${error.code}: ${error.message}` : String(error);
}
```

## Safety notes

- **Tokens in a browser stay in memory.** Web storage can be read by any script that runs on the page. The single-page app example keeps the tokens in a variable, which a script can also read while the page is open, but which is gone when the tab closes. The price is that a reload signs the person out of the app, and Odudu still holds their own session, so the next sign-in usually returns at once.
- **Only the `Pending` record waits in storage,** because the page is replaced when the browser goes to Odudu. Use it once, and keep it out of anything shared.
- **The ID token's signature is not checked.** The token comes straight from the token endpoint over TLS, which OpenID Connect Core section 3.1.3.7 accepts in place of a signature check. If an ID token reaches you any other way, check its signature before you trust it.
- **Use https.** An issuer must be https. `allowInsecureRequests: true` lets an `http` issuer through, for a development server on localhost only, and the examples set it for that reason.
- **Every request is cut off after 30 seconds.**
- **A secret never goes in a page.** A browser holds no secret. If your app has a server you control, a [backend for frontend](../concepts/backend-for-frontend.mdx) keeps the tokens on the server and gives the browser a cookie, which is the safer choice for an app that must stay signed in; [`@odudu-io/bff`](./bff.md) is that server.

## Where to go next

[`@odudu-io/oidc`](./oidc.md) has every option and error. The examples these excerpts come from are [the single-page app](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), [the web app](https://github.com/wizzywit/odudu/tree/main/examples/web-app) and [the machine-to-machine client](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine), and [Examples](./examples.md) shows all nine. To put the same sign-in in a React tree, see [`@odudu-io/react`](./react.md) in `browser` mode.
