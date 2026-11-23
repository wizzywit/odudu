# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-23

### Changed

- No code change. The first version published from the release workflow, which checks that releases from CI reach npm.

## [0.1.0] - 2026-11-23

### Added

- `onError(error)` on `bffRouter` and `registerBff` receives the error of a handler that failed and was answered `500`, with nothing of the request, and an error the hook throws is ignored. `registerBff` logs to `app.log.error` when none is given. Neither adapter reported these errors before. A browser that leaves mid-answer is not reported.
- `idTokenAlg` (`'RS256'` when omitted, or `'ES256'`) names the algorithm the client is registered for ID tokens, for the sign-in and for the refresh. A client registered for `ES256` could not sign in through the BFF or `@odudu-io/next`, which takes every BFF option.
- `upstreamIdleMs` (30 seconds when omitted, a positive whole number or a `TypeError`) cuts a proxied response off, and the upstream request with it, when its body goes that long without a chunk once the upstream has started answering. `upstreamTimeoutMs` still bounds the wait for the answer to start.
- `BffOptions.mountPath` (the root when omitted) is the default `prefix` of `bffRouter` and `registerBff` and puts the proxy at `${mountPath}/proxy` unless `proxyPath` is given, so `@odudu-io/react`'s `baseUrl` reaches the proxy as well as the login and the session.
- `SessionStore` takes an optional `lock(id, ttlMs)`. A store shared by several instances that implements it keeps two instances from refreshing one session at the same time, which the issuer treats as a replayed refresh token and answers by ending the session. The lock is taken on `lock:<session id>`, lapses after 120 s, and its release function must release only its holder's own lock. When the lock is not granted the session read answers `503` and keeps the session.

### Changed

- An upstream whose `origin` is `http` is refused when the BFF is created, unless its host is `localhost`, `127.0.0.1` or `[::1]` or `deps.allowInsecureRequests` is `true`. The proxy sends the session's access token to the upstream, which must not travel in the clear by default.

### Fixed

- A browser that leaves a proxied call, in the wait for the upstream's headers as well as while the body streams, now aborts the upstream request, through the request's `signal` and through the Express and Fastify adapters' connection close.
- The BFF's own `401` (no session, a session the issuer ended, `session`) carries `X-Odudu-Session: ended`, and the proxy removes that header from every upstream answer, so a client can tell it from an API's `401`.
- A gateway error or an empty `429` from the token endpoint during a refresh keeps the session and answers `503` (it ended the session), and during the callback answers `502` (it answered `400`).
- A refresh whose ID token names another subject ends the session at once (`401`) instead of keeping it.
- Sign-out no longer redirects to an `end_session_endpoint` that is not https (the session is still ended here and the response carries no address); an http endpoint passes only with `allowInsecureRequests`.
