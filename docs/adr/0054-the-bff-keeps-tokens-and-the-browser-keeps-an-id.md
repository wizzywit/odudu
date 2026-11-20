# 0054 — The BFF keeps the tokens, and the browser keeps an id

**Status:** Accepted · 2026-11-20

## Context

A single-page app that signs in from the page holds its tokens where a script
can read them. RFC 10017 (BCP 212) names the backend for frontend (BFF) as the
pattern that keeps tokens out of the browser: a server component is the OAuth
client, the browser holds a cookie, and a stolen script can act as the person
only while the page is open. `@odudu-io/bff` is that component, built on
`Request` and `Response` so that framework adapters stay thin. The clauses it
answers are in `docs/protocols/rfc10017.md`.

## Decision

- **Cookie.** One cookie, `__Host-odudu`, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, no `Domain`, no `Max-Age`, holding a 256-bit
  random id and nothing else. A name that does not start with `__Host-` is
  refused when the BFF is made. `Lax` and not `Strict` because the sign-in
  returns from the issuer by a cross-site navigation that has to carry the
  login cookie; the CSRF rule below covers what `Strict` would.
- **Login binding.** `login` stores the PKCE verifier, state and nonce in a
  login record, kept ten minutes under a random id in a second cookie
  (`__Host-odudu-login`) with the same attributes. `callback` reads that
  record once, whatever the outcome, so a replayed or forged callback finds
  nothing. A callback that fails answers a fixed `400` and never repeats what
  the issuer or the query said.
- **A new id on every sign-in.** `callback` makes a fresh session id and never
  reuses one the browser sent, so a planted id is not adopted.
- **CSRF.** A route accepts one method. A `POST`, which is where state
  changes, requires the header `X-Odudu-BFF` (any value) and an `Origin` that
  is one of `allowedOrigins`, the origin of `redirectUri` by default;
  otherwise `403` with no body. A cross-origin page cannot add the header
  without a preflight the BFF never approves. `GET` changes nothing a person
  has signed in for. The one `GET` that writes is `login`, which stores a
  login record under a random id bound to its own cookie.
- **The check session route.** `session` answers `{ authenticated, claims }`
  with `Cache-Control: no-store` and never a token. A cookie that is not an id
  the BFF could have made, or names no record, is `{ authenticated: false }`
  with `200`, not an error.
- **Refresh.** The access token is renewed when it is within 30 seconds of
  expiry and a refresh token is held, through the OIDC core, authenticating as
  the confidential client. Concurrent reads of one session make one request: the
  core shares one request per refresh token, and a per-session guard in the BFF
  re-reads the stored session inside it, so a read that began before an earlier
  refresh finished does not present the refresh token that refresh replaced.
  When the issuer refuses the refresh, the session is deleted, the cookie is
  cleared and the answer is `401`. When the issuer cannot be reached the
  session stays and the answer is `503`.
- **Logout.** `POST` only. It deletes the session, clears the cookie and
  answers the issuer's RP-initiated logout address as `{ redirectTo }`, which
  the app navigates to; a session without an ID token, or an issuer that has no
  logout endpoint, answers `204`. With no session it is a `204` as well.
- **Store.** `SessionStore` is `get`, `set` with a time to live, and
  `delete`, over plain JSON records, so an app can back it with a database. The
  default is in-process: bounded at 10,000 records, evicting the one used
  longest ago, dropping a record idle for 30 minutes, with no timer. Without a
  store of the app's own, login records get a store of their own, so a flood of
  `login` requests cannot evict signed-in sessions. A session lives at most
  seven days (`sessionTtlMs`). Several instances need a shared store; the guide
  says so.
- **Confidential by default in the docs, optional in the type.** `clientSecret`
  is optional so development against a public client works. Without it the BFF
  is not the architecture the RFC describes, and the guide says that.
- **It stores no password and renders no form.**

### Why in-browser mode exists beside it

`@odudu-io/oidc` and `@odudu-io/react` also run PKCE in the page, with tokens
held in memory. A static site with no server, a demonstration and a tool that
runs from a file cannot have a BFF, and the RFC's browser-only pattern is the
pattern for them, with the risk it names: a script in the page can read the
tokens. The React package states that risk and recommends the BFF mode where a
server exists.

## Consequences

- An app that uses the BFF has a cookie and a server hop on every API call once
  the proxy is on; it gains tokens that cannot be read by a script.
- The default store forgets sessions when the process restarts and holds them
  per process. Both are the documented limit of the default, not a defect.
- A custom store inherits the refresh guard only per process. Two instances over
  one shared store can each refresh once; the issuer's reuse detection then
  refuses the second, and that session ends with `401`. The guide recommends one
  instance, or an affinity rule, until a store offers a lock.

## Alternatives rejected

**`SameSite=Strict`.** It breaks the login cookie on the issuer's redirect, and
splitting the two cookies would only move the weakness: the login cookie would
need `Lax` anyway.

**A signed cookie holding the session.** It spares the store, but the cookie
would carry the tokens, and the RFC's advice to encrypt it, and revocation by
session, would both be lost for a saving the in-process default already makes.

**A double-submit CSRF cookie.** It needs a second cookie and a script that
reads it. The custom header and `Origin` check need neither and fail closed.

**Putting login records in the session store.** A flood of `login` requests
would then evict signed-in sessions from a bounded store. A second store costs
one extra line and closes it.
