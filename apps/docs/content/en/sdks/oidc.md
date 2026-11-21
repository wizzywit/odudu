---
title: '@odudu-io/oidc'
description: 'The core SDK: start and finish a sign-in, refresh tokens, sign a service in as itself and build the sign-out address, in a browser or in Node.'
sidebar_position: 2
---

# @odudu-io/oidc

This is the core the other SDKs are built on. It makes the sign-in request for the authorization code flow with PKCE, checks the answer, renews tokens, signs a service in as itself and builds the address that ends a session. It keeps nothing: you hold the tokens and the short record a sign-in needs between the redirect out and the redirect back.

## Install

```text
npm install @odudu-io/oidc
```

It needs Node 24 or later, or a browser or edge runtime. Its two dependencies are `oauth4webapi` and `jose`.

## The shortest use

A single-page app starts a sign-in, keeps the record the redirect needs, and finishes the sign-in when the browser returns. This is the code of [the single-page app example](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), trimmed.

```ts
import { beginSignIn, completeSignIn, signOutUrl, type Pending } from '@odudu-io/oidc';

const issuer = 'https://id.example.com/tenants/acme';

// 1. On the sign-in button: build the address and send the browser there.
const { url, pending } = await beginSignIn({
  issuer,
  clientId: 'my-app',
  redirectUri: `${location.origin}/callback`,
  scope: 'openid profile',
});
sessionStorage.setItem('pending', JSON.stringify(pending));
location.assign(url);

// 2. On /callback: use the record once, then finish the sign-in.
const stored = sessionStorage.getItem('pending');
sessionStorage.removeItem('pending');
const tokens = await completeSignIn(location.href, JSON.parse(stored ?? '{}') as Pending);
console.log(tokens.claims.sub);

// 3. On sign-out: forget the tokens and send the browser to Odudu.
location.assign(
  await signOutUrl({
    issuer,
    idToken: tokens.idToken,
    postLogoutRedirectUri: `${location.origin}/`,
  }),
);
```

This block is illustrative. The example it comes from is run by the repository's CI against a live stack, and so is the service below, from [the machine-to-machine example](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine).

A service that signs in as itself asks for a token source and calls it before every request.

```ts
import { createTokenSource, OduduError } from '@odudu-io/oidc';

const token = createTokenSource({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'nightly-job',
  auth: { secret: process.env.CLIENT_SECRET ?? '' },
  scope: 'reports:read',
});

try {
  const response = await fetch('https://api.example.com/reports', {
    headers: { authorization: `Bearer ${await token()}` },
  });
  console.log(response.status);
} catch (error) {
  if (error instanceof OduduError) console.error(`${error.code}: ${error.message}`);
  else throw error;
}
```

## What it exports

