---
title: '@odudu-io/node'
description: Check the access token an API receives in Node, against the tenant's published keys, with middleware for Express, Fastify and the plain http module.
sidebar_position: 6
---

# @odudu-io/node

This package decides, in your API and without asking Odudu on each request, whether to trust an access token. It checks the signature against the tenant's published keys, the issuer, the audience, the token type, the expiry and, if you ask, a required scope, and it answers a refusal with the status and the `WWW-Authenticate` challenge RFC 6750 describes.

## Install

```text
npm install @odudu-io/node
```

It needs Node 24 or later and depends on `jose`. Express 5 and Fastify 5 are optional peer dependencies: the package root and `@odudu-io/node/http` need neither, and `@odudu-io/node/fastify` needs `fastify` installed.

## The shortest use

This is [the API example](https://github.com/wizzywit/odudu/tree/main/examples/api), trimmed. It protects one route of a plain `http` server.

```ts
import { createServer } from 'node:http';
import { createVerifier } from '@odudu-io/node';
import { withToken } from '@odudu-io/node/http';

const verifier = createVerifier({
  issuers: ['https://id.example.com/tenants/acme'],
  audience: 'https://api.example.com',
});

// A valid token without the scope is a 403: the caller is known and not allowed.
// A 401 means the token itself is not trusted.
const reports = withToken(
  verifier,
  (_request, response, token) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ caller: token.clientId ?? token.sub }));
  },
  { scope: 'reports:read', onError: (error) => console.error(String(error)) },
);

createServer((request, response) => {
  if (request.url === '/reports') return reports(request, response);
  response.writeHead(404).end();
}).listen(8082);
```

For Express 5, `requireToken(verifier, { scope })` from `@odudu-io/node/express` is a middleware, and `authOf(req)` returns the token. For Fastify 5, register `oduduAuth` from `@odudu-io/node/fastify` with `{ verifier }`, then use `app.requireToken({ scope })` as an `onRequest` hook; the token is `request.auth`.

```ts
import express from 'express';
import { createVerifier } from '@odudu-io/node';
import { authOf, requireToken } from '@odudu-io/node/express';

const verifier = createVerifier({
  issuers: ['https://id.example.com/tenants/acme'],
  audience: 'https://api.example.com',
});

const app = express();
app.get('/reports', requireToken(verifier, { scope: 'reports:read' }), (req, res) => {
  res.json({ caller: authOf(req).sub });
});
```

These blocks are illustrative. The first one is run by the repository's CI as the API example.

## What it exports

| Export                                   | What it does                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `createVerifier(options)`                | Returns a `Verifier`: `(token: string) => Promise<VerifiedToken>`. It rejects with `VerificationError` or `KeyFetchError`. |
| `VerificationError`, `KeyFetchError`     | The two errors a verifier raises. See [the errors](#errors).                                                               |
| `requireToken(verifier, options?)`       | From `@odudu-io/node/express`. Express middleware. `authOf(req)` returns the verified token, and so does `req.auth`.       |
| `oduduAuth`                              | From `@odudu-io/node/fastify`. A plugin that adds `request.auth` and `app.requireToken(options?)`, an `onRequest` hook.    |
| `withToken(verifier, handler, options?)` | From `@odudu-io/node/http`. Wraps a handler for `http.createServer`; the handler gets `(req, res, token)`.                 |

A `VerifiedToken` is `{ sub, clientId, scope, audience, claims }`: the subject, the `client_id` claim when present, the scope as a list, the audience as a list and every claim.

## Options

### `createVerifier`

| Option                 | Default    | What it does                                                                                                           |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `issuers`              | required   | The issuers whose tokens the API accepts. A token's `iss` must equal one exactly, and keys are fetched for these only. |
| `audience`             | required   | What this API is called in a token's `aud`.                                                                            |
| `requiredScope`        | none       | A scope every accepted token must carry. Its absence is a `403`.                                                       |
| `jwksTtlMs`            | `300000`   | How long an issuer's discovery document and keys are kept.                                                             |
| `clock`                | `Date.now` | Milliseconds since the epoch.                                                                                          |
| `fetch`                | global     | The function that reads the discovery document and the keys.                                                           |
| `allowInsecureIssuers` | `false`    | Accepts issuers that are not https. For a development server on loopback.                                              |

### The middleware

`requireToken`, `app.requireToken` and `withToken` take `scope`, a scope the route needs; without it the route answers `403`. `withToken` also takes `onError`, told of an error that is not a refusal so you can log it; the caller gets a bare `500`. A `scope` or `requiredScope` that is not one RFC 6749 scope token (empty, or with a space, a quote, a backslash or a line break) throws a `TypeError` when the middleware or verifier is made.

## Errors

A verifier raises one of two errors.

**`VerificationError`** means the token is at fault. It carries `status` (`401`, or `403` for a missing scope), `code` (`invalid_token` or `insufficient_scope`), `challenge` (the `WWW-Authenticate` value to send) and `reason`. The `reason` is for your logs and tests. It never goes in the challenge, so a caller learns no more than the code and a fixed description.

| Reason                  | Which check refused the token                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `malformed`             | The token is not a JWT, is longer than 16,384 characters, or failed in a way no other reason names. |
| `invalid_header`        | The header names no `kid`.                                                                          |
| `wrong_type`            | The header `typ` is not `at+jwt`. This is what keeps an ID token out.                               |
| `unsupported_algorithm` | The algorithm is not RS256 or ES256, or the key names a different one.                              |
| `wrong_issuer`          | The `iss` is not one of the configured issuers.                                                     |
| `unknown_key`           | The issuer publishes no key with that `kid`.                                                        |
| `bad_signature`         | The signature does not verify.                                                                      |
| `expired`               | The token's `exp` has passed.                                                                       |
| `not_yet_valid`         | The token's `nbf` is in the future.                                                                 |
| `wrong_audience`        | The `aud` does not name this API.                                                                   |
| `me_audience`           | The `aud` names the account API beside this API.                                                    |
| `invalid_claims`        | A required claim, such as `exp` or `sub`, is missing or has the wrong shape.                        |
| `insufficient_scope`    | The token lacks the required scope. The challenge names it.                                         |

**`KeyFetchError`** means the issuer's keys could not be read, so the token has not been judged. Answer `503`, not `401`, so a client keeps a token that is fine. The middleware does.

### What the middleware answers

| Situation                                                                           | Answer                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| No credentials, or a scheme other than `Bearer`                                     | `401` with a bare `WWW-Authenticate: Bearer`.                                           |
| More than one `Authorization` header, or a value that is not `Bearer` and one token | `400` with `error="invalid_request"`.                                                   |
| A refused token                                                                     | The verifier's status and challenge, and a small JSON body that never echoes the token. |
| The issuer's keys cannot be read                                                    | `503` with `Retry-After: 10`.                                                           |
| Any other error                                                                     | The framework's own error handling; `withToken` answers `500` and ends the response.    |

Every answer carries `Cache-Control: no-store`.

## Security notes

- **Strictness.** Only RS256 and ES256 are accepted, so `none` and any HMAC are refused before a key is looked up. The header `typ` must be exactly `at+jwt`. RFC 9068 also allows `application/at+jwt`; the server compares the header with `at+jwt` exactly and refuses the rest, and so does this package. The header must name a `kid`, and `exp` is required.
- **Choices to know about.** The clock tolerance on `exp` and `nbf` is 5 seconds. The separator after `Bearer` is exactly one space: more than one is a `400`. A token in the query string is never read. A token that names the account API's audience beside the API's own is refused, as the server refuses it at every door but that one.
- **Keys.** They are read from the `jwks_uri` of the issuer's discovery document and cached for `jwksTtlMs`, shared between concurrent requests, and read again at most once every 10 seconds when a token names an unknown `kid`. Keys kept through a failed read are never served past twice `jwksTtlMs`. At most 20 keys are kept per issuer and 256 issuers. Only public keys meant for signing are used, and others in the set are ignored.
- **https.** A `jwks_uri` that is not https is refused with `KeyFetchError` for an https issuer. An http issuer, allowed with `allowInsecureIssuers`, may name an http one only on its own origin. The issuer a token claims only selects among the configured issuers: it is never fetched or used as an address.
- **What a local check cannot see.** A signature check cannot know that a session just ended or that a token was revoked. Until the token's `exp` it still passes. Keep access tokens short, as Odudu does, or ask Odudu through [token introspection](../reference/transcripts/request-paths/rp-initiated-logout.md#token-introspection-and-revocation) where that matters.
- **The audience.** Odudu names the tenant itself as the audience unless the client registers another one. RFC 9068 wants the audience to name your API, so register one on the client and pass it as `audience`.

## Not in this package

- **Token issuing or a sign-in.** It only verifies. For sign-in, see [`@odudu-io/oidc`](./oidc.md).
- **Introspection.** It makes no request to the introspection endpoint.
- **Other frameworks.** There is no adapter beyond Express, Fastify and the plain `http` handler; with another framework, call the `Verifier` yourself and answer with the status and challenge of the error.
- **Python.** The same rules are in [`odudu`](./python.md), which has its own differences in key selection.

## Examples and neighbours

[The API example](https://github.com/wizzywit/odudu/tree/main/examples/api) uses this package. [The machine-to-machine example](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine) is a client for it. The source is in [`sdks/node`](https://github.com/wizzywit/odudu/tree/main/sdks/node).

The guide [Protect an API](../guides/api.md) walks through the checks one at a time.
