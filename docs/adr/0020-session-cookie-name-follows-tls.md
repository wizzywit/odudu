# 0020 — The session cookie's name follows TLS

**Status:** Accepted · 2026-09-13

## Context

The `__Host-` cookie name prefix is the strongest binding a cookie can
carry: a browser rejects the whole cookie unless it is `Secure`, has
`Path=/`, and names no `Domain`. It is the right shape for a session cookie
in production.

It is also unusable over plain HTTP, and the compose stack serves plain HTTP
on `:3000`. Always emitting `__Host-` would silently break every local
login — the browser would drop the cookie and the flow would simply not
complete, with nothing said anywhere about why.

Two ways out were considered:

**(a)** Always `__Host-`, and stand up local HTTPS now.
**(b)** `__Host-<realm>-session` when TLS is on, `<realm>-session` without
`Secure` otherwise, plus a boot-time warning while the fallback is active.

## Decision

**(b).** `sessionCookieName(realm, tls)`
(`packages/authn-flows/src/index.ts`) is the only place the name is decided.

This keeps the production cookie shape correct from day one, so there is no
later migration of session cookies; it keeps `pnpm dev` working without a
local CA; and it makes the weaker mode something an operator sees in the log
rather than something that ships quietly.

The name is all this package decides. Whoever sets the header — the login
handler behind `/authorize` — must also set `HttpOnly`, `SameSite=Lax` at
minimum (so the cookie survives the top-level redirect back from
`/authorize`), `Path=/` (required by `__Host-` when TLS is on, and kept
identical in the fallback so the two modes differ only in name and `Secure`)
and `Secure` when TLS is on. Dropping `Secure` in the fallback must not mean
dropping the other three.

## Consequences

- A deployment that forgets `ODUDU_TLS` gets a cookie without `Secure` and a
  warning saying so, rather than a login that fails with no explanation.
  `assertProductionTls` (`apps/server/src/config-guard.ts`) is what stops
  that combination reaching production at all.
- The cookie's name differs between local development and production. That
  is visible by design: the name is the signal that the weaker mode is
  active.

## Alternatives rejected

- **(a) Always `__Host-`, with local HTTPS.** Moves TLS provisioning into
  local development for no security gain in a loop that talks to itself over
  loopback, and buys nothing production does not already have under (b).
- **(c) Always the unprefixed name.** Correct everywhere, weakest
  everywhere; it throws away the one cookie-integrity property browsers
  enforce for free.
