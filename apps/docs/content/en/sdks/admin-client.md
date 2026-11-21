---
title: '@odudu-io/admin-client'
description: A typed client for the admin API of one tenant, with the tenant filled in, safe retries, cursor iteration and one error type for every refusal.
sidebar_position: 7
---

# @odudu-io/admin-client

This package calls the admin API of one tenant from code. Its paths and types are generated from the admin API's OpenAPI document, so a call you write is checked against the API's own routes, and a client built from it cannot send its token to another origin.

## Install

```text
npm install @odudu-io/admin-client
```

It needs Node 24 or later and depends on `openapi-fetch`. To get a token as a service, use the token source of [`@odudu-io/oidc`](./oidc.md), which the example below imports: install it too.

## The shortest use

This is the first half of [the admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin). A service signs in as itself, makes a client, walks the tenant's clients and deletes the one it made.

```ts
import { createAdminClient, iterate } from '@odudu-io/admin-client';
import { createTokenSource } from '@odudu-io/oidc';

const admin = createAdminClient({
  baseUrl: 'https://id.example.com',
  tenant: 'acme',
  token: createTokenSource({
    issuer: 'https://id.example.com/tenants/acme',
    clientId: 'my-service',
    auth: { secret: process.env.CLIENT_SECRET ?? '' },
    resource: 'urn:odudu:params:admin-api',
  }),
});

const created = await admin.POST('/admin/tenants/{tenant}/clients', {
  body: {
    client_id: 'made-from-code',
    name: 'Made from code',
    grant_types: ['client_credentials'],
  },
});

for await (const client of iterate((page) =>
  admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
)) {
  console.log(client.client_id);
}

await admin.DELETE('/admin/tenants/{tenant}/clients/{id}', {
  params: { path: { id: created.data.id } },
});
```

The block is illustrative. The example it comes from is run by the repository's CI against a live stack. What the service may do is what the admin capabilities of its account allow; the example's `provision.sh` gives it `manage-clients` with `odudu seed client --audience urn:odudu:params:admin-api --capability manage-clients`: the client also needs the admin API's audience.

## What it exports

| Export                              | What it does                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAdminClient(options)`        | Returns an object with `GET`, `POST`, `PUT`, `PATCH` and `DELETE`. Each takes a path as the document writes it, with `{tenant}`; the client fills the tenant in. |
| `iterate(listCall, options?)`       | An async generator that walks a list by cursor, one request per page.                                                                                            |
| `ProblemError`                      | The error every response that is not a success becomes.                                                                                                          |
| `paths`, `operations`, `components` | The generated types of the document. `ProblemDetails` and `FieldError` are exported types.                                                                       |

A call resolves with the success response (`{ data, response }`) and rejects with a `ProblemError` for any other. Reference pages for every route are in [the admin API reference](../reference/generated/admin-api/index.md).

## Options

### `createAdminClient`

| Option      | Required | What it does                                                                                                                                                                                                                   |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`   | yes      | The origin and base path of the server, such as `https://id.example.com`. An absolute http or https URL. Use https: an `http` base URL sends the token in the clear.                                                           |
| `tenant`    | yes      | The tenant every call is made in. A path never repeats it.                                                                                                                                                                     |
| `token`     | yes      | An access token, or a function that returns a promise of one (`() => Promise<string>`). The function is called for every request.                                                                                              |
| `fetch`     | no       | The function every request goes through.                                                                                                                                                                                       |
| `timeoutMs` | no       | The longest one attempt may wait for the answer, in milliseconds: a finite number above zero, `30000` when omitted. A timed-out attempt is retried like a network error, and the call then fails with a `RequestTimeoutError`. |
| `sleep`     | no       | Waits between retries; replaced in tests.                                                                                                                                                                                      |

### `iterate`

| Option      | Default | What it does                                                        |
| ----------- | ------- | ------------------------------------------------------------------- |
| `pageLimit` | `50`    | Items asked for per request.                                        |
| `maxItems`  | `10000` | Items after which iteration stops, whatever the server still holds. |

Both must be positive integers, or `iterate` throws a `RangeError`. Iteration ends on an empty page, on no cursor and on a cursor that did not move, so a faulty server cannot loop it. The list call receives `{ limit, cursor }` as the `query`.

## Errors

A call rejects with a `ProblemError` for every response that is not a success, a redirect included.

| Field                                 | What it holds                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `status`                              | The HTTP status.                                                                                   |
| `code`                                | The part after `#` of the problem `type` (`about:blank#idempotency-in-flight`), when there is one. |
| `title`, `detail`, `type`, `instance` | What the RFC 9457 problem document says, each at most 1,000 characters.                            |
| `errors`                              | A list of field errors, at most 100, each `{ path, message, code?, detail?, line?, column? }`.     |
| `response`                            | The `Response`.                                                                                    |

A body that is not a problem document, such as a proxy's error page, contributes nothing but the status, so its text is never echoed. The [error code reference](../reference/generated/errors.md) lists what the admin API sends.

A call that runs out of time raises a `RequestTimeoutError` after its retries; a `signal` you pass still aborts the call with its own `AbortError`. A call that is refused before it is sent, such as a path id of `.` or `..`, rejects the returned promise. `createAdminClient` throws a `TypeError` for a `baseUrl` that is not an absolute http or https URL and for a `tenant` that is empty, is `.` or `..`, or holds `/`, `\`, `%` or a control character, and for a `timeoutMs` that is not a finite number above zero.

## Security notes

- **The token goes to one origin.** Redirects are never followed, and any 3xx, a 304 among them, is a `ProblemError`. A call cannot set `baseUrl`, `fetch`, `redirect`, `middleware` or `pathSerializer`. An `Authorization` header a call names is replaced by the client's own.
- **Retries.** A request is repeated at most twice, on a `429`, `500`, `502`, `503` or `504` or a network failure, and only when a repeat is harmless: `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE`, and any call that carries an `Idempotency-Key`. The wait is `Retry-After` seconds when the server names them, otherwise 200 ms doubling, and never over 5 seconds. A retried `DELETE` whose first answer was lost can answer `404`, because the first attempt took effect.
- **Idempotency keys.** For the `POST` operations the document marks as idempotent (creating a subject, role, group, scope, flow, domain or key, and publishing or restoring a theme, among others) the client adds an `Idempotency-Key` unless you give one, and a repeat carries the same key.
- **A token function.** Because the function is called for every request, give it one that caches, such as `createTokenSource` from [`@odudu-io/oidc`](./oidc.md), or the client will ask Odudu for a token on each call.
- **Where the secret lives.** A service's secret belongs in your platform's secret store, not in code.

## Not in this package

- **No retries for a `POST` or `PATCH` without an `Idempotency-Key`.** The client cannot know a repeat is harmless, so it sends it once.
- **No token source.** It takes a token or a function. [`@odudu-io/oidc`](./oidc.md) makes one.
- **The account API.** A person's own account is [`@odudu-io/me-client`](./me-client.md). A service has no profile to read.

## Examples and neighbours

[The admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin) uses this package and `@odudu-io/me-client` in one script. [The Python example](https://github.com/wizzywit/odudu/tree/main/examples/python) makes and reads a client the same way with [`odudu`](./python.md). The source is in [`sdks/admin-client`](https://github.com/wizzywit/odudu/tree/main/sdks/admin-client).

Next: [`@odudu-io/me-client`](./me-client.md) for the account API, and [`@odudu-io/mcp-stdio`](./mcp-stdio.md), which exposes the admin tools to an AI client.
