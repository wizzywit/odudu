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
  otherwise `403` with no body. The `session` read and every proxied call
  require the header too (RFC 10017 section 6.1.3.3.2), and an allowed `Origin`
  when the browser sends one; a script in the app adds the header, a
  cross-origin page cannot without a preflight the BFF never approves. `login`
  and `callback` are browser navigations, which cannot add a header, so they
  are exempt, and the row for that MUST is `accepted:`. `login` writes only a
  login record under a random id bound to its own cookie.
- **The check session route.** `session` answers `{ authenticated, claims }`
  with `Cache-Control: no-store` and never a token. A session whose tokens
  expired with no refresh token to renew them is ended as a refused refresh
  is, here and on the proxy. A cookie that is not an id
  the BFF could have made, or names no record, is `{ authenticated: false }`
  with `200`, not an error.
- **Refresh.** The access token is renewed when it is within 30 seconds of
  expiry and a refresh token is held, through the OIDC core, authenticating as
  the confidential client. Concurrent reads of one session make one request: the
  core shares one request per refresh token, and a per-session guard in the BFF
  re-reads the stored session inside it, so a read that began before an earlier
  refresh finished does not present the refresh token that refresh replaced.
  Only `invalid_grant` ends the session: the cookie is cleared, the record is
  deleted and the answer is `401`. Every other failure (a refused client
  secret, a malformed request, an unreachable issuer, a code nobody knows)
  keeps the session and answers `503` with `Retry-After`, so a rotated secret
  or an outage signs nobody out. A refresh that finishes after a logout does
  not write the session back; the answer is `{ authenticated: false }`.
