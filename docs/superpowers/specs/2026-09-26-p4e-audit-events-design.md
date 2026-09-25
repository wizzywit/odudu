# P4e — Authentication and token audit events

**Date:** 2026-09-26
**Status:** Draft
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

P4c built `audit_events` and wrote one kind of row into it, `admin_mutation`.
This phase writes the rest: what happened when somebody logged in, answered a
second factor, changed a credential, was issued, refreshed, exchanged or
revoked a token, and when a session began or ended. The table was shaped for
these rows from its first migration — a nullable actor, an `event_type` — so
the phase adds rows and a filter, not a schema.

Three items ride with it because the umbrella's criterion names them:

- ADR 0036's follow-up: `requested_userinfo_claims` threaded onto
  `token_grants`, so a refresh no longer widens what `/userinfo` returns.
- The cross-tenant issuer refusal P4c reverted, given an answer.
- NEXT.md's open question of whether P4c's "only the ceilings record a
  refusal" generalises.

## 2. Scope, as brainstormed on 2026-09-26

The §11 criterion names login attempts, second factors, tokens and sessions.
**Credential lifecycle is added**: registration, email verification,
password reset, password change, TOTP and passkey enrolment, and a fresh set
of recovery codes. The criterion did not list them, but they are inside the
phase's topic — an authentication audit that records a login and not the
password reset that preceded it is missing the event an investigator asks
for first — and CLAUDE.md decides ownership by topic, not by the brief. Each
is one `record` call in a transaction that already exists. §11's row is
amended to name them, and the estimate moves from 35–55 hours to 40–60.

Out of scope, and placed:

- A console view of these events — **P4d**, whose criterion already shows
  the audit trail.
- Streaming events to an external sink (SIEM, webhook) — **P10**. Umbrella
  §8 names `EventListener` among the registries P10 opens to third-party
  providers; nothing implements one today, and P10's criterion does not
  name it, so the phase-close pass amends that criterion (§13).
- `/introspect` and `/userinfo` calls — not audited, deliberately. Each is a
  read a resource server makes per request, it issues and changes nothing,
  and the grant it reads was audited when it was issued. Keycloak does not
  save `INTROSPECT_TOKEN` by default for the same reason.

## 3. Decisions

1. **A new `@odudu/domain-audit` package owns the table and the writer.**
   Rejected: moving it into `@odudu/db` (infrastructure acquiring a domain
   table and no home for the vocabulary), and an injected `AuditSink` port
   (wiring on every use case, and P4c's "mechanism with no caller" defect
   waiting in every fake).
2. **A closed vocabulary**, one typed union of `(event_type, action)` pairs.
3. **Success rows are written in the transaction that did the work**, P4c's
   rule unchanged.
4. **Refusal rows are written only where the principal they name is
   bounded** — ADR 0037. Unbounded refusals go to a structured `warn` line.
5. **An audit write never changes a response.**
6. **An attempted username is never recorded.**
7. **A foreign-issuer admin token is verified before it is recorded.**
8. **`requested_userinfo_claims` lives on the grant row**, and migration
   `0070` fixes `token_grants_session_fk` in passing.

## 4. The package

`packages/domain-audit`, laid out as `packages/domain-authz` is, depending
on `@odudu/db` and `@odudu/kernel`:

- `src/schema/audit-events.ts` — moved from `protocol-admin` unchanged. No
  migration: the table stays where it is and only its Drizzle declaration
  moves. `packages/db/tests/schema-drift.int.test.ts` discovers schemas on
  disk, so it follows the file.
- `src/repository/audit.ts` — `auditRepository(tx)`, `record` and `list`,
  moved. `list` gains `eventType`.
- `src/service/vocabulary.ts` — the union in §5, the per-action `detail`
  allowlist in §6, and the reason codes.
- `src/index.ts` — the one export surface.

`protocol-admin` keeps `usecase/audit.ts` (cursor and wire mapping) and its
`recordAudit` wrapper, now calling the moved repository.
`.dependency-cruiser.cjs` needs no rule: `domain-audit` matches the existing
`domain-[^/]+` patterns, so it may not import a protocol package or
`authn-flows`, and anything may import it.

## 5. Vocabulary

