---
title: '@odudu-io/bff'
description: A backend for frontend that signs a person in on the server, keeps the tokens there, gives the browser one HttpOnly cookie and proxies API calls.
sidebar_position: 4
---

# @odudu-io/bff

This package is the server half of the backend for frontend pattern in RFC 10017 ([what the pattern is and when to choose it](../concepts/backend-for-frontend.mdx)). A server you run is the OAuth client: it signs the person in, keeps the tokens in a session store, and gives the browser a cookie that holds an opaque id and nothing else. Its handlers are built on `Request` and `Response`, so the Express and Fastify adapters are thin, and [`@odudu-io/next`](./next.md) builds on it.

## Install

```text
npm install @odudu-io/bff
```

It needs Node 24 or later and depends on [`@odudu-io/oidc`](./oidc.md). Express 5 and Fastify 5 are optional peer dependencies: install the one whose adapter you import.

## The shortest use

This is the server of [the React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff), trimmed. The BFF is a confidential client and holds the secret.

```ts
import express from 'express';
import { createBff } from '@odudu-io/bff';
import { bffRouter } from '@odudu-io/bff/express';

const origin = 'https://app.example.com';

const bff = createBff({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'my-app',
  clientSecret: process.env.CLIENT_SECRET ?? '',
  redirectUri: `${origin}/bff/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile',
  // The routes live under /bff and the proxy at /bff/proxy.
  mountPath: '/bff',
});

const app = express();
// The router goes first: the BFF reads each request itself, so no body parser
// may run before it.
app.use(bffRouter(bff));
app.listen(3000);
```

For Fastify, `registerBff(app, bff)` from `@odudu-io/bff/fastify` mounts the same routes. Fastify answers from an `onRequest` hook before it reads any body.

This block is illustrative: the example it comes from is run by the repository's CI.

## What it exports

| Export                            | What it does                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBff(options)`              | Returns `{ login, callback, logout, session, proxy, proxyPath, mountPath }`. Each is a `(request: Request) => Promise<Response>`.                                             |
| `createMemoryStore(options?)`     | The default `SessionStore`, for one process. Options: `maxSessions`, `idleMs` and `now`.                                                                                      |
| `bffRouter(bff, options?)`        | From `@odudu-io/bff/express`: the routes as an Express 5 router. `prefix` goes before `/login`, `/callback`, `/logout` and `/session`, and defaults to the BFF's `mountPath`. |
| `registerBff(app, bff, options?)` | From `@odudu-io/bff/fastify`: the same routes on a Fastify 5 app.                                                                                                             |

`@odudu-io/bff/shared` exports the rules a framework binding shares with the BFF (the cookie, the session id, the custom header, the path checks). Apps do not need it.

## The routes

