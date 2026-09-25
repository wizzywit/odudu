# Next

## Start here

**P0, P1, P2a, P2b, P3a, P3b, P4a and P4c are complete, and the tenant
rename is done. P4 has been split five ways.** Phases are section 11 of
[the umbrella spec](superpowers/specs/2026-09-10-odudu-design.md), whose
"P4 became four phases, then five" subsection has the reasoning.

The order is **P4a → P4c → P4e → P4d → P4b**, and the letters deliberately
do not read in execution order, because `P4b` was spent on theming before P4
split and an accepted ADR cites it. P4a was token exchange
([spec](superpowers/specs/2026-09-23-p4a-token-exchange-design.md)); P4c was
the admin API
([spec](superpowers/specs/2026-09-24-p4c-admin-api-design.md)); **P4e is
next** — authentication and token audit events; P4d is the consoles; P4b
stays theming and stays last.

**P4c shipped the admin API**, at `/admin/tenants/{tenant}/` with
`/admin/tenants` above it, authenticated by an ordinary access token whose
`aud` names `urn:odudu:params:admin-api` and authorized per request by a
capability role on the tenant's built-in `odudu-admin` client. Tenants,
their settings, clients, subjects, credentials, required actions, roles,
groups, scopes, scope-mapper bindings, signing keys, the authentication
flow, per-tenant SMTP and an audit trail are all reachable through it; a
subject's sessions are listed by subject and ended individually, which is
the first read of a session that does not start from a cookie.
`odudu seed admin` bootstraps the `system` tenant and the first
administrator with a single-use password and a forced change. The narrative
is [docs/admin-paths.md](admin-paths.md), every transcript in it executed;
the reference is the OpenAPI document at `/admin/openapi.json`.

What turned out to be **wrong** while building it is in
[docs/phases/p4c.md](phases/p4c.md), not here. Three of its themes are
worth reading before P4e starts: a mechanism built with no caller, a test
that passes by construction, and — again, as in P3b — a comment whose
conclusion is right and whose stated reason is false.

**What P4c decided that other phases were waiting on.** ADR 0007 is amended
and executed: the admin API is its first JSON surface, and the form-encoded
protocol endpoints keep `parseStructure` on a recorded rationale. The
`client.enabled` question is answered — `/userinfo`, `/introspect` and all
three exchange branches read it through one shared predicate. ADR 0036
decides that `/userinfo`'s claims narrowing is the right reading of OIDC
Core §5.5 and that losing `requested_userinfo_claims` on refresh is the
defect; closing it is P4e's.

**A bare `P4` below means P4e** unless it concerns token exchange, the grant
allowlist, the admin API, the consoles, theming or client branding — the
same disambiguation the P2 split used, and for the same reason: a citation
renumbered wrongly is invisible for good. Nothing below is a plan for any of
them, only what they inherit and what is still open.

**The tenant rename changed the wire.** What was called a `realm` is a
tenant everywhere: the path is `/tenants/{tenant}/…`, so the issuer — and
with it `iss` in every ID token, access token and Logout Token, the RFC 9207
authorization-response parameter, and the value `/userinfo` verifies against
— moved with it. The table is `tenants`, its foreign keys are `tenant_id`,
and the row-level-security GUC is `app.tenant_id`. The CLI flag is
`--tenant` and the subcommand `seed tenant`. Migrations
`0057_rename_realm_to_tenant.sql` and `0058_rename_realm_constraint_names.sql`
carry the schema; the first drops and recreates all 31 policies, because a
column rename does not rewrite the GUC literal inside them. Nothing has been
deployed, so there is no transition to describe — a hard cutover is the only
reason this was simple, and a deployed system would need two issuers per
tenant for a published window instead.

### What each phase found while building it

The running records, split out of this file on 2026-09-17: P2b reached
1,873 lines here, of which the part describing where the project stood was 58.

- [P4c — the admin API](phases/p4c.md)
- [P4a — token exchange](phases/p4a.md)
- [Renaming the tenant concept](phases/tenant-rename.md) — not a phase; a
  cross-cutting rename between P3b and P4, kept here for the same reason
- [P3b — sessions, logout and the token surface](phases/p3b.md)
- [P3a — clients, dynamic registration and consent](phases/p3a.md)
- [P2b — credentials, MFA and the session lifecycle](phases/p2b.md)
- [P0, P1 and P2a](phases/p0-p1-p2a.md)