| `event_type`     | `action`                       | Written by                                                                 |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `admin_mutation` | unchanged                      | `protocol-admin`                                                           |
| `admin_access`   | `capability.refused`           | `protocol-admin`, a `403` to an authenticated caller                       |
|                  | `token.foreign_issuer`         | `protocol-admin`, §9                                                       |
| `authentication` | `login.password`               | `authn-flows` executor, every attempt                                      |
|                  | `login.otp`                    | every answer                                                               |
|                  | `login.recovery_code`          | every answer                                                               |
|                  | `login.passkey`                | every answer                                                               |
|                  | `factor.offered`               | a second factor challenged after a first succeeds                          |
|                  | `lockout.tripped`              | the attempt whose failure sets `locked_until`                              |
|                  | `client.authenticate`          | `protocol-oidc`, `/token` and `/revoke` refusals only                      |
| `session`        | `session.created`              | `completeLogin`                                                            |
|                  | `session.ended`                | `endSession` and admission, `detail.via`: `logout` \| `admin` \| `evicted` |
| `token`          | `token.issue`                  | `/token`, `detail.grant_type`                                              |
|                  | `token.refresh`                | refresh rotation                                                           |
|                  | `token.exchange`               | `detail.mode`: `delegation` \| `impersonation`                             |
|                  | `token.revoke`                 | `/revoke`                                                                  |
|                  | `grant.revoked_on_reuse`       | refresh-token reuse detection                                              |
|                  | `grant.revoked_on_code_replay` | authorization-code replay                                                  |
| `credential`     | `account.registered`           | `account` registration                                                     |
|                  | `email.verified`               | `account` verification                                                     |
|                  | `password.reset`               | `account` reset completion                                                 |
|                  | `password.changed`             | `authn-flows` update-password                                              |
|                  | `otp.enrolled`                 | `authn-flows` TOTP enrolment                                               |
|                  | `passkey.enrolled`             | `authn-flows` passkey enrolment                                            |
|                  | `recovery_codes.issued`        | `authn-flows` `beginRecoveryCodes`                                         |

A successful login writes its step rows and `session.created`; there is no
separate "login completed" row, because a session created is what a
completed login is. A client's `client_credentials` grant writes
`token.issue` with no subject.

An admin ending a session writes its existing `admin_mutation` row and,
through `endSession`, a `session.ended` row with `via: admin` — so the
session view is complete whoever ended it, and the admin view is unchanged.

### Columns on these rows

- `actor_subject_id` — the subject the event happened to. Null for an
  unknown username and for `client_credentials`.
- `actor_client_id` — the client involved, where there is one.
- `actor_tenant_id` — the row's own tenant, except on `token.foreign_issuer`,
  where it is the issuing tenant.
- `resource_type`/`resource_id` — `grant` for token events,
  `session` for session events, `authentication_session` for login steps,
  `subject` for credential events.
- `outcome` — `allowed`, or `refused` with `detail.reason`. `failed` stays
  reserved for a server fault, as P4c defined it.
- `request_id`, `ip` — filled on every row this phase writes, admin rows
  included, which have never had them. They reach the row the way
  `tenant_id` already does: `withTenant` takes an optional request context
  and binds `app.request_id` and `app.client_ip` with `set_config(…, true)`,
  and migration `0069_audit_request_context.sql` defaults both columns from
  those settings. So a writer threads nothing but the context to the
  transaction it opens, and `ip` comes from `request.ip` alone, which
  `ODUDU_TRUST_PROXY` already governs.

## 6. What a row may carry

`detail` is allowlisted per action in `vocabulary.ts`, as P4c's admin diff
is allowlisted per resource type. Nothing outside the allowlist can reach
the column: `record`'s input type for each action admits only its own keys.

A row never carries a password, a client secret, an authorization code, a
refresh or access token, a client assertion, a TOTP or recovery code, a
WebAuthn assertion, or an **attempted username**. The last is decided, not
overlooked: people type passwords into the username field often enough that
recording what was typed there eventually records a password, and OWASP's
logging guidance forbids logging one. A refused login for an unknown
account records `reason: unknown_subject`, the IP and the request id —
enough to see spraying and stuffing, which is what the row is for.

