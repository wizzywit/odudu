# 0021 — Retention is bounded by the detection window, not by expiry

**Status:** Accepted · 2026-09-14

## Context

Four tables carry `expires_at`: `sessions`, `authentication_sessions`,
`authorization_codes`, `refresh_tokens`. Expiry is enforced at read time —
`WHERE … AND expires_at > now()` in the consuming statement, plus explicit
checks in the use cases — so an expired row can never be redeemed. What
does not exist anywhere in the repository layer is a `DELETE`. Nothing is
ever removed.

The growth is on the hot path. P1 never reuses a session, so every
`/authorize` request writes an `authentication_sessions` row, abandoned or
completed, carrying `client_id`, `redirect_uri`, `scope`, `state`, `nonce`
and `code_challenge`. Every login writes an `authorization_codes` row that
is dead after 60 seconds. Every refresh rotation writes a `refresh_tokens`
row — roughly 288 per session per day for a client refreshing every five
minutes.

**The obvious fix is wrong, and wrong silently.** `DELETE FROM … WHERE
expires_at < now()` breaks reuse detection. `rotateRefreshToken`
(`packages/protocol-oidc/src/usecase/refresh-rotation.ts`) distinguishes
reuse from an unknown token by reading the already-used row back through
`refreshTokenRepository.byHash`; delete that row and the replay returns
`{ kind: 'unknown' }` instead of `{ kind: 'reused' }`. The client sees the
same `invalid_grant` either way — RFC 6749 §5.2 requires exactly that — so
nothing observable changes, and family revocation simply stops happening.
The consumed `authorization_codes` row is the same shape: it is what RFC
6749 §4.1.2's "If an authorization code is used more than once, the
authorization server MUST deny the request and SHOULD revoke (when
possible) all tokens previously issued based on that authorization code"
is reached through.

### What the specifications actually say

`verified:` read in full — `https://www.rfc-editor.org/rfc/rfc9700.txt`,
`https://www.ietf.org/archive/id/draft-ietf-oauth-v2-1-13.txt`,
`https://www.rfc-editor.org/rfc/rfc6749.txt`,
`https://openid.net/specs/openid-connect-core-1_0.html` and
`https://openid.net/specs/openid-connect-session-1_0.html`.

**No OAuth or OpenID Connect specification mandates a retention or deletion
policy.** `grep -ci` over RFC 9700 and `draft-ietf-oauth-v2-1-13` returns
**0** for "retention", "purge" and every form of "delete"; OIDC Core and
OIDC Session Management return 0 for all three, and OIDC Core's three uses
of "retain" are about decommissioned signing keys at `jwks_uri`, not about
records. Storage is an implementation concern and the specifications say so
by silence. There is no standards hook here and none is manufactured.

What they do constrain is **how early deletion may happen**, through
detection obligations:

- RFC 6749 §4.1.2, verbatim: "If an authorization code is used more than
  once, the authorization server MUST deny the request and SHOULD revoke
  (when possible) all tokens previously issued based on that authorization
  code." §10.5: "The authorization server MUST ensure the authorization
  code cannot be used more than once."
- `draft-ietf-oauth-v2-1-13` §4.1.3, verbatim: "The authorization server
  MUST return an access token only once for a given authorization code. If
  a second valid token request is made with the same authorization code as
  a previously successful token request, the authorization server MUST deny
  the request and SHOULD revoke (when possible) all access tokens and
  refresh tokens previously issued based on that authorization code."
- RFC 9700 §4.14.2, verbatim: "Authorization servers MUST utilize one of
  these methods to detect refresh token replay by malicious actors for
  public clients" — sender-constrained refresh tokens, or "_Refresh token
  rotation:_ the authorization server issues a new refresh token with every
  access token refresh response. The previous refresh token is invalidated,
  but information about the relationship is retained by the authorization
  server." `draft-ietf-oauth-v2-1-13` §4.3.1 carries the same paragraph
  nearly word for word.