Nothing in them is current position. They are kept because they record what
turned out to be wrong during a phase, which no spec, plan or close note
keeps.

**What belongs in this file:** where the project stands, what the next phase
inherits, decisions that are still open, and what a final review deferred.
Not what a finished phase discovered. If a section here is addressed to a
phase that has closed, it is overdue for a decision or a move, not for
another paragraph.

## What P4e, P4d and P4b inherit

**A table built for the events P4e writes.** `audit_events`
(`0067_admin_audit.sql`) carries `event_type`, a **nullable**
`actor_subject_id` and a nullable `actor_client_id` precisely so an
authentication event — which has a subject it happened to, and often no
administrator at all — fits the same table as an admin mutation, without a
migration. `admin_mutation` is the only `event_type` written today.
Retention is the tenant's own `audit_retention_days` setting, already last
in `REAP_ORDER`, so P4e inherits the window rather than adding a second one
to keep in step. `GET /admin/tenants/{tenant}/audit` already filters by
`resource_type`, `action`, `outcome`, `actor_subject_id` and an
`occurred_at` range; `event_type` is the filter it will need.

**`requested_userinfo_claims` is lost on refresh, and ADR 0036 says so.**
The narrowing itself is decided — OIDC Core §5.5's `claims` parameter
narrows what `/userinfo` returns, which is the stricter of two readings and
now a written one. The defect the ADR leaves open is that a rotated grant
does not carry the request forward, so a refresh widens the response.
Closing it means threading the value onto the grant row, on the same
rotation path P4e's token events instrument.

**Only `POST /clients` and the capability ceilings record a refusal.**
`outcome` has three values; a ceiling refusal writes a row naming what the
caller does not hold, because an attempted privilege escalation is worth
recording whatever is decided about refusals in general. Every other admin
mutation writes a row only when it succeeds, so `?outcome=refused` against
a resource type with neither door answers nothing — not because nothing was
refused. Whether that generalises is P4e's to decide, since it is the phase
that decides what a refused **authentication** writes.

**Two recovery-code gaps that need the account console.** A subject cannot
ask for a fresh set before running out, and nothing warns as the list gets
short. Both are named in P4d's exit criterion; `beginRecoveryCodes` already
replaces a set wholesale, so what is owed is a surface, not a mechanism.

**Theming is P4b's, and the contract it needs already exists.** Every
renderer returns `RenderedPage`, and `pageHeaders` in `@odudu/kernel` is the
single authority for a page's headers (ADR 0029). A theme replaces a body
fragment and a token set, never the document, because the document carries
the CSP nonce, the framing defence and the `auth_session_id` — ADR 0030 has
the reasoning, and the `frames` member ADR 0034 added is part of the same
contract.

**Deployment is still unpublished.** There is no published image or release
process, secrets are environment variables and nothing more, and there is
no backup or restore guidance — **P12**, whose position in the table is not
a dependency: publishing an image waits on nothing and is the prerequisite
for anybody deploying this at all. Multi-replica deployment is blocked on
migration locking and a shared session cache, both P11.

## What P5 inherits

**A grant, not an agent, is what P4a's exchange mints.** `token_grants` grew
`actorSubjectId` and `exchangedFromGrantId` (migration
`0059_token_exchange.sql`) so a delegated or impersonated grant records who
it came from, but nothing reads either column to decide anything yet — the
agent identity layer's own instance, budget and `max_depth` (design spec
§9) are still to build. Three things specifically wait on it:

- **`may_act` minting.** `mayActPermits`
  (`packages/protocol-oidc/src/service/token-exchange.ts`) enforces the
  claim already, permitting an exchange whenever it is absent "since
  nothing mints it yet" — its own comment. A subject pre-authorising a
  specific actor needs something to write the claim onto a token in the
  first place, which is P5's, alongside the instance that would be doing
  the pre-authorising.
- **`may_act` is unreachable when the subject is a refresh token.**
  `resolveExchangeToken`'s refresh-token branch
  (`packages/protocol-oidc/src/usecase/token-exchange-subject.ts`) sets
  `mayAct: undefined` unconditionally: no grant column persists `may_act`,
  and a refresh token carries no JWT claims of its own to read one from.
  Not exploitable today, since nothing mints the claim yet, but once P5
  does, a holder of a grant's refresh token escapes a restriction placed on
  its access token by presenting the refresh token instead — and a
  delegated client normally holds both. The minting phase must persist
  `may_act` on the grant row (alongside `actChain`/`expCeiling`) or accept
  this gap knowingly.
