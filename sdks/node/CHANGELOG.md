# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createVerifier` checks an Odudu access token for an API: the signature against the issuer's keys (RS256 or ES256, read from the `jwks_uri` of its discovery document), the issuer, the audience, `typ` `at+jwt`, the expiry and the required scope. A refusal is a `VerificationError` carrying the HTTP status (401 or 403) and the `WWW-Authenticate` challenge to send.
- A token that names the "me" audience beside the API's is refused, as the server refuses it.
- Keys are cached for five minutes (`jwksTtlMs`), shared between concurrent requests and read again at most once every 10 seconds when a token names an unknown `kid`. At most 20 keys are kept per issuer and 256 issuers. Failing to read the keys rejects with `KeyFetchError`, which is not a fault of the token.
- Middleware that puts `createVerifier` in front of a route: `requireToken` for Express 5 from `@odudu-io/node/express` (the token is `authOf(req)`, also `req.auth`), the `oduduAuth` plugin for Fastify 5 from `@odudu-io/node/fastify` (`request.auth`, and `app.requireToken()` as an `onRequest` hook), and `withToken` for a Node `http` handler from `@odudu-io/node/http`. Express and Fastify are optional peer dependencies; the package root needs neither. Each route can name a `scope`.
- A request with no credentials, or a scheme other than `Bearer`, is answered `401` with a bare `WWW-Authenticate: Bearer`; a refused token is answered with the verifier's status and challenge and a small JSON body that never echoes the token. More than one `Authorization` header, or a `Bearer` value that is not one token (more than one space after `Bearer` counts: the separator is one space, and the Python verifier agrees), is answered `400` with `error="invalid_request"`. A token in the query string is never read. When the issuer's keys cannot be read the answer is `503` with `Retry-After: 10`, not `401`, so a client keeps a token that is fine. Every answer carries `Cache-Control: no-store`; any other error goes to the framework's own error handling.
- `@odudu-io/node/fastify` needs `fastify` installed; `@odudu-io/node/express` and `@odudu-io/node/http` need neither framework. A `scope` or `requiredScope` that is not one RFC 6749 scope token (empty, with a space, a quote, a backslash or a line break) is refused with a `TypeError` when the middleware or verifier is made: a value with a space could never match one member of the token's scope and would refuse every request, and the others would land in the `WWW-Authenticate` challenge.

### Fixed

- The verifier imports each key into a `CryptoKey` once and keeps it with the key set it came from, instead of on every request, so a request costs one signature check.
- `withToken` answers `500` and ends the response even when the `onError` hook throws.
- Keys kept through a failed read are never served past twice `jwksTtlMs`, however short the TTL.
- A `jwks_uri` that is not https is refused with `KeyFetchError` for an https issuer; an http issuer (allowed with `allowInsecureIssuers`) may name an http one only on its own origin.