Reasons: `unknown_subject`, `bad_credential`, `locked_out`, `replayed`,
`already_used`, `subject_mismatch`, `invalid_grant`, `invalid_scope`,
`invalid_target`, `unauthorized_client`, `rate_limited`, `foreign_issuer`,
`missing_capability`. The response a caller sees does not change: a wrong
password, an unknown account and a locked account still answer identically.
The row distinguishes them and only `view-audit` reads it.

## 7. When a row is written

### Successes: in the transaction that did the work

- Login steps: inside `advance`'s `withTenant`. It commits on a **returned**
  failure, so a failed attempt's row lands beside its `login_failures`
  write.
- `session.created`: inside `completeLogin`. Eviction rows: inside
  `admitSession`, same transaction. `session.ended`: inside `endSession`.
- `token.issue`, `token.exchange`: inside `/token`'s `withTenant`.
- `token.refresh`, `grant.revoked_on_reuse`: inside rotation's own sibling
  transaction, which exists already so reuse detection survives the
  refusal's rollback.
- `grant.revoked_on_code_replay`: inside `redeemAuthorizationCode`'s sibling
  revoke transaction, for the same reason.
- `token.revoke`: inside `/revoke`'s `withTenant`.
- Credential events: inside the transaction that writes the credential.

### Refusals at `/token` and `/revoke`: in a sibling transaction

Both endpoints refuse by throwing, so their transaction rolls back and a row
written in it disappears. `TokenError` gains an optional `audit` annotation
— action, reason, client db id, subject id, grant id — set only at the
refusal sites §8 permits to write. The route's `catch` opens its own
`withTenant` and records it, the pattern `redeemAuthorizationCode` already
uses for its revoke.

### An audit write never changes a response

A throw while recording a **refusal** is caught and logged at `error`; the
caller gets the refusal it was always going to get. P4c reverted its
cross-tenant audit partly because a throw there turned a `401` into a `500`.

A success row is different, and deliberately so: it is in the transaction
that did the work, so a failure to write it fails the work. An issued token
with no record of its issue is the disagreement between audit and database
P4c's first property exists to prevent.

## 8. Which refusals write a row (ADR 0037)

OWASP's logging guidance and ASVS 5.0 V16 both require every authentication
decision to be logged, failures included; the same OWASP guidance requires
that logging cannot be used to exhaust resources. The two are reconciled by
what the refused request **names**:

| Refusal                                                                  | Row                     | What bounds it                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Login failure — bad credential, locked out, unknown subject              | yes                     | the per-IP throttle on `login-actions/authenticate` (`THROTTLED_POSTS`), the bound `login_failures` already sits behind |
| Client authentication failure naming a **registered** client, any method | yes, while under budget | `auditRefusalBudget`, below                                                                                             |
| Client authentication failure naming an **unregistered** `client_id`     | no — `warn` line        | nothing needed: no row                                                                                                  |
| Refusal after the client authenticated                                   | yes                     | the client is authenticated, and the row names it                                                                       |
| Admin `401`                                                              | no — `warn` line        | nothing needed                                                                                                          |
| Admin `403` to an authenticated caller                                   | yes                     | the caller is authenticated, and the row names it                                                                       |
| Foreign-issuer admin token, signature valid                              | yes                     | the caller holds a genuine token, and the row names its subject                                                         |
| Foreign-issuer admin token, forged or issuer not served here             | no — `warn` line        | nothing needed                                                                                                          |

`auditRefusalBudget` is an in-memory sliding window — the same
`slidingWindow` helper as the client secret limiter — keyed on
`(tenant, client)`. It is separate from that limiter because the limiter
applies to password methods only, and making `private_key_jwt` or
`tls_client_auth` failures count against it would turn a `400` into a `429`:
a response change. The budget changes no response. It decides only whether
a refusal is a row or a log line. When it trips, one `client.authenticate`
row with `reason: rate_limited` is written; further refusals in the window
are `warn` lines.

Being in-memory, the budget is per replica, so N replicas admit N times the
window. Acceptable while Odudu is single-replica, and **P11**, which brings
multi-replica deployment, owns making it shared alongside the other
per-process limiters.