| Export                                               | What it does                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `discover(issuer, deps?)`                            | Reads the issuer's metadata, checks that it names the issuer you asked for, and keeps it for an hour (at most 256 issuers). |
| `beginSignIn(options, deps?)`                        | Returns `{ url, pending }`: the address to send the person to and the record `completeSignIn` needs.                        |
| `completeSignIn(callbackUrl, pending, deps?, opts?)` | Checks the redirect, exchanges the code and validates the ID token. Returns a `TokenSet`.                                   |
| `refresh(tokens, options?, deps?)`                   | Renews the access tokens of a sign-in and returns the new `TokenSet`.                                                       |
| `requestAudience(request, deps?)`                    | Starts a second authorization for an audience the first sign-in did not carry. Returns `{ url, pending }`.                  |
| `clientCredentials(options, deps?)`                  | Signs a service in as itself once. Returns `{ accessToken, expiresAt, scope }`.                                             |
| `createTokenSource(options, deps?)`                  | Returns a function that gives a valid access token for a service, asking again shortly before the held one expires.         |
| `signClientAssertion(options)`                       | Signs the `private_key_jwt` assertion for a service that makes its own token request.                                       |
| `signOutUrl(options, deps?)`                         | Builds the address that ends the person's session, with the ID token hint and the post-logout redirect.                     |
| `OduduError`                                         | The error every function above raises. See [the errors](#errors).                                                           |

## Options

### `Deps`

The last argument of most functions. Every member has a default that works in a browser, in Node and on an edge runtime.

| Option                  | Default      | What it does                                                                                                                                                |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`                 | global fetch | The function every request goes through.                                                                                                                    |
| `now`                   | `Date.now`   | Milliseconds since the epoch. It stamps `expiresAt` and times the discovery cache. It does not drive the ID token's `exp` check, which reads its own clock. |
| `allowInsecureRequests` | `false`      | Lets an `http` issuer through. For a development server on localhost only.                                                                                  |

### `SignInOptions`, for `beginSignIn`

| Option        | Required | What it does                                                                                                                  |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `issuer`      | yes      | The tenant's issuer, such as `https://id.example.com/tenants/acme`.                                                           |
| `clientId`    | yes      | The client's ID.                                                                                                              |
| `redirectUri` | yes      | Where Odudu sends the person back to. `completeSignIn` refuses an answer that did not arrive there.                           |
| `scope`       | yes      | The scopes to ask for, separated by spaces.                                                                                   |
| `resource`    | no       | The APIs the access token is for (RFC 8707), as a list.                                                                       |
| `meAccess`    | no       | `'read'` or `'write'`. Adds the account API's audience and the scope `me:read` or `me:write`.                                 |
| `idTokenAlg`  | no       | `'RS256'` (the default) or `'ES256'`: the algorithm the client is registered for ID tokens.                                   |
| `prompt`      | no       | `'create'` starts at the registration page.                                                                                   |
| `action`      | no       | Starts at a credential change: `'update-password'`, `'configure-totp'`, `'configure-passkey'` or `'generate-recovery-codes'`. |

`prompt` and `action` are exclusive: giving both rejects with `invalid_options`.

### `TokenSet`, from `completeSignIn` and `refresh`

| Field          | What it holds                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`       | Where the tokens came from. `refresh` reads it.                                                                                                      |
| `clientId`     | Whom they were issued to. `refresh` reads it.                                                                                                        |
| `byAudience`   | Access tokens, each `{ accessToken, expiresAt, scope }`, keyed by the `resource` they were issued for, or by the issuer when the sign-in named none. |
| `idToken`      | The ID token as it was issued.                                                                                                                       |
| `refreshToken` | Present when the server issued one.                                                                                                                  |
| `claims`       | The validated claims of the ID token.                                                                                                                |

### Confidential clients

`completeSignIn` takes `{ auth }` as its last argument and `refresh` takes it in its options. `auth` is `{ secret }`, sent as `client_secret_basic`, or `{ privateKey, kid?, alg? }`, which signs a `private_key_jwt` assertion. Leave it out for a public client. `clientCredentials` and `createTokenSource` require it.

### `refresh` options

| Option       | What it does                                                                                |
| ------------ | ------------------------------------------------------------------------------------------- |
| `auth`       | Authenticates the refresh of a confidential client.                                         |
| `resource`   | An audience the first sign-in carries. Any other value rejects with `audience_not_granted`. |
| `idTokenAlg` | The algorithm the client is registered for ID tokens; `RS256` when omitted.                 |

Without `resource`, the audiences the new access token names are renewed and the others are removed, so a later request for one rejects with `audience_not_granted`. That is best effort: an access token is opaque to a client, and one that is opaque or unreadable renews every audience.

`refresh` rejects with `invalid_options` when the `TokenSet` holds no refresh token (the message says to sign in with the `offline_access` scope). A refresh response without `expires_in` is read as living 60 seconds, where `completeSignIn` refuses such a response with `request_failed`, because refusing it would throw away the rotated refresh token the response carries.

### `AudienceRequest`, for `requestAudience`

| Option        | Required | What it does                                                                                                                 |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `issuer`      | yes      | The tenant's issuer.                                                                                                         |
| `clientId`    | yes      | The client's ID.                                                                                                             |
| `redirectUri` | yes      | Where Odudu sends the person back to.                                                                                        |
| `scope`       | yes      | The scopes to ask for.                                                                                                       |
| `resource`    | yes      | The new audience (RFC 8707), one string. The account API's audience adds the `me:read` scope.                                |
| `silent`      | no       | Sends `prompt=none`. Off by default: whether Odudu then skips every interactive step for a new audience has not been tested. |
| `idTokenAlg`  | no       | `'RS256'` (the default) or `'ES256'`.                                                                                        |

### `ClientCredentialsOptions` and `TokenSourceOptions`

| Option     | Required | What it does                                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `issuer`   | yes      | The tenant's issuer.                                                                                         |
| `clientId` | yes      | The service's client ID.                                                                                     |
| `auth`     | yes      | `{ secret }` or `{ privateKey, kid?, alg? }`. Not both.                                                      |
| `scope`    | no       | The scopes to ask for.                                                                                       |
| `resource` | no       | The API the access token is for (RFC 8707).                                                                  |
| `skewMs`   | no       | `createTokenSource` only. How long before expiry a token is replaced, zero or more. 30 seconds when omitted. |

### `signOutUrl` and `signClientAssertion`

`signOutUrl` takes `issuer`, `idToken`, and optionally `postLogoutRedirectUri` and `state`. The redirect address must be registered for the client, and the server honors `state` only together with it. `signClientAssertion` takes `clientId`, `audience` (the token endpoint), `privateKey`, and optionally `kid`, `alg` and `now`.

## Errors

Every function rejects with an `OduduError`. Its `code` is one of a closed set, and `error` and `errorDescription` hold the server's own words when it sent them.

Codes the server answers with, narrowed to the closed set: `invalid_request`, `invalid_client`, `invalid_grant`, `unauthorized_client`, `unsupported_grant_type`, `unsupported_response_type`, `invalid_scope`, `invalid_target`, `access_denied`, `server_error`, `temporarily_unavailable`, `login_required`, `consent_required`, `interaction_required` and `account_selection_required`. A server error code outside that list becomes `unrecognized_error`.

Codes the SDK raises on its own account:

| Code                   | When                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_options`      | An option is missing, contradicts another, or cannot work (a `skewMs` that is negative or not finite, a key that cannot sign with the algorithm).                |
| `audience_not_granted` | A refresh named an audience the sign-in does not carry, including one a previous refresh without `resource` dropped because the access token no longer names it. |
| `discovery_failed`     | The metadata could not be read, spells the issuer differently from the string you gave, lacks an endpoint, or names an `end_session_endpoint` that is not https. |
| `invalid_callback`     | The callback address is not a URL, did not arrive at the redirect URI, or carries no code.                                                                       |
| `invalid_state`        | The answer carries no `state`, or one other than the sign-in sent.                                                                                               |
| `invalid_issuer`       | The answer carries no `iss` parameter (RFC 9207), or one other than the issuer the sign-in used.                                                                 |
| `invalid_id_token`     | The ID token is missing or refused, or a refreshed one names another subject.                                                                                    |
| `request_failed`       | A request did not complete, or a response was unusable. A token endpoint that refuses the client with an OAuth error body is `invalid_client`, not this.         |

## Security notes

- **What `completeSignIn` checks.** The redirect arrived at the redirect URI. The `state` is the one sent. The `iss` parameter is the issuer used (RFC 9207), and that holds for an error answer as much as for one carrying a code. The code exchange carries the PKCE verifier. The ID token's issuer, audience, `azp`, expiry and `nonce` are valid. Its signature is not checked: the token comes straight from the token endpoint over TLS, which OpenID Connect Core section 3.1.3.7 accepts in place of a signature check.
- **The record `beginSignIn` returns.** `pending` is plain JSON and holds the PKCE verifier, so keep it private to the person who is signing in: session storage, a cookie, a server session. An answer can be used once, so remove the record when you read it.
- **Where tokens live.** The core returns tokens and keeps none. A browser can read the token endpoint's answer only if the page's origin is registered as a web origin of the client (`odudu seed client --web-origin <origin>`); without it the sign-in reaches the token address and the browser refuses to hand the answer to the app. Where you put them is your decision. The single-page app example keeps them in a variable, so a reload signs the person out of the app, and registers the client without the `refresh_token` grant, so there is no refresh token to steal. An app that wants to stay signed in for hours needs a server that holds the tokens: see [`@odudu-io/bff`](./bff.md).
- **https.** An issuer must be https. `allowInsecureRequests: true` lets an `http` issuer through and is for a development server on localhost only. The same switch is what lets an `end_session_endpoint` that is not https through `signOutUrl`; without it that call rejects with `discovery_failed` before the ID token is put in the address.
- **Time limits.** Every request the core makes is cut off after 30 seconds.
- **Single flight.** Concurrent `refresh` calls with the same refresh token and the same `resource` make one request and share its result or its error. The refreshes of one grant run one at a time: a call that names another audience, or that holds a token an earlier refresh already replaced, waits in the queue and continues with the newest tokens that came back. Keep the `TokenSet` `refresh` returns, not the one you passed in: a rotated refresh token replaces the old one, and the server treats a spent one as a replay.
- **After an uncertain refresh.** If a refresh fails in a way that may have spent the token (a lost connection, a server error, a refused ID token), the calls queued behind it reject with the same code and a message that the outcome is unknown, instead of presenting a possibly spent token. A refusal made before the token is spent (`audience_not_granted`) lets the queue go on from the last good tokens. Use the tokens the last successful refresh returned, or sign in again.
- **The token source.** `createTokenSource` holds one token and asks again 30 seconds before it expires, or after half its life when it lives less than twice the skew. Concurrent calls share one request. A failed request rejects every waiting call and is not kept, so the next call asks again. It holds no timer. A response whose `expires_in` is missing, not a number, zero or negative is taken to live 60 seconds.
- **`signClientAssertion`.** The assertion is valid for 120 seconds and is signed with the algorithm you name, or by key: ES256 for a P-256 key, ES384 for P-384, ES512 for P-521 and RS256 for an RSA key. A service that uses `clientCredentials` with a private key gets the same assertion without calling it.

## Not in this package

- A session, cookies or storage. It returns what you need to keep and keeps nothing. For a session kept on the server, see [`@odudu-io/bff`](./bff.md).
- A user interface. For React components, see [`@odudu-io/react`](./react.md).
- Verifying the access tokens an API receives. That is [`@odudu-io/node`](./node.md), or [`odudu`](./python.md) in Python.

## Examples and neighbours

The repository holds three examples that use this package: [the web app](https://github.com/wizzywit/odudu/tree/main/examples/web-app) (a server with sessions), [the single-page app](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app) and [the machine-to-machine client](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine). The source is in [`sdks/oidc`](https://github.com/wizzywit/odudu/tree/main/sdks/oidc), with its changelog.

The guides explain what happens underneath: [Sign people in to a web app](../guides/web-app.md), [Sign people in to a single-page app](../guides/single-page-app.md) and [Call an API as a service](../guides/machine-to-machine.md).