| Route      | Method | What it does                                                                                                                                                                 |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`    | GET    | Starts the sign-in: stores a login record, sets the login cookie and redirects to Odudu.                                                                                     |
| `callback` | GET    | Finishes the sign-in, makes the session and sends the browser to `afterSignInPath`.                                                                                          |
| `session`  | GET    | Answers `{ authenticated, claims }` with `Cache-Control: no-store`, and never a token. Needs the header `X-Odudu-BFF`.                                                       |
| `logout`   | POST   | Deletes the session, clears the cookie and answers `{ redirectTo }`, the address of Odudu's end-session page. Needs the header and an allowed `Origin`.                      |
| `proxy`    | any    | Calls an allowlisted upstream with the session's access token, at `proxyPath` (default `${mountPath}/proxy`) as `<proxyPath>/<name>/<path>`. Needs the header on every call. |

## Options

| Option                  | Required | What it does                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`                | yes      | The tenant's issuer.                                                                                                                                                                                                                                                                                                                                                                          |
| `clientId`              | yes      | The client's ID.                                                                                                                                                                                                                                                                                                                                                                              |
| `clientSecret`          | no       | Makes the BFF a confidential client. Without it the BFF signs in as a public client, which is for development only.                                                                                                                                                                                                                                                                           |
| `redirectUri`           | yes      | The address of the `callback` route as the browser reaches it.                                                                                                                                                                                                                                                                                                                                |
| `scope`                 | yes      | The scopes to ask for.                                                                                                                                                                                                                                                                                                                                                                        |
| `resource`              | no       | The audiences the sign-in asks access tokens for (RFC 8707), for upstreams that name a `resource`. When it is set, tokens are filed only under those audiences, so an upstream with no `resource` finds no token for the issuer's own audience and answers `502`.                                                                                                                             |
| `store`                 | no       | A `SessionStore`. The default is in memory, in this process.                                                                                                                                                                                                                                                                                                                                  |
| `cookieName`            | no       | Must start with `__Host-`; `__Host-odudu` when omitted. The login cookie is `<cookieName>-login`.                                                                                                                                                                                                                                                                                             |
| `postLogoutRedirectUri` | no       | Where Odudu sends the person after they confirm the sign-out. It must be registered for the client.                                                                                                                                                                                                                                                                                           |
| `allowedOrigins`        | no       | Origins whose pages may call the state-changing routes. The origin of `redirectUri` when omitted.                                                                                                                                                                                                                                                                                             |
| `afterSignInPath`       | no       | Where `callback` sends the browser; `/` when omitted. Must be a path on this origin.                                                                                                                                                                                                                                                                                                          |
| `sessionTtlMs`          | no       | The longest a session is kept, whatever its use. Seven days when omitted.                                                                                                                                                                                                                                                                                                                     |
| `upstreams`             | no       | The servers the proxy may call. With none, the proxy answers `404`.                                                                                                                                                                                                                                                                                                                           |
| `mountPath`             | no       | Where the routes are mounted, as a path of this origin; the root when omitted. It is the adapters' default `prefix`, and the proxy defaults to `${mountPath}/proxy`.                                                                                                                                                                                                                          |
| `proxyPath`             | no       | Where the browser reaches the proxy, as a path of this origin; `${mountPath}/proxy` when omitted. The adapters mount the proxy at this path. An explicit `proxyPath` wins over `mountPath`. `prefix` moves only `login`, `callback`, `logout` and `session`; the proxy stays at `proxyPath`. A client such as `@odudu-io/react` assumes `<baseUrl>/proxy`, so keep the default if you use it. |
| `maxBodyBytes`          | no       | The most bytes of a request body, and of a response body, the proxy passes. 10 MiB when omitted.                                                                                                                                                                                                                                                                                              |
| `upstreamTimeoutMs`     | no       | How long the proxy waits for an upstream to start answering. 30 seconds when omitted.                                                                                                                                                                                                                                                                                                         |
| `upstreamIdleMs`        | no       | How long a proxied response body may go without a chunk once the upstream has started answering; the proxy then cuts it off and aborts the upstream request. 30 seconds when omitted.                                                                                                                                                                                                         |
| `deps`                  | no       | Passed to the core: `fetch`, `now`, `allowInsecureRequests`. The proxy calls its upstreams with the same `fetch`.                                                                                                                                                                                                                                                                             |

An `Upstream` is `{ name, origin, pathPrefixes, methods?, resource? }`. The browser names the upstream by `name` and may reach only the paths under `pathPrefixes`, matched on whole segments. `origin` is an exact origin with no path. `methods` defaults to GET, POST, PUT, PATCH and DELETE. `resource` is the audience whose access token is sent, the issuer's own when omitted, and it must be one of the sign-in's `resource` values.

A `SessionStore` is `get(id)`, `set(id, session, ttlMs)` and `delete(id)` over plain JSON records, so a database can back one, plus an optional `lock(id, ttlMs)` described below.

## Errors

`createBff` throws a `TypeError` when an option would weaken the cookie or leave the CSRF check with nothing to compare: a `cookieName` that does not start with `__Host-`, an `afterSignInPath` that is not a path on this origin, an invalid upstream, proxy path or `mountPath`, a `redirectUri` that cannot be parsed, or a `maxBodyBytes`, `upstreamTimeoutMs` or `upstreamIdleMs` that is not a positive whole number.