Keycloak saves refresh events off by default, as high-volume. This phase
writes `token.refresh` anyway, because the criterion names it and retention
bounds it; `README.md` records that refresh rows dominate the table's
growth, so an operator sizing `audit_retention_days` knows which knob moves
it.

## 9. The cross-tenant issuer refusal

A bearer token at `/admin/tenants/Y/…` naming an issuer that is neither Y's
nor the system tenant's is refused before its signature is checked, because
there were no keys to check it against. P4c recorded it as a gap whose real
obstacle was resolving that issuer first.

`authenticateAdmin`'s `issuer_mismatch` branch now:

1. Parses the unverified `iss` against this deployment's issuer shape — the
   same request-derived base the admin door already computes, with
   `/tenants/{name}` after it. Anything else is a `warn` line.
2. Looks up that tenant. Absent or disabled: a `warn` line.
3. Verifies the token against that tenant's publishable keys, with the
   admin audience and `typ` the door already requires. Invalid: a `warn`
   line.
4. Valid: records `admin_access`/`token.foreign_issuer`, `refused`, into
   **Y**'s audit trail — the tenant the attempt happened to, P4c's rule for
   `tenant_id` — with `actor_tenant_id` X, `actor_subject_id` the token's
   `sub`, and `actor_client_id` from its grant.

The response is the same `401` in every case, so the new branch is no
oracle. The record is written in its own `withTenant` for Y, and a throw
there is caught per §7.

## 10. `requested_userinfo_claims` on the grant

Migration `0070_grant_userinfo_claims.sql` (`0069` is §5's request
context, which lands first):

- adds `token_grants.requested_userinfo_claims text[]`, nullable;
- replaces `token_grants_session_fk`'s unrestricted `ON DELETE SET NULL`
  with `ON DELETE SET NULL (session_id)`. The unrestricted form nulls both
  columns of the composite key, `tenant_id` included, so the delete it was
  meant to survive fails on `NOT NULL` instead. P4a fixed the same idiom in
  `0059`; NEXT.md's trigger for this one is "the next migration touching
  `token_grants`", and this is it.

Written when the authorization-code grant creates the row, from
`code.claims.userinfo`'s keys. Read by the refresh grant — rotation reuses
the grant row, so the value is already on it — and passed to
`mintAccessToken`. A token exchange whose subject token is grant-backed
inherits it, so exchanging can narrow and never widen. `client_credentials`
writes none.

The test is ADR 0036's own throwaway reproduction made permanent:
`claims={"userinfo":{"sub":null}}` with `scope=openid email` returns `{sub}`
from `/userinfo` after the code redemption **and after a refresh**. ADR
0036 gains an amendment recording that its follow-up is closed.

## 11. The admin API

`GET /admin/tenants/{tenant}/audit` gains `event_type`, validated as an enum
of §5's event types; the OpenAPI document and `docs/admin-paths.md` follow.
No other filter changes. The capability matrix's invariants are unaffected:
the route is unchanged.

## 12. Testing

Each rule below answers a failure shape `docs/phases/p4c.md` recorded.

- **Every row is proven by driving the door a user reaches** — an HTTP
  login, `/token`, `/revoke`, `/logout`, an admin request — and reading the
  row back through `GET /audit` in `protocol-admin`'s tests, or through
  `auditRepository.list`, the function `GET /audit` calls, where a
  `protocol-oidc` test may not import the admin API. A test against
  `record` proves `record` exists.
- **Every action in the vocabulary has a production writer.** A lint-style
  test in `tests/lint/` greps non-test sources under `packages/` for each
  action literal and fails naming any that no production file writes.
- **Rollback, both halves.** A refused `/token` leaves exactly its refusal
  row and no `token.issue`.
- **A failing refusal write does not change the response.** The recorder
  is made to throw; the status and body are unchanged.
- **The budget is tested by injecting its window**, never by waiting.
- **The allowlist test cannot pass by construction.** It sends a request
  carrying a known password, secret, code or token, and asserts that value
  appears nowhere in the serialised row — the expected value comes from the
  request, the observed one from the database.
- **The bounds are tested at their negative edge**: an unregistered
  `client_id` refused at `/token` leaves no row, and a forged foreign-issuer
  token leaves no row.
- **`auditRepository` is probed with a foreign `tenant_id`**, and every new
  writer's integration test includes a cross-tenant RLS probe.