- **The delegation cascade `exchangedFromGrantId` enables but does not
  perform.** Revoking a grant today revokes that grant alone;
  `exchangedFromGrantId` records the lineage a cascade would walk, but
  `tokenGrantRepository.revoke` walks nothing. Whether revoking a subject's
  original grant should transitively revoke every grant exchanged from it
  is exactly "revoking any link transitively revokes everything below it"
  (design spec §9), stated as an agent-layer invariant rather than
  something this phase's plain delegation already gives it.
- **A hardcoded chain depth.** `MAX_DELEGATION_DEPTH = 8`
  (`packages/protocol-oidc/src/service/token-exchange.ts`) is a cap, not a
  tenant setting, by its own comment — the configurable form belongs with
  the agent layer's own `max_depth`, which also owns the chain's other
  bounds (scope and TTL narrowing, budget).

## Decisions still open

### The token surface

**No scope means anything in particular at an audience.** RFC 9068 §2.2.3
requires a token's `scope` to be coherent with its `aud`. A client may ask
for `reports:read` against `resource=https://api.example` and nothing
objects. Recorded `accepted:` in `docs/protocols/rfc9068.md`. Closing it
honestly needs a per-audience scope model. P4c declined it deliberately —
it is not client management, it is a resource server as a first-class thing
that owns scopes.

- Trigger: **P9**, whose criterion now names it together with the entry
  below, so half the model is not built twice.

**`/introspect` answers every registered client the same way, regardless of
which resource it names.** RFC 7662 §2.2's MAY to limit which scopes a
protected resource sees, and §4's SHOULD that it be specifically authorized
to call the endpoint at all, are the other half of that same missing
abstraction: a "may introspect" entitlement is a property of a resource
server, and there is no resource server here to hold one.

- Trigger: **P9**, with the entry above. Deciding either alone would settle
  what a resource server is by accident.

**A `private_key_jwt` or `tls_client_auth` client can never call
`/introspect` or `/revoke`.** Both authenticate through `authenticateClient`
alone, which reads a Basic header or a body `client_secret`; neither
assertion-based method is dispatched anywhere but `/token`. Recorded as an
accepted limitation rather than a gap — no clause in either RFC requires a
particular set of methods — at `docs/protocols/rfc7662.md`'s "Only the two
password methods reach this endpoint".

- Trigger: **P13**, which reworks client authentication for FAPI 2.0 and
  whose criterion now names both methods at both endpoints. Extend
  `token-issuance.ts`'s assertion and certificate dispatch to the two routes.

**A signed UserInfo response's `typ` is a private value.** `userinfo+jwt`
is not registered anywhere; it exists to stop a UserInfo response being
accepted as an `id_token_hint`, which it was before. A registered value, if
one ever appears, is what this should move to.

- Trigger: an IANA registration for the media type, or a conformance suite
  objecting to the private one.

**The post-rotation `resolveAudience` check is exercised by no test.** It is
load-bearing only for ADR 0019's revocation race — a revocation landing
between the pre-flight and the authoritative read — which no test drives.

- Trigger: whichever task next touches refresh rotation. A test that lands
  a revocation in that window is what pins it.

**No test proves a refresh rotated past its `exp_ceiling` is actually
refused.** `rotateRefreshToken` (P4a) caps a replacement refresh token's
`expiresAt` at the exchanged grant's ceiling, and the refusal itself is
real: `refreshTokenRepository.consume` gates on a literal SQL
`expires_at > now()` (`repository/refresh.ts`), so a capped, expired row is
refused exactly like any other expired refresh token. But that check reads
PostgreSQL's own clock, never the app's injected `Clock` — an integration
test can advance a `FakeClock` to move every other time-dependent decision
in this file, and it will not move this one. Nothing short of a real wait
can currently demonstrate the refusal.

- Trigger: whichever change next gives the refresh path a clock it can
  control end to end (folding the SQL-level expiry check into an
  application-level comparison against `deps.clock.now()`), or the phase
  that introduces time-travel fixtures capable of moving the database's
  own clock rather than only the app's.