The handlers do not throw at the browser. They answer with a status:

| Status | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `callback` could not finish the sign-in: a missing, replayed or forged callback. The body is fixed and never repeats what the issuer or the query said.                                                                                                                                                                                                                                                                                                                                         |
| `502`  | `callback` failed for a transient reason or a BFF configuration fault, such as a refused client secret. On the proxy: an upstream that cannot be reached, an upstream response over the limit, or an audience the sign-in did not carry.                                                                                                                                                                                                                                                        |
| `401`  | `session` or the proxy found the session over: refresh answered `invalid_grant` or `invalid_id_token`, or the tokens expired with no refresh token. The cookie is cleared, except when the proxy had no session at all: it answers `401` with `{"authenticated":false}` and clears nothing. Every one of the BFF's own `401` answers carries the header `X-Odudu-Session: ended`; the proxy removes that header from every upstream answer, so a client can tell the BFF's `401` from an API's. |
| `503`  | A refresh failed for any other reason (a refused client secret, an unreachable issuer), or the store's lock was not granted. The session is kept. `Retry-After` is set.                                                                                                                                                                                                                                                                                                                         |
| `403`  | A state-changing call, a `session` read or a proxied call lacked the header; a call came from an origin not in `allowedOrigins`, or a proxied `POST`, `PUT`, `PATCH` or `DELETE` sent no `Origin` (only `GET` and `HEAD` may omit it); or the proxy refused a path.                                                                                                                                                                                                                             |
| `405`  | A route was called with a method it does not take. The proxy answers `405` with `Allow` for a method outside the upstream's list.                                                                                                                                                                                                                                                                                                                                                               |
| `404`  | The proxy has no such upstream, or no upstream at all.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `413`  | A proxied request body is over `maxBodyBytes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `504`  | An upstream did not start answering within `upstreamTimeoutMs`. A body that then stalls for `upstreamIdleMs` is cut off mid-stream, so the browser's connection errors.                                                                                                                                                                                                                                                                                                                         |

A cookie that is not an id the BFF could have made, or that names no record, is `{ authenticated: false }` with status `200`, not an error.

## Security notes

- **What the browser holds.** One cookie, `__Host-odudu`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, no `Max-Age` (the login cookie below sets `Max-Age=600`). It holds a 256-bit random id and nothing else. The tokens never leave the server. `Lax` and not `Strict` because the sign-in returns from Odudu by a cross-site navigation that has to carry the login cookie. The cookie is `Secure`, so the app needs https. Chrome accepts it on `localhost`, and Safari may not.
- **What the server stores.** A session record per signed-in browser: the token set (access tokens, ID token, refresh token and claims) and when it was made. A login record per sign-in under way: the PKCE verifier, the state and the nonce, kept ten minutes under a random id in a second cookie, `__Host-odudu-login`, with the same attributes and a `Max-Age` of 600 seconds. `callback` reads the login record once, whatever the outcome. It never reuses a session id the browser sent, so a planted id is not adopted. The BFF stores no password and renders no form.
- **CSRF.** A route accepts one method. A `POST` needs the header `X-Odudu-BFF` (any value) and an `Origin` among `allowedOrigins`, otherwise `403`. The `session` read and every proxied call need the header too, and an allowed `Origin` when the browser sends one. A script in your app adds the header; a page from another origin cannot without a preflight the BFF never approves. `login` and `callback` are browser navigations, which cannot add a header, so they are exempt.
- **The default store.** It is in memory, per process, and is lost on restart. It holds at most 10,000 records, evicts the one used longest ago, and drops a record idle for 30 minutes. Several server processes need a `store` of your own. Without one of your own, login records get a store of their own, so a flood of `login` requests cannot push signed-in sessions out.
- **Several instances and the lock.** The issuer treats a spent refresh token as a replay and revokes the grant ([ADR 0019](https://github.com/wizzywit/odudu/blob/main/docs/adr/0019-refresh-grant-decided-before-rotation.md), [ADR 0054](https://github.com/wizzywit/odudu/blob/main/docs/adr/0054-the-bff-keeps-tokens-and-the-browser-keeps-an-id.md)). A store shared by several instances should implement `lock(id, ttlMs)`: the BFF then takes the lock on `lock:<session id>` before it refreshes, reads the session again and uses what another instance saved. The lock lapses after 120 seconds, and its release function must release only its holder's own lock. When `lock` does not grant the lock and the session still needs a refresh, the read answers `503` and keeps the session. A store with no `lock` is never asked: two instances can each refresh once, the issuer treats the second as a replay and revokes the grant, so that session answers `401`. Without `lock`, run one instance, or route a session to one instance.
- **Refresh.** The client must have the `refresh_token` grant, and the sign-in must be one that returns a refresh token (the examples' provisioning registers their BFF clients with the grant). Asking for `offline_access` is not needed for a refresh token: it makes the grant independent of the sign-in session, so the session no longer bounds it. Without a refresh token the session ends with `401` once its access token expires. The access token is renewed when it is within 30 seconds of expiry and a refresh token is held, authenticating as the confidential client. Concurrent reads of one session make one request. Only `invalid_grant` and `invalid_id_token` end the session; every other failure keeps it, so a rotated secret or an outage signs nobody out. A refreshed ID token that names another subject ends the session at once.
- **Sign-out.** The address in `redirectTo` carries `client_id` and the configured `post_logout_redirect_uri` and no `id_token_hint`, because the ID token never leaves the server. Odudu then asks the person to confirm on its own page. A session with no end-session endpoint, or no session at all, answers `204`. An end-session endpoint that is not https is not redirected to unless `deps.allowInsecureRequests` is set; the session is still ended here.
- **The proxy and SSRF.** The host never comes from the request: the target is the configured origin plus a checked path. The path is checked as it will be sent, on whole segments: a dot segment, an empty segment other than one trailing empty segment, a space or DEL, a backslash, a semicolon, a control or non-ASCII character, an escaped dot, slash, backslash, percent sign or NUL, and a malformed escape are `403`.
- **What crosses the proxy.** The upstream request loses the cookie, `host`, `origin`, the BFF header, any `Authorization` the browser sent, every hop-by-hop header and every header the `Connection` header names, `forwarded`, `x-real-ip` and every `x-forwarded-*` header, and gains `Authorization: Bearer` with the session's token; it also sets `Accept-Encoding: identity`. The answer loses `Set-Cookie`, the hop-by-hop headers and `X-Odudu-Session`. An upstream `3xx` is returned as it is and never followed, and an upstream `401` is returned as it is. Bodies stream and are counted against `maxBodyBytes`.
- **A public client.** Without `clientSecret` the BFF signs in as a public client. That is for development: it is not the architecture the RFC describes.

## Not in this package

- **A shipped shared store.** The only store is the in-memory one. For several instances, write a `SessionStore` over your own database or cache, with `lock` if you can.
- **A way to read tokens in the browser.** None of its routes returns one. Your APIs are called through the proxy.
- **A user interface.** [`@odudu-io/react`](./react.md) reads the session from the browser side.

## Examples and neighbours

[The React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff) runs this package behind Express with `@odudu-io/react`, and [Examples](./examples.md#react-bff) shows its key lines. The source is in [`sdks/bff`](https://github.com/wizzywit/odudu/tree/main/sdks/bff), and [ADR 0054](https://github.com/wizzywit/odudu/blob/main/docs/adr/0054-the-bff-keeps-tokens-and-the-browser-keeps-an-id.md) records every decision above with the alternatives it rejected.

Next: [`@odudu-io/react`](./react.md) for the page, [`@odudu-io/next`](./next.md) for a Next app, and [`@odudu-io/oidc`](./oidc.md) for the core underneath.
