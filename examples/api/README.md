# API example

An API that decides, on its own, whether to trust the access token a caller sends. It does not ask Odudu on each request. This example is one file, `server.ts`, and one dependency, the `@odudu-io/node` SDK, which makes the checks below.

## What it checks

For `GET /reports`, in this order:

1. The token's signature, against the tenant's published keys. The keys are fetched once, kept, and fetched again when a token names a key the API does not know.
2. The issuer is the tenant you trust, exactly.
3. The audience is this API. Odudu always puts the tenant's address in a token's audience, beside any audience the client is registered for; set `API_AUDIENCE` to change what this API accepts.
4. The token is an access token. An ID token is signed with the same keys, so the check on its type is what keeps it out.
5. The token has not expired.
6. The token's `scope` holds `reports:read`. A valid token without it is a `403`, because the caller is known and not allowed; a `401` means the token itself is not trusted.

A token that fails the first five is a `401`, and the body says only `invalid_token`.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once, then:

```text
../_shared/install.sh . node
npm start
```

The SDK is not on npm yet, so `../_shared/install.sh` builds it from this repository and installs the packed result (it needs `pnpm install` run once at the repository root). Once `@odudu-io/node` is published, `npm install` is all a copy of this folder needs.

Get a token the way [`../machine-to-machine`](../machine-to-machine) does and call `http://localhost:8082/reports` with it. `npm test` does that against your stack: a service with the scope, a service without it, a person, no token, another audience and an ID token. The ways a token can be wrong that need keys made on the spot are tried by the SDK's own tests.

## What is only for the example

The API listens on plain http; a production API sits behind HTTPS. The audience is the tenant itself, which Odudu always puts in a token's audience, so the API accepts every token the tenant issues. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) wants the audience to name the API; that is a choice for your API, and `API_AUDIENCE` is where you make it.