**`token_grants_session_fk` (0026_token_grants_session.sql) has the same
unrestricted-`ON DELETE SET NULL` defect P4a's review caught in 0059:
deleting a session would null `tenant_id` alongside `session_id`, and the
delete would fail its NOT NULL constraint rather than detach the grant —
the comment beside it, claiming the delete "would otherwise silently
promote a session-bound grant to an offline one", describes behaviour
PostgreSQL does not have. Nothing has hit this: `REAP_ORDER`
(`apps/server/src/cli/reap.ts`) deletes `token_grants` before `sessions`,
so reap never deletes a session a live grant references. The fix is the
same column-list form: `ON DELETE SET NULL (session_id)`.

- Trigger: the next migration that touches `token_grants` for an unrelated
  reason.

### The client endpoints

**`deferred:`** `PATCH /admin/tenants/{tenant}/clients/{id}`'s two
`update` calls (`clientRepository`, `clientOidcConfigRepository`) translate
no CHECK-constraint violation into a caller-facing `400` the way
`createClient` now does for the unique index (P4c's own fix) — an
amendment JS-side validation lets through but `client_oidc_config`'s
`web_origins_are_valid` CHECK still refuses would surface as a generic
`500`. Not fixed in P4c: neither `update` touches a unique index, and
everything else they write has already passed `parseClientMetadata` or the
checked coercions beside it, so `web_origins_are_valid` is the one CHECK
with no JS-side mirror standing behind it.

- Trigger: `web_origins` getting its own shape validation ahead of the
  write, or a report that the CHECK has actually fired.

### The flow-replace routes

**`deferred:`** `validateFlowSteps` admits a request naming the same
authenticator twice; nothing rejects the duplicate, and whichever one
dispatch reaches first is not obviously the caller's intent.

- Trigger: `flow/executions` gaining a UI (P4d), whose users are likelier
  to produce one than a script calling the admin API directly.

### The session set

**The cap is per browser, and admits `cap + (k - 1)` under `k` concurrent
logins.** The candidate list is fixed before the tenant-row lock and
identical across racers from one browser, so once the first evicts, the
remaining `k - 1` insert unconditionally. Accepted: the cap is a size guard
with 4.4x headroom, not a security boundary. The consequence that is not
merely cosmetic is the orphan — `resolveSessions` supplies logout
membership too, so a session omitted from the cookie cannot be logged out
through the cookie path. ADR 0033 carries the derivation and the durable
remedy: a stable browser identifier in its own cookie, stored on the session
row, giving admission, logout and the admin session list one predicate.

- Trigger: the remedy is the reversal of the spec's decision 1 (the cookie
  holds a list; there is no browser row), so it waits until something else
  wants that row. P4c's session list was the candidate and did not need it:
  it reads sessions by subject, which reaches an orphan without knowing
  which browser holds it. So the trigger is now an operator or an account
  console (**P4d**) wanting to show _which device_ a session belongs to,
  which no predicate here can answer.

### The audit log

**`deferred:`** An admin request refused for an issuer mismatch writes no
audit row. The refusal is decided before signature verification, because a
token naming an unrecognised issuer has no keys to verify against — so
auditing there would let any unauthenticated caller append a row per
request. Recording it safely means first resolving the named issuer to a
tenant in this deployment and verifying the signature against that
tenant's keys, then auditing only a token that is authentic but presented
at a path it may not reach.

- Trigger: **P4e**, whose criterion names it. It is the phase that decides
  what a refused authentication writes, and this is the same question asked
  of the admin surface: what may an unauthenticated caller cause to be
  written.

**`deferred:`** A path parameter that is not a UUID reaches PostgreSQL and
surfaces its parse error as `500`, not `400` or `404` — observed on
`GET /admin/tenants/{tenant}/clients/not-a-uuid`, and on the `subjects` and
`roles` reads the same way. The generated schemas validate the body, not
the path, and nothing between the route and the repository narrows an id.
Harmless — no information is disclosed and the request changes nothing —
but a caller with a typo is told the server broke.

- Trigger: **P4d**, whose console will produce ids from links rather than
  by hand and so wants the distinction between "no such client" and "that
  is not an id" to be the caller's, not the log's.

### Operational and infrastructural

