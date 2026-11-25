---
title: '@odudu-io/me-client'
description: A typed client for the Odudu me API, with which a signed-in person reads and changes their own profile, credentials, sessions and consents.
sidebar_position: 8
---

# @odudu-io/me-client

This package calls the me API: the operations a signed-in person makes about their own account under `/tenants/{tenant}/me`. It is built the same way as [`@odudu-io/admin-client`](./admin-client.md), from the me API's OpenAPI document, and shares its behavior for the tenant, retries, iteration and errors.

## Install

```text
npm install @odudu-io/me-client
```

It needs Node 24 or later and depends on `openapi-fetch`. The token for it comes from a person's sign-in with [`@odudu-io/oidc`](./oidc.md), which the example below imports: install it too.

## The shortest use

This is the second half of [the admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin). A person signs in at a loopback address, as a command-line tool does, and the script reads their profile. The sign-in asks for the person's own account with `meAccess: 'read'`, and the access token for it is filed under the me audience, the issuer's address plus `/me`. The client the person signs in with must be registered with that audience (`odudu seed client --audience <issuer>/me`). It also needs the scope `me:read` assigned, and `me:write` to write. An administrator assigns it, and `odudu seed client --allow-action <action>` assigns `me:read` as well (the example's `provision.sh` relies on that).

```ts
import { createMeClient } from '@odudu-io/me-client';
import { beginSignIn, completeSignIn } from '@odudu-io/oidc';

const base = 'https://id.example.com';
const issuer = `${base}/tenants/acme`;

const { url, pending } = await beginSignIn({
  issuer,
  clientId: 'my-cli',
  redirectUri: 'http://127.0.0.1:8086/callback',
  scope: 'openid',
  meAccess: 'read',
});
console.log(`Open ${url} to sign in.`);

// Your code waits for the redirect to reach the loopback address and gives the
// whole address it arrived at to completeSignIn.
declare function waitForCallback(): Promise<string>;
const tokens = await completeSignIn(await waitForCallback(), pending);

const meToken = tokens.byAudience[`${issuer}/me`]?.accessToken;
if (meToken === undefined) throw new Error('no token for the me API came back');

const me = createMeClient({ baseUrl: base, tenant: 'acme', token: meToken });
const profile = await me.GET('/tenants/{tenant}/me/profile');
console.log(`profile: ${profile.data.username}`);
```

The block is illustrative. It follows the example, which the repository's CI runs by signing the person in with a browser, but `waitForCallback` stands in for the example's loopback listener.

## What it exports

| Export                              | What it does                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createMeClient(options)`           | Returns an object with `GET`, `POST`, `PUT`, `PATCH` and `DELETE`. Each takes a path as the document writes it, with `{tenant}`; the client fills the tenant in. |
| `iterate(listCall, options?)`       | An async generator that walks a list by cursor. It reads `next_cursor`, which is what the me API calls it.                                                       |
| `ProblemError`                      | The error every response that is not a success becomes.                                                                                                          |
| `paths`, `operations`, `components` | The generated types of the document. `MeError` and `FieldError` are exported types.                                                                              |

The routes are profile, credentials, sessions, consents and delegations, listed in [the me API reference](../reference/generated/me-api/index.md).

## Options

The options of `createMeClient` and `iterate` are those of [`@odudu-io/admin-client`](./admin-client.md#options): `baseUrl`, `tenant`, `token` (a string, or a function that returns one and is called for every request), `fetch`, `timeoutMs` and `sleep`, and for `iterate` `pageLimit` and `maxItems`.

Use https: an `http` base URL sends the token in the clear. The `token` is an access token whose audience is the tenant's `/me` URL, with the scope the operation names. A token for another audience is refused with `401`, and one without the scope with `403`.

## Errors

A call that runs out of time raises a `RequestTimeoutError`, as in the admin client. A call rejects with a `ProblemError`, as in [`@odudu-io/admin-client`](./admin-client.md#errors). The `code` of a me API refusal is the `error` field of its body: `invalid_request`, `not_found`, `conflict`, `agent_not_permitted` or `mail_unavailable`, and `last_sign_in_method` or `last_second_factor` for a refused removal of a credential. The `detail` is the `error_description`, a sentence for a person to read: match on `code`, not on the text.

## Security notes

- **The same transport rules as the admin client.** The token goes to one origin. Redirects are never followed and a 3xx is a `ProblemError`. A call cannot name its own origin, `fetch`, redirect policy or middleware.
- **Retries** follow the admin client: at most two repeats, only for `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE`, or a call that carries an `Idempotency-Key`. The me client adds no key itself, because the me API's document marks no operation as idempotent, so a `POST` or `PATCH` is retried only if you give it one.
- **A person's token.** It stands for the person, so keep it as you would any access token: in memory, or on a server that holds it for them. A service has no profile to read, so a token from the client credentials grant is not what this client is for.

## Not in this package

- **A sign-in.** It takes a token and does not get one. [`@odudu-io/oidc`](./oidc.md) signs a person in and asks for the me audience with `meAccess`.
- **The admin API.** For a service that manages a tenant, see [`@odudu-io/admin-client`](./admin-client.md).
- **A user interface for the account.** It is a client for the API, not a set of pages.

## Examples and neighbours

[The admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin) uses this package beside the admin client. The Python package [`odudu`](./python.md) has a client for the same API as `odudu.me`. The source is in [`sdks/me-client`](https://github.com/wizzywit/odudu/tree/main/sdks/me-client).
