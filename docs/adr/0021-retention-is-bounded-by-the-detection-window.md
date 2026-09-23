# 0021 — Retention is bounded by the detection window, not by expiry

**Status:** Accepted · 2026-09-14

**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.

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
  (`docs/phases/p0-p1-p2a.md`, "Known limitations carried into P1"). Keycloak solves it with
  `ClusterAwareScheduledTaskRunner`; Odudu had no equivalent when this was
  written. The amendment below records the one it has now, and it is a
  Postgres advisory lock rather than a scheduler.

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

## Amendment, 2026-09-16 — the arithmetic

The decision has not changed. What follows is newly expressible, because
`odudu reap` (`apps/server/src/cli/reap.ts`) now exists to express it.

### The windows, and where they come from

Six numbers, read at the config boundary with the defaults below, each
bounded to between a minute and a year:

| Variable                                         | Default | Governs                                        |
| ------------------------------------------------ | ------- | ---------------------------------------------- |
| `ODUDU_RETENTION_GRANT_SECONDS`                  | 7 days  | a session-bound grant family                   |
| `ODUDU_RETENTION_OFFLINE_GRANT_SECONDS`          | 30 days | an offline family, which no session bounds     |
| `ODUDU_RETENTION_AUTHORIZATION_CODE_SECONDS`     | 1 hour  | a code that produced no grant                  |
| `ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS` | 1 hour  | `authentication_sessions`, expired or consumed |
| `ODUDU_RETENTION_ACTION_TOKEN_SECONDS`           | 7 days  | `action_tokens`, expired or consumed           |
| `ODUDU_RETENTION_SESSION_SECONDS`                | 1 day   | the grace past an SSO session's `expires_at`   |

`refresh_tokens` has no window of its own and cannot be given one: a
refresh token is retained for the life of the family, per decision 1 above.
`login_failures` has no window of its own either, for a different reason
given below.

### `token_grants.created_at` plus what, exactly

A family is past retention once **both** hold:

1. `created_at` is older than `greatest(window, tenants.sso_session_max_seconds)`,
   where `window` is the offline number for a grant with no `session_id` and
   the session-bound number otherwise. The `greatest` is the bound below
   that the Consequences above ask for: a window configured shorter than the
   session life the grant was issued under is not expressible, so an
   operator cannot shorten retention past the point where the grant itself
   is still usable.
2. No refresh token of the family is still usable — `used_at IS NULL AND
expires_at > now`. Without this a 30-day retention would kill a 90-day
   offline token a client legitimately holds, which is a retention pass
   revoking access rather than reclaiming space. It also makes the offline
   window a floor and never a ceiling on the credential's own life.

### Ordering, which is correctness and not throughput

`refresh_tokens` and `authorization_codes` are deleted **before**
`token_grants`, and `sessions` after it. Both directions are forced by
constraints that already exist:

- `refresh_tokens` carries `(tenant_id, grant_id) REFERENCES token_grants
ON DELETE CASCADE` (`packages/db/drizzle/0011_refresh_tokens.sql`).
  Deleting the grant first therefore deletes its tokens without the pass
  counting them, and reports zero for a table it had just emptied.
- `authorization_codes.grant_id` carries **no** foreign key, so nothing
  removes the row when its grant goes and an `EXISTS` against the departed
  grant is false for good. A code is therefore deletable once its own window
  has passed **and** its family is either absent, past retention, or was
  never created — the middle case is reachable on a legal configuration,
  since the code window accepts up to a year while the grant window defaults
  to a week.
- `sessions` is deletable only once **no** `token_grants` row references it
  — not merely no live one. The `ON DELETE SET NULL` on
  `token_grants.session_id` (`0026_token_grants_session.sql`) is a backstop
  the pass never reaches: nulling that column promotes a session-bound
  grant to an offline one, which is a privilege change disguised as a
  cleanup. Grants go first by their own window, so the session follows in
  the same pass once the last of them does.

The sequence is a single declaration (`REAP_ORDER`), each rule states the
tables it depends on, and the pass refuses to run at all — before its first
`DELETE` — if the two disagree.

### `login_failures`, which the retention table above never mentioned