**Neither of the server's two outbound DNS lookups carries a deadline, and
both run in production on three request paths.**
`createLogoutDeliveryTransport`'s `defaultLookup`
(`apps/server/src/logout-delivery-transport.ts`) and
`defaultClientKeyLookup` (`apps/server/src/client-key-transport.ts`) both
call `node:dns/promises`'s `lookup` with no timeout; the first also ignores
the `AbortSignal` `sendLogouts` already started. The second is shared by
`/token`'s `private_key_jwt` authentication and, since encrypted UserInfo
responses landed, by `/userinfo` — now on a path between a resource
server's request and its answer.

- Trigger: **P11**, whose criterion documents a p99 for `/token` and
  `/userinfo` and so cannot be met while either lookup is unbounded. Bound
  the lookup itself, and decide whether the two
  transports share one answer or each wires its own — and whether
  `/userinfo` needs a tighter timeout than `/token`'s shared default, since
  it sits on a resource server's request rather than a client's own.

**One configured issuer base for the whole deployment.** The admin API
verifies a token's `iss` by deriving it from the request, the same way
`/token` mints it, because there is no configured issuer to compare against
— which also forced the admin API's audience to be a fixed URN rather than
`${iss}/admin`. `ODUDU_PUBLIC_BASE_URL` already exists and is used for mail
links and the WebAuthn relying-party id, so the value is half present.
Replacing request-derived issuers everywhere changes how `iss` is minted on
every token, ID token and Logout Token, on the RFC 9207 parameter and in
discovery, which is why P4c did not do it in passing.

- Trigger: **P11** or **P12**, whichever first reworks deployment
  configuration.

**`client_oidc_config_tls_client_auth_needs_subject_dn` enforces `NOT
NULL`, not non-blank.** A row with `tls_client_auth_subject_dn = ''` passes
the CHECK, and `tlsClientSubject` only refuses a zero-length header. No code
path can produce such a row — `parseClientMetadata` trims and rejects a
blank value — so it is reachable only by a hand-written `INSERT`, the same
class the `jwks`/`jwks_uri` mutual-exclusion constraint already accepts.

- Trigger: the next migration that touches `client_oidc_config` for an
  unrelated reason is where the tightened CHECK belongs.

**Affected-package-only CI.** Turborepo and pnpm both support
`--filter='...[<ref>]'`, so no tooling change is needed. Not adopted: CI
runs in about 50 seconds end to end, and `test` is a root-level `vitest run`
rather than a per-package Turbo task, which is a prerequisite. When
adopting, prefer Turborepo **caching** first — an unchanged package replays
its cached result rather than being skipped, which is the same wall-clock
win without "we did not run those tests" semantics. Keep typecheck, lint,
boundaries and unit tests always-full, and set `globalDependencies` at the
same time.

- Trigger for caching: CI exceeds roughly 5 minutes (likely P4d, when
  Playwright arrives).
- Trigger for filtering: slow suites dominate — P8 SAML interop, P9 policy
  evaluation, or the nightly conformance suite.

**Committed development credentials.** Kept inline deliberately; ADR 0014
has the reasoning, the three controls that make it acceptable, and the
conditions under which to revisit.

### The traceability machinery itself

**`CLAUDE.md` states a rule the repository's own tests forbid.** A fenced
block holding a response is supposed to carry no language tag, because
Prettier reformats a tagged one — verified true. But
`tests/docs/markdown.ts`'s `blockAfter(document, marker, language)` selects
a block **by** language and its callers pass `'json'`, so an untagged JSON
response is invisible to every check built on it. Every JSON response in
`docs/request-paths.md` therefore shows Prettier's formatting rather than
the server's bytes: content intact, byte-level promise not.

- Trigger: do it as its own change. Teach the locator to match an
  empty-language block — the parser beneath it already accepts one — then
  untag the responses. It touches every JSON transcript at once, which is
  why it does not ride along with anything else.

**RFC 7523 has no clause table, and its clauses are absent from the
matrix.** `docs/protocols/rfc7523.md` is the one file in `docs/protocols/`
without a clause table, so Odudu has implemented an RFC whose every clause
is untracked in the system built to make that visible — and `pnpm trace`
does not fail on it, because a file with no table contributes zero rows
rather than an error. This entry asked for it "before P3b closes"; P3b
closed without it, so it is now **P13**'s, named in that phase's criterion,
on the grounds that P13 is the next phase to rework client authentication.

