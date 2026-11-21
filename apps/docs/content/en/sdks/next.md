---
title: '@odudu-io/next'
description: 'Sign a person in to a Next.js App Router app: route handlers run the backend for frontend, getSession reads the person and withAuth gates a path.'
sidebar_position: 5
---

# @odudu-io/next

This package binds [`@odudu-io/bff`](./bff.md) to the Next.js App Router. One call makes the route handlers that run the sign-in, the session and the proxy, and a server-side `getSession()` that returns the claims of the signed-in person. The server keeps the tokens in a session store and the browser holds only an `HttpOnly` cookie with an opaque id.

## Install

```text
npm install @odudu-io/next
```

It needs Next 16 and React 19 (peer dependencies), and Node 24 or later. It depends on [`@odudu-io/bff`](./bff.md).

## The shortest use

This is [the Next.js example](https://github.com/wizzywit/odudu/tree/main/examples/next), trimmed. Create the handlers once.

```ts
// lib/odudu.ts
import { createOduduHandlers } from '@odudu-io/next';

const origin = 'https://app.example.com';

export const { GET, POST, PUT, PATCH, DELETE, getSession } = createOduduHandlers({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'my-app',
  clientSecret: process.env.CLIENT_SECRET ?? '',
  redirectUri: `${origin}/api/auth/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile',
});
```

Export the methods from a catch-all route, so that `/api/auth/login`, `/callback`, `/logout`, `/session` and `/proxy/...` answer.

```ts
// app/api/auth/[...odudu]/route.ts
export { GET, POST, PUT, PATCH, DELETE } from '../../../../lib/odudu';
```

Read the person in a server component, and gate a path in `proxy.ts`.

```tsx
// app/dashboard/page.tsx
import { getSession } from '../../lib/odudu';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await getSession();
  return <p>{session === null ? 'No session.' : `Hello, ${String(session.claims.sub)}.`}</p>;
}
```

```ts
// proxy.ts
import { withAuth } from '@odudu-io/next';

export const proxy = withAuth({ paths: ['/dashboard'] });

export const config = { matcher: ['/dashboard/:path*'] };
```

These blocks are illustrative: the example they come from is run by the repository's CI.

## What it exports

| Export                         | What it does                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createOduduHandlers(options)` | Returns `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `getSession`, all on one BFF and so on one session store.                                           |
| `withAuth(options)`            | Returns a function for `proxy.ts` (it was `middleware.ts` before Next 16) that sends a request for a protected path with no session to the login route. |

`getSession()` returns `{ claims }` for a signed-in person, or `null`. It is for a server component, a server action or a route handler.

## Options

### `createOduduHandlers`

It takes every option of [`@odudu-io/bff`](./bff.md#options) and one more.

| Option      | Default     | What it does                                                                                                                                                                         |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mountPath` | `/api/auth` | The path of the catch-all route the handlers are exported from, with `/login`, `/callback`, `/logout`, `/session` and the proxy below it. The proxy defaults to `<mountPath>/proxy`. |

An app with a `basePath` is untested and not supported yet.

### `withAuth`

| Option       | Default             | What it does                                                                                                                                                               |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`      | required            | Paths that need a session, matched on whole segments: `/dashboard` covers `/dashboard/settings` and not `/dashboards`. Give the same list to `config.matcher`.             |
| `cookieName` | `__Host-odudu`      | The cookie the BFF was given.                                                                                                                                              |
| `loginPath`  | `<mountPath>/login` | Where an anonymous request is sent. The request's own path and query go with it as `returnTo`.                                                                             |
| `mountPath`  | `/api/auth`         | The BFF's mount path, whose routes are never protected.                                                                                                                    |
| `store`      | none                | Without one the function checks that the cookie is there and looks like an id. With one it also asks whether that id is a session. It must be the store the BFF was given. |

## Errors

`createOduduHandlers` and `withAuth` throw a `TypeError` when an option cannot work: a `mountPath` that is not a clean path, a `loginPath` that is not a path on this origin, or any option [`@odudu-io/bff`](./bff.md#errors) refuses. The route handlers answer the browser with the statuses listed there.

`getSession()` does not throw for a missing session: it returns `null`, including when the session's tokens ran out for good.

## Security notes

- **Where tokens live.** In the session store on the server. The cookie holds an opaque id, `getSession()` returns claims and never a token, and the session answer holds no token. The cookie and CSRF rules are those of [`@odudu-io/bff`](./bff.md#security-notes).
- **`getSession()` only reads.** It never refreshes, deletes or writes, so it is safe where a response can no longer set a cookie. A single Next process has several module graphs, each with its own refresh guard, so a refresh from a render could spend a rotating refresh token twice and end the session. Refreshing stays with the route handlers and the proxy. A session whose access token is stale is still returned; the route handlers renew it.
- **`withAuth` is a gate and not authorization.** Without a `store` it sees only that a cookie shaped like a session id is there, and anyone can send one. Authorize with `getSession()` in the server component or handler. An app with private data must check it there.
- **The default store.** Without a `store`, sessions live in one per-process registry on `globalThis`, because a Next build gives each route and page its own copy of a module. It is lost on restart and is not shared across processes or serverless instances. The package emits one warning per production process with the code `ODUDU_NEXT_DEFAULT_STORE`. An app that runs more than one process passes its own `store`, as described under [the BFF's store](./bff.md#security-notes), and passes the same store to `withAuth`, because the default one is not visible from `proxy.ts`.
- **`returnTo`.** The login route takes a `returnTo` path and sends the person there after the sign-in. Only a path that starts with one slash qualifies: a scheme, a host, `//host`, a backslash, an escaped slash and a path under the BFF's own routes are refused. It travels in a cookie that is checked again when read.

## Not in this package

- **A shipped shared store.** There is none. A deployment on more than one process or on serverless needs a `SessionStore` of its own.
- **A `basePath`.** An app that sets one is untested and not supported yet.
- **React components.** The page reads the session on the server with `getSession()`. For client components that call the BFF, see [`@odudu-io/react`](./react.md) in `bff` mode with `baseUrl` set to the mount path.

## Examples and neighbours

[The Next.js example](https://github.com/wizzywit/odudu/tree/main/examples/next) runs this package end to end. The source is in [`sdks/next`](https://github.com/wizzywit/odudu/tree/main/sdks/next).

Next: [`@odudu-io/bff`](./bff.md), which it builds on, and [`@odudu-io/oidc`](./oidc.md) for the core.