That clause — "information about the relationship is retained" — is the
only sentence in any of these documents that touches retention at all, and
it obliges keeping something rather than removing it. It does not say for
how long.

### What Keycloak does

`verified:` read from Keycloak's own sources and documentation, `main`
branch, September 2026.

**Authentication sessions are cache entries, not rows, and they are
destroyed on completion.** `docs/guides/server/caching.adoc` lists
`authenticationSessions` as a _Distributed_ cache and says they are
"created/destroyed/expired during the authentication process" and
"automatically destroyed once the authentication process completes or due
to reaching their expiration time". The newer JPA-backed provider
(`model/jpa/src/main/java/org/keycloak/authentication/jpa/JpaAuthenticationSessionProvider.java`)
deletes lazily on read: `getRootAuthenticationSession` calls
`em.remove(entity)` when `entity.getTimestamp() + lifespan <
Time.currentTimeSeconds()`. Keycloak also writes far fewer of them than
Odudu does — the root authentication session is addressed by the browser's
`AUTH_SESSION_ID`, so repeated `/authorize` requests from one browser
reuse one root row, with `authSessionsLimit` capping the per-tab children.

**Consumed authorization codes leave no tombstone at all, and Keycloak
still revokes on replay.** `OAuth2CodeParser.persistCode` puts the code
into a single-use store with a TTL of the realm's `accessCodeLifespan`, and
`parseCode` _removes_ it on redemption
(`codeStore.remove(CACHE_KEY_PREFIX + codeUUID)`). A second presentation
finds `codeData == null` and cannot tell "already used" from "expired" from
"never existed" — all three become `illegalCode()`. It can revoke anyway
because **the code string itself carries the family**: the value handed to
the client is `key + "." + clientSession.getUserSession().getId() + "." +
clientSession.getClient().getId()`, so
`AuthorizationCodeGrantType.create` detaches the client session from the
user session on any illegal code, using an identifier parsed out of the
presented credential rather than read from a stored row.

**Refresh-token reuse detection stores constant-size state on the client
session, not a row per token.** `TokenManager.validateTokenReuse`
(`services/src/main/java/org/keycloak/protocol/oidc/TokenManager.java`)
compares the presented token's `jti` and `iat` against
`clientSession.getRefreshToken(key)`,
`clientSession.getLatestGeneratedRefreshToken(key)` and
`getRefreshTokenLastRefresh(key)`, and refuses with `invalid_grant` "Stale
token"; `getRefreshTokenUseCount` against the realm's
`refreshTokenMaxReuse` is the separate reuse budget. Nothing accumulates
per rotation, and the detection state dies with the session it lives on.
This is genuinely better than a row-per-token design on growth, and it is
worth saying so rather than pretending otherwise.

**Periodic cleanup exists, and is being retired in favour of providers
reaping their own.** `DefaultDatastoreProviderFactory` schedules
`ClearExpiredEvents`, `ClearExpiredAdminEvents`,
`ClearExpiredClientInitialAccessTokens`, `ClearExpiredUserSessions` and
`ClearExpiredIssuedVerifiableCredentials` through
`ClusterAwareScheduledTaskRunner`, at `Config.scope("scheduled").getLong(
"interval", 900L) * 1000` — a default of **900 seconds**, cluster-aware so
one node runs each pass. `ClearExpiredUserSessions` is annotated
`@Deprecated(since = "26.5", forRemoval = true)` with "to be removed
without replacement. The providers are responsible for purging the expired
entries themselves", and `docs/documentation/upgrading/topics/changes/changes-26_5_0.adoc`
confirms it: "As `AuthenticationSessionProvider` and `UserSessionProvider`
now have an internal mechanism to delete expired entries, the scheduled
task `ClearExpiredUserSessions` has been deprecated."