- What it takes: §2.2's two request parameters and §3's claim requirements.
  §5 stays prose, per `rfc7523.md`'s own header. Test IDs are mostly
  fillable from `[ODUDU-PRIVATE-KEY-JWT-01]`
  (`packages/protocol-oidc/tests/private-key-jwt.int.test.ts`) and
  `service/client-assertion.test.ts`.

**`docs/protocols/rfc6750.md`'s row "`scope` appears at most once" is
vacuous.** It is cited to a name-agnostic grammar test, and the server emits
no `scope` auth-param anywhere, so the row is true and holds nothing.
Choosing between rewording it and emitting a `scope` is a coverage
judgement, not a fix.

**Fifteen tests share one clause id, `[RFC8705-2.1-03]`, while pinning
different requirements** — a disabled client, a public client, the
one-method rule, the duplicate header, tenant isolation, several of them not
§2.1 at all. The undifferentiated id is the real defect; the missing table
that surfaced it was fixed.

**`docs/protocols/rfc7662.md` points at a plan file** for when a class of
rows was decided. A plan is archived scaffolding; the durable pointer is
this file or the phase note.

## Deferred from the final review

### Work owed, and the phase each belongs to

- `/logout` delivers no front-channel frames on either branch that redirects:
  `packages/protocol-oidc/src/usecase/logout.ts` computes the list only where
  `decision.redirectTo === null`, so a session ended with a matched
  `post_logout_redirect_uri` — the ordinary case — leaves a relying party
  that registered a `frontchannel_logout_uri` and no `backchannel_logout_uri`
  signed in. Nothing records the gating as a choice: not ADR 0034, which
  governs how a page declares its frames rather than when one is rendered.
  It is the defect [docs/phases/p3b.md](phases/p3b.md) names as this
  repository's recurring one — a rule applied at one door out of several.
  **P4b**, whose criterion names it: the remedy is to render the frames and
  navigate afterwards, which gives the redirecting branch the page it lacks,
  and P4b is the phase that owes every page the server renders a theme.
- The two `user_credentials` counts at `docs/request-paths.md:3052` and
  `:3282` are unscoped, and correct only in document order — the
  neighbouring query of the same kind is scoped. Re-scoping them needs a
  re-run against a live stack. **P4d**, which re-captures those transcripts
  anyway: its criterion gives a subject a fresh set of recovery codes before
  the old set is spent, which is what those two queries count.
- The boundary suite's negative control filters a fixture with no imports at
  all, so it cannot demonstrate that `service-is-a-leaf` is not over-broad.
  A service importing another service would. **P4d**: its consoles are the
  first packages outside the server to carry the five layers, so the rule set
  and its fixtures are extended there.
- `tests/lint/production-guard-order.test.ts` compares source offsets and
  breaks on a rename or a helper extraction. A reasonable stopgap for the
  still-positional server-boot path, but its narrowness should be visible to
  whoever reads it next. **P12**, whose criterion sources secrets from
  somewhere other than the process environment and so reworks the boot
  sequence in `apps/server/src/main.ts` that the test pins by offset.

### Recorded judgements, where the code stands and nothing is owed

- Six migration-filename citations under `docs/superpowers/plans/` are off
  by one: each plan predicted a number, another migration landed first, and
  everything shifted. `0009_token_grants.sql` is `0010_token_grants.sql` on
  disk, and the other five the same way — the descriptive name is right in
  every case. A plan records what was planned, so correcting a prediction
  execution invalidated would falsify that record, as editing captured
  output would. They stand. There are no dangling citations in `packages`,
  `apps`, `tools`, `tests`, `infra` or `README.md`.
- A `client_id`/hint mismatch at `/logout` rejects through an invariant
  `throw`, so a future refactor's mistake is a 500 rather than a redirect.
  Fails closed, which is why it stands.
- The order pin on `/authorize`'s `claims` size check couples to
  `JSON.parse` **by name**: a refactor to another parse mechanism would make
  it silently stop testing anything rather than fail. Acceptable for one
  small function with one obvious parse path; it would not scale.
- `ODUDU_TRUST_PROXY=` (a bare key) refuses boot rather than defaulting off
  — correct by strictness, but a new way for a previously-booting
  environment to fail.
- `logoutDeliveryRepository.enqueue` takes caller-supplied row ids where
  `outbox.enqueue` generates its own. Arguably right — the session-ending
  transaction needs the id up front — but an unremarked divergence from the
  precedent it otherwise copies.