- **Logout.** `POST` only. It deletes the session, clears the cookie and
  answers `{ redirectTo }`, the issuer's RP-initiated logout address, which the
  app navigates to. The address carries `client_id` and the configured
  `post_logout_redirect_uri` and **no `id_token_hint`**: the ID token never
  leaves the server, so no token of any kind reaches the browser. The server
  accepts this form: it resolves the client from `client_id` alone
  (`packages/protocol-oidc/src/usecase/logout.ts:252-262`), skips its
  confirmation page only for a valid hint (`logout.ts:71-85`, so without one the
  person is asked), and honours a registered `post_logout_redirect_uri` after
  the confirmation (`logout.ts:47-55`; ADR 0047). The cost is the page ADR 0047
  makes the default. A session with no logout endpoint at the issuer, or with
  no session at all, answers `204`.
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
- **The proxy.** `proxy` calls an allowlisted upstream with the session's
  access token, mounted at `proxyPath` (`/proxy`) as `/proxy/<name>/<path>`.
  - _Allowlist._ An `Upstream` is a `name`, an exact `origin` and `pathPrefixes`,
    and optionally `methods` (default `GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
    and a `resource`, the audience whose token is sent (the issuer's own when
    omitted; the sign-in asks for it through the BFF's `resource` option, and an
    audience the sign-in did not carry answers `502`). No upstream, and every
    call answers `404`. An unknown `name` is `404`, a path outside the prefixes
    `403`, a method outside the list `405` with `Allow`.
  - _SSRF._ The host never comes from the request: the target is the
    configured origin plus the path, and is checked to still name that origin.
    The path is checked as it will be sent, on whole segments: a dot or empty
    segment, a backslash, a semicolon, a control or non-ASCII character, an
    escaped dot, slash, backslash, percent sign or NUL, and a malformed escape
    are `403`. Escaped percent signs are refused so a second decoding upstream
    cannot make a dot of one. The cost is a literal `%2f` in a path.
  - _Header on every call._ Every proxied request needs `X-Odudu-BFF`, a `GET`
    included (RFC 10017 section 6.1.3.3.2), and an `Origin` among
    `allowedOrigins` when the browser sends one; a method that can change state
    must send one. Without a session the answer is `401` with
    `{ authenticated: false }`; a refused refresh ends the session as `session` does, `401` and
    the cookie cleared.
  - _What crosses._ The upstream request loses the cookie, `host`, `origin`,
    the BFF header, any `Authorization` the browser sent and every hop-by-hop
    header, with any header `Connection` names, and gains an
    `Authorization: Bearer` header holding the token. The answer loses `Set-Cookie`, because an upstream's cookie
    belongs to the upstream and not to this origin, and the hop-by-hop headers.
    Compression is declined upstream (`Accept-Encoding: identity`) because the
    client library decodes, and an answer that arrives encoded anyway loses
    `Content-Encoding` and `Content-Length`.
  - _Redirects._ An upstream `3xx` is returned as it is and never followed,
    `Location` unchanged: following it would call a host nobody allowlisted.
    The app sees the redirect and decides. An upstream `401` is returned as it
    is; the one refresh happens before the call, not after a refusal.
  - _Bodies and time._ Request and response bodies stream, one chunk in memory
    at a time, counted against `maxBodyBytes` (10 MiB). A request that
    declares more answers `413` before anything goes upstream; one that
    outgrows it while streaming answers `413` and no byte past the limit is
    sent, though the upstream may have received the earlier ones. A response
    that declares more is `502`; one that outgrows it mid-stream is cut, so the
    browser's connection errors rather than ending as if complete.
    `upstreamTimeoutMs` (30 s) bounds the wait for the upstream to start
    answering (`504`); a body then streams for as long as it takes, within the
    limit. An upstream that cannot be reached is `502`.
  - _Refresh._ The proxy asks the same session access as `session`, so a burst
    of proxied calls near expiry spends one refresh.
- **Framework adapters.** `@odudu-io/bff/fastify` (`registerBff`) and
  `@odudu-io/bff/express` (`bffRouter`) mount `login`, `callback`, `logout` and
  `session` at an optional `prefix`, and the proxy at `proxyPath`, answering
  every method Fastify supports, so the handler's own `405` reaches the browser. They hand the
  socket's stream to the handler unparsed (Fastify answers from `onRequest`;
  Express's router must come before a body parser) and write every
  `Set-Cookie` line and the body as it streams. Fastify 5 and Express 5 are
  optional peers.
- **It stores no password and renders no form.**

### Why in-browser mode exists beside it

`@odudu-io/oidc` and `@odudu-io/react` also run PKCE in the page, with tokens
held in memory. A static site with no server, a demonstration and a tool that
runs from a file cannot have a BFF, and the RFC's browser-only pattern is the
pattern for them, with the risk it names: a script in the page can read the
tokens. The React package states that risk and recommends the BFF mode where a
server exists.

## Consequences

- An app that uses the BFF has a cookie and a server hop on every API call when
  it uses the proxy; it gains tokens that cannot be read by a script.
- The proxy's cost per call is one upstream request and, at expiry, one shared
  refresh; it reads the allowlist in time linear in the number of upstreams and
  holds one body chunk in memory.
- The default store forgets sessions when the process restarts and holds them
  per process. Both are the documented limit of the default, not a defect.
- A custom store inherits the refresh guard only per process. Two instances over
  one shared store can each refresh once; the issuer's reuse detection then
  refuses the second, and that session ends with `401`. The guide recommends one
  instance, or an affinity rule, until a store offers a lock.
- The default store is a per-process registry on `globalThis` in
  `@odudu-io/next`: a Next build gives each route and page its own copy of a
  module, so a store made at load would be several. It is lost on restart and
  not shared across processes or serverless instances; the SDK emits one
  `ODUDU_NEXT_DEFAULT_STORE` warning per production process, and an app that
  runs more than one passes its own `store`.
- `getSession` in `@odudu-io/next` only reads the store: it never refreshes,
  deletes or writes. A single Next process has several module graphs, each with
  its own in-flight refresh guard, so a refresh from a render could spend a
  rotating refresh token twice and end the session; refreshing stays with the
  route handlers and the proxy. A session whose tokens ran out for good reads as
  none; a stale access token with a live session still returns the claims.
- `@odudu-io/bff/shared` is the one supported way for a framework binding to
  share the BFF's rules (cookie, session id and store key, custom header, mount
  and local path checks, when a session is over) instead of copying them.

## Alternatives rejected

**`SameSite=Strict`.** It breaks the login cookie on the issuer's redirect, and
splitting the two cookies would only move the weakness: the login cookie would
need `Lax` anyway.

**A signed cookie holding the session.** It spares the store, but the cookie
would carry the tokens, and the RFC's advice to encrypt it, and revocation by
session, would both be lost for a saving the in-process default already makes.

**A double-submit CSRF cookie.** It needs a second cookie and a script that
reads it. The custom header and `Origin` check need neither and fail closed.

**Following upstream redirects.** A redirect can name any host, so following one
turns an allowlist of origins into whatever an upstream chooses to point at.

**A `host` taken from the request or a path-and-host URL.** It makes every
parsing difference between the check and the call a way out; the origin comes
from the configuration and only a checked path is appended.

**Putting login records in the session store.** A flood of `login` requests
would then evict signed-in sessions from a bounded store. A second store costs
one extra line and closes it.