`assumption:` — the exact storage location of user and offline sessions has
moved across recent Keycloak releases (persistent user sessions, caches
described in `caching.adoc` as "Cache persisted user session data" over a
database). Nothing in this ADR depends on which release does which; the
claims above are read from `main`.

## Decision

**Retention is a stated window per table, derived from the detection
obligation that reads the row, and it is longer than the row's own
`expires_at`.** P2b owns it, alongside the session idle and maximum
lifespans it already owns.

1. **A row may be deleted only once no detection can still need it.** For
   `refresh_tokens` and `authorization_codes` that is the life of the
   **grant family**, not the life of the credential: a refresh token's TTL
   may be minutes while the family lives for weeks, and a replay is
   evidence of compromise whenever it arrives. The deletion predicate is
   therefore written against the grant's terminal state, not against
   `expires_at`.
2. **The reaper's correctness is a test, not a comment.** A deletion that
   breaks reuse detection must turn a suite red. The assertion shape is:
   rotate a refresh token, run the reaper, replay the consumed token, and
   assert the family is revoked — not merely that the request was refused,
   because refusal is what the broken implementation also produces. The
   same for a consumed authorization code against its grant. This repo's
   standing rule is that a rule nothing checks is not a rule.
3. **Where deletion is safe, delete rather than tombstone.**
   `authentication_sessions` carries no family revocation — a replayed
   `consumed_at` row is refused and nothing else follows from it — so it
   has the shortest window of the four and is deleted outright, which is
   also where almost all the volume is.
4. **Data protection is a first-class reason, independent of the specs.**
   `authentication_sessions.pending_request` is a durable record of which
   subject's browser asked for which client and scope. Keeping it for no
   stated period is the problem; a stated period is the fix, and it is a
   reason to delete that no OAuth document supplies.

## Consequences

- P2b's exit criterion grows a clause and its estimate moves from 70–100
  to 80–110 hours.
- Two numbers per table have to be configured and defended rather than
  one — a lifespan and a retention window — and an operator can set the
  second too short. Bounding it below by the grant's own lifetime in the
  same place that computes it is what stops that being an unrecorded
  choice.
- Reuse detection keeps working for the whole window in which a stolen
  credential could plausibly be replayed, and stops working after it. That
  ceiling is real and is accepted: a replay arriving after the family is
  long dead has nothing left to revoke.
- The reaper is a background writer, which the server does not have today.
  Whatever runs it must be safe under the multiple replicas P11 promises —
  the same problem the migration runner's missing advisory lock already has
  (`docs/NEXT.md`, "Known limitations"). Keycloak solves it with
  `ClusterAwareScheduledTaskRunner`; Odudu has no equivalent yet.

## Alternatives rejected

- **`DELETE … WHERE expires_at < now()`.** The naive reaper. It disables
  refresh-token family revocation and authorization-code grant revocation
  while leaving every existing test green and every client-visible response
  byte-identical. This is the trap the ADR exists to name.
- **Keep deleting nothing.** Correct today, and defensible only while the
  deployment is small. It is unbounded growth on the busiest endpoints and
  an unstated retention period for login metadata, which is a data
  protection answer nobody can give.
- **Carry the family identifier inside the credential, as Keycloak does,
  and delete the row on redemption.** Genuinely elegant — it removes the
  tension entirely, because revocation needs nothing but the presented
  string. Rejected for Odudu because the credential is currently an opaque
  random value stored as a hash, and structuring it would put the grant id
  and client id into a string handed to user agents and logged by proxies,
  and would make the credential's format a compatibility surface. Worth
  reopening if the growth turns out to dominate.
- **Mark rows `revoked` and keep them forever instead of deleting.** A
  tombstone is what the detection needs, but an unbounded tombstone is the
  status quo with an extra column: the same growth, the same unstated
  retention of `pending_request` and `redirect_uri`. A tombstone is only an
  answer when it is narrower than the row it replaces and is itself reaped.