## 13. Documents

- `docs/request-paths.md`: each door's section shows the rows it writes,
  executed against a running stack, per CLAUDE.md's transcript rules.
- `docs/admin-paths.md`: the `event_type` filter, executed.
- `README.md`: the event vocabulary in brief, and the growth note.
- ADR 0037: refusal rows are bounded by the principal they name.
- ADR 0036: amended, follow-up closed.
- Umbrella §11: P4e's row amended for credential events and the estimate;
  P10's criterion names an `EventListener` a tenant's events reach, and
  P11's names `auditRefusalBudget` among the per-process bounds.
- `docs/phases/p4e.md`, `docs/NEXT.md`: the phase-close pass. NEXT.md's
  table rows for the cross-tenant refusal and `token_grants_session_fk`
  leave, and so does the "only `POST /clients` records a refusal" section.

## 14. Increments

Each is 2–6 hours, independently mergeable, and ends green.

1. `@odudu/domain-audit`: move schema and repository, vocabulary types,
   foreign-tenant probe. No behaviour change.
2. Request context: `request_id` and `ip` threaded into every writer,
   `protocol-admin`'s included; the `event_type` filter.
3. Login and second-factor rows, lockout.
4. Session rows: created, ended, evicted.
5. Migration `0070` and `requested_userinfo_claims`; token success rows.
6. Token refusal rows, the sibling-transaction catch, `auditRefusalBudget`.
7. Admin access rows: `403`s and the foreign issuer.
8. Credential lifecycle rows.
9. Transcripts, ADRs, the vocabulary-coverage test, the phase-close pass.

## 15. Index of verified claims

Every claim about this repository above was grepped before it was written.

| Claim                                                                  | Command                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `admin_mutation` is the only `event_type` written                      | `grep -rn "eventType: '" packages` → `packages/protocol-admin/src/index.ts:214` only                                      |
| Nothing fills `request_id` or `ip`                                     | `grep -rn "requestId" packages/protocol-admin/src` → the input type, the insert and the schema; no caller                 |
| Migrations `0069`, `0070` are free                                     | `ls packages/db/drizzle \| grep 0069` → nothing                                                                           |
| `token_grants_session_fk` is an unrestricted `SET NULL` on a composite | `sed -n 18,20p packages/db/drizzle/0026_token_grants_session.sql`                                                         |
| `0059` is the column-list idiom                                        | `grep -n "SET NULL" packages/db/drizzle/0059_token_exchange.sql` → `ON DELETE SET NULL (actor_subject_id)`                |
| The refresh mint omits `requestedUserinfoClaims`                       | `grep -n requestedUserinfoClaims packages/protocol-oidc/src/usecase/token-issuance.ts` → the code path only               |
| `recordFailure`'s result is discarded                                  | `grep -n recordFailure packages/authn-flows/src/usecase/executor.ts` → `await failures.recordFailure(…)` bare             |
| `/token` is not in the per-IP throttle                                 | `grep -n -A4 THROTTLED_POSTS apps/server/src/app.ts` → three `login-actions` routes                                       |
| The client secret limiter applies to password methods only             | `sed -n 149,162p packages/protocol-oidc/src/usecase/client-authentication.ts` → `isPasswordAuthMethod`                    |
| Schema drift discovers tables on disk                                  | `sed -n 17,22p packages/db/tests/schema-drift.int.test.ts`                                                                |
| `domain-audit` is covered by existing boundary rules                   | `grep -n "domain-\[" .dependency-cruiser.cjs` → `no-domain-to-protocol`, `no-domain-to-authn-flows`                       |
| `/token` refusals throw and roll back                                  | `sed -n 77,136p packages/protocol-oidc/src/view/routes/token.ts` → `withTenant` inside `try`, `TokenError` caught outside |

Third-party claims: OWASP Logging Cheat Sheet (authentication failures
always logged; logging must not deplete resources); ASVS 5.0 V16 (all
authentication operations logged); Keycloak's `EventType.java`
(`REFRESH_TOKEN` and `INTROSPECT_TOKEN` not saved by default,
`CLIENT_LOGIN_ERROR` and `LOGIN_ERROR` saved) — read from source on
2026-09-26, not from documentation.