The table arrived with per-account lockout (`0041_login_failures.sql`) after
this ADR was accepted, and it carries no `expires_at`. Its row is created by
a failure and removed by a success, so an abandoned attack leaves one
forever. It needs **two** bounds:

- `last_failure_at` older than the tenant's
  `brute_force_failure_reset_seconds`, from which point the arithmetic
  restarts from one whether the row exists or not, and
- `locked_until` passed.

The second does not follow from the first. `tenants_brute_force_bounds`
relates `max_lockout_seconds` to `lockout_seconds` and bounds
`failure_reset_seconds`, but relates neither of those to the other, so a
tenant locking for a day while forgetting failures after a minute is legal —
and there a pass keyed on the quiet period alone **deletes the row holding
the lock**, unlocking accounts on a schedule, silently, with no error
anywhere. Both bounds are per tenant and per row, read from the tenant in the
same statement as the delete, never a global age.

### One instance, every tenant

The pass runs in one transaction on the serving connection, which takes
`pg_try_advisory_xact_lock` as its first statement and then binds each
tenant's row-level-security context in turn (`withEachTenantExclusive`,
`packages/db/src/tx.ts`). Not `pg_advisory_lock`: that one is session-scoped
and would outlive the transaction on a pooled connection, so the pass would
run once and then silently never again. The transaction-scoped form releases
on commit and on rollback alike, so there is nothing to unlock. A replica
that loses the race is told so and skips the tick rather than retrying — the
holder is doing the same work concurrently.

Advisory locks are not tenant-scoped and structurally cannot be, so one key
means one instance reaps every tenant. That is what is wanted here; per-tenant
reaping would need a deliberate per-tenant key and nothing asks for one.

The pass refuses to run on the owner connection at all: `reap` requires
`ODUDU_APP_DATABASE_URL` in every environment, not only production, because
the owner must bypass row-level security for the enumeration below to work,
and a retention job that quietly ran with the policy switched off would be N
unscoped passes for N tenants rather than the property this section claims.

Listing the tenants to visit is the one read the pass makes on the owner
connection. `tenants_isolation` scopes that table by `app.tenant_id`, and the
tenant ids are what a tenant context would have to be built from, so the list
cannot be read from inside one — the same gap, and the same narrow bypass,
that ADR 0009's amendment of 2026-09-13 records for resolving `{tenant}` from
a request path. Every `DELETE` runs on the serving connection under a tenant
context, and none of them carries a `tenant_id` predicate of its own: the
policy is the scoping, and an integration case asserts that a pass over one
tenant leaves another tenant's eligible rows untouched.

Both halves of that are asserted rather than assumed, against `pg_roles`:
the listing role must be `SUPERUSER` or hold `BYPASSRLS`, because `tenants`
carries `FORCE ROW LEVEL SECURITY` and a role without the escape reads zero
tenants and would reap none of them without a word — and the serving role
must be **neither**, because a serving role that escapes the policy runs
every `DELETE` unscoped while `app.tenant_id` is bound, which is this
section's claim failing by configuration rather than by code. Both refuse
rather than warn. An enumeration that then comes back empty
is reported as "no tenant was enumerated" and not as a pass that found
nothing to do.

### `email_outbox`

The retention table above lists it; the table does not exist yet. When its
migration lands, its name joins `TableName`, which does not compile until
`RETENTION_RULES` has a rule for it and does not run until `REAP_ORDER` has
a place for it. Until then, a standing integration case fails the build for
any table carrying a lifecycle timestamp — `sent_at` and `failed_at`
included — that has neither a rule nor a stated reason for having none.

## Amendment, 2026-09-16 — the server does run it

One consequence above says "the reaper is a background writer, which the
server does not have today". That is no longer true. The server schedules
the pass itself, hourly by default, and
[ADR 0024](0024-a-scheduled-pass-is-a-command-first.md) carries the shape:
the pass stays exactly what this ADR describes — a command, taking its
`now` as an argument — and the loop that calls it holds no logic and takes
no lock of its own, because `withEachTenantExclusive` already holds the one
this document's amendment named. `ODUDU_REAP_ENABLED=false` returns a
deployment to the external cron entry this ADR assumed.

Nothing in the decision or in the windows changes. What changes is that a
deployment which schedules nothing is no longer a deployment that retains
everything for ever.
