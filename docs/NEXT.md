# Next

## Start here

**P0, P1, P2a, P2b, P3a and P3b are complete, and the tenant rename is done.
P4 has been split four ways and P4a is under way.** Phases are section 11 of
[the umbrella spec](superpowers/specs/2026-09-10-odudu-design.md), whose
"P4 became four phases" subsection has the reasoning.

The order is **P4a → P4c → P4d → P4b**, and the letters deliberately do not
read in execution order, because `P4b` was spent on theming before P4 split
and an accepted ADR cites it. P4a is token exchange
([spec](superpowers/specs/2026-09-23-p4a-token-exchange-design.md)); P4c is
the admin API; P4d is the consoles; P4b stays theming and stays last.

**A bare `P4` below means P4c** unless it concerns token exchange, the grant
allowlist, theming or client branding — the same disambiguation the P2 split
used, and for the same reason: a citation renumbered wrongly is invisible for
good. Nothing below is a plan for any of the four, only what they inherit and
what is still open.

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

P3b shipped the session set — a browser's cookie holds a list of session
ids rather than one, bounded per browser by `max_sessions_per_browser`
(ADR 0033), with `prompt=select_account` rendering a chooser over it and a
tenant's "remember me" selecting a second pair of idle and maximum
lifespans. Ending a session now reaches the relying parties that hold it:
front-channel through iframes the logout page declares (ADR 0034), and
back-channel through a queue, a signed Logout Token per registered client
and an `odudu send-logouts` command with its own retention window. The
token surface gained RFC 7662 introspection scoped by audience and
consulting session liveness, RFC 7009 revocation, RFC 8707 `resource`
indicators making `aud` derived rather than asserted, signed and encrypted
UserInfo responses selected by registration — this repository's first JWE —
the OIDC Core §5.5 `claims` parameter, and `private_key_jwt` and
proxy-header mTLS client authentication.

What turned out to be **wrong** while building it is in
[docs/phases/p3b.md](phases/p3b.md), not here. Two things from it are worth
reading before P4c is brainstormed: the recurring defect of a rule applied at
one door out of several, and the finding that this repository's most
frequent defect is a comment whose conclusion is right and whose stated
reason is false.

### What each phase found while building it

The running records, split out of this file on 2026-09-17: P2b reached
1,873 lines here, of which the part describing where the project stood was 58.

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

## What P4 inherits

**A session set to list and to end.** `sessionRepository.liveByIds`
(`packages/authn-flows/src/repository/sessions.ts`) measures each session
against its own lifespan pair, and the cookie is the only place a browser's
membership is recorded. P4's "list a subject's sessions and end one" is the
first surface that reads sessions by **subject** rather than by cookie —
and it is also the operator's only reach for the orphan case ADR 0033
records, where two genuinely concurrent logins in one browser can leave a
session the browser's own cookie no longer names. A **remembered** orphan
idles for `remember_me_idle_seconds`, seven days by default, which is the
sharp case.

**Client metadata that only two doors can write.** Dynamic client
registration (P3a) validates and stores the full metadata set; `seed client`
takes `--redirect-uri`, `--post-logout-redirect-uri`, `--web-origin`,
`--client-secret` and `--token-endpoint-auth-method` and nothing else, and
refuses a client that already exists rather than amending one. So every
per-client value P3b reads — `audiences`, the logout URIs, the UserInfo
algorithms, `tls_client_auth_subject_dn` — is settable at creation by one
door and by `psql` otherwise. `docs/request-paths.md` says so at each site
that reaches for SQL, and aggregates it under "Any admin API".

**Tenant settings already have a command, and its validation is reusable.**
`odudu seed tenant --name <tenant> --set <name>=<value>` applies any of the
tenant settings by column name. The name-to-column map and the coercion live
in `packages/domain-tenant/src/service/tenant-settings.ts` rather than in the
CLI, so P4's admin API inherits them rather than growing a second copy.
Ranges are deliberately not there — they are CHECK constraints, and a policy
no writer may bypass belongs at the database.

**An asymmetry worth deciding about rather than inheriting by accident.**
`seed tenant --set` changes an existing tenant; `seed client` will not change
an existing client, because a re-run that quietly widened a registered
redirect list is how an allowlist grows by accident. An admin API that
treats both the same way would be wrong in one of the two directions. P4's criterion now poses that
question rather than leaving it to be answered by whichever surface is
written first.

**Signing-key rotation now has a consistency obligation it did not have
before.** A tenant holds exactly one active signing key
(`signing_keys_one_active`), and P3b made two things depend on that:
discovery advertises `userinfo_signing_alg_values_supported` as that
tenant's own `[key.alg, "none"]`, and registration refuses a
`userinfo_signed_response_alg` the active key cannot produce. Rotating a
tenant to a key with a different algorithm therefore strands every client
registered against the old one — `/userinfo` answers 500 for them, with a
log line naming client, registered algorithm and active key. P4 owns
rotation, and its criterion now names that case.

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

## Decisions still open

### The token surface

**A `claims` `userinfo` request narrows `/userinfo`, and a refresh silently
widens it back.** The parameter is parsed at `/authorize`, stored on the
authorization code, and embedded on the access token as
`requested_userinfo_claims`; `/userinfo` reads it back and narrows,
intersected with granted scope. A `refresh_token` redemption mints from the
rotated grant rather than from a code, so it carries no such claim and the
narrowing disappears. Not a security defect — nothing returned after a
refresh crosses the consented scope — and not clearly a spec defect either:
OIDC Core §5.5 describes `claims` as requesting Claims _alongside_ what
`scope` grants, and narrowing scope-granted Claims away is a stricter
reading this implementation chose without writing the choice down.

- Trigger: revisiting whether narrowing is right at all. If it is kept,
  thread `requested_userinfo_claims` onto the rotated grant
  (`packages/protocol-oidc/src/repository/grants.ts`,
  `usecase/token-issuance.ts`'s `issueRefreshTokens`). If it is not, the
  refresh gap disappears with it.

**No scope means anything in particular at an audience.** RFC 9068 §2.2.3
requires a token's `scope` to be coherent with its `aud`. A client may ask
for `reports:read` against `resource=https://api.example` and nothing
objects. Recorded `accepted:` in `docs/protocols/rfc9068.md`. Closing it
honestly needs a per-audience scope model, which belongs to client
management rather than to the token surface.

- Trigger: whichever phase gives scopes an audience of their own.

**`/introspect` answers every registered client the same way, regardless of
which resource it names.** RFC 7662 §2.2's MAY to limit which scopes a
protected resource sees, and §4's SHOULD that it be specifically authorized
to call the endpoint at all, are both `gap` rather than `deferred:` — no
phase has committed to either.

- Trigger: a phase that gives a client a "may introspect" capability
  distinct from ordinary client authentication, or the per-resource scope
  model the entry above needs.

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

**`/token` enforces no `config.grantTypes` allowlist, on either
authentication path.** A client registered for `authorization_code` only
can still obtain a `client_credentials` token: `token-issuance.ts`'s only
read of `config.grantTypes` gates whether a refresh token is issued, not
which grant a request may use.

- Trigger: **P4a**, which adds token exchange and so makes the next change
  to grant selection in `issueTokens`; its criterion names the allowlist. Add
  `config.grantTypes.includes(request.grantType)` before dispatching. Note
  this is a behaviour change for an existing client, not only a new check.

**`/userinfo` and `/introspect` both honour a disabled client's live access
token.** `resolveUserinfo` now checks the tenant, the token's own grant
(`revoked_at`) and its session's liveness, and `introspect` checks the
identical pair — neither reads `client.enabled`, so disabling a client
after a token was issued to it revokes nothing: the grant stays live,
`resolveRoleReach` refuses only the `fullScopeAllowed` bypass, and
`userinfoEncryptionTarget` refuses only registered encryption. A disabled
client that registered neither still gets an ordinary, correctly narrowed
response from both endpoints.

- Trigger: **P4**, where disabling a client becomes an operation at all.
  Its criterion now asks that phase to decide whether `/userinfo` and
  `/introspect` read `client.enabled` the way `resolveRoleReach` and
  `resolveClientWebOrigins` do.

**A signed UserInfo response's `typ` is a private value.** `userinfo+jwt`
is not registered anywhere; it exists to stop a UserInfo response being
accepted as an `id_token_hint`, which it was before. A registered value, if
one ever appears, is what this should move to.

- Trigger: an IANA registration for the media type, or a conformance suite
  objecting to the private one.

**`/introspect`'s entitlement check sits in a `usecase`, not a `service`.**
`callerIsAddressed` and `audienceOf`
(`packages/protocol-oidc/src/usecase/introspection.ts`) are pure domain
decisions with no orchestration, which this package's convention puts in
`service/`. The trigger this entry carried — "the task that wires
`/introspect`'s HTTP route" — has fired; the route shipped and the move did
not happen.

- Trigger: any task that next touches `introspection.ts`. It is two
  functions and their tests.

**The post-rotation `resolveAudience` check is exercised by no test.** It is
load-bearing only for ADR 0019's revocation race — a revocation landing
between the pre-flight and the authoritative read — which no test drives.

- Trigger: whichever task next touches refresh rotation. A test that lands
  a revocation in that window is what pins it.

**ADR 0007 has never been executed.** Schemas are to be authored in Zod in
`packages/contracts` and compiled with `z.toJSONSchema()` for ajv validation
and OpenAPI. `parseStructure` in `token-issuance.ts` is the real authority
for the token request instead, and the contracts schemas that described it
were deleted in P4a rather than extended with a fourth grant, because a
stale union is worse than an absent one.

- Trigger: **P4c**, which publishes OpenAPI and so must either honour ADR
  0007 or amend it. `verified:` `z.toJSONSchema` exists in Zod 4.6.1 and
  emits draft 2020-12, the dialect OpenAPI 3.1 uses.

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
row, giving admission, logout and P4's session list one predicate.

- Trigger: the remedy is the reversal of the spec's decision 1 (the cookie
  holds a list; there is no browser row), so it waits until something else
  wants that row — most likely P4's session surface.

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

**`pnpm trace` can overstate the census, and hides its own errors after the
first.** `parseStatus` throws in `loadTables` before any id is resolved, so
one malformed clause status masks every later problem in every later file —
a single `trace` error is never safely the only one. And the summary counts
a broken `covered` row as covered; it printed `410 covered` on a failing
run. Only reachable in an already-red build, but the census is the one
artefact claiming to be exhaustive.

- Trigger: whichever change next touches `tools/trace`. Collect parse
  errors rather than throwing on the first, and exclude a row that failed
  validation from the summary.

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
- `session-cookie.ts` hand-rolls a case-sensitive UUID regex while the test
  beside it uses `@odudu/kernel`'s case-insensitive `isUuid`. Inert today —
  `newId()` emits lowercase only — and ironic in the module whose purpose is
  to be one authority. **P4**, whose criterion lists a subject's sessions and
  ends one: the first surface to read a session other than through that
  cookie, and where ADR 0033's browser-identifier remedy would land in the
  same file.
- `pendingSession` duplicates `authenticatedSession`'s two liveness
  conditions inline rather than sharing a predicate. Four lines, and the two
  are not identical, so they must be kept in sync by hand if liveness
  semantics change. **P4**, whose criterion makes a tenant's authentication
  flow configurable — both helpers are in the executor that flow drives,
  `packages/authn-flows/src/usecase/executor.ts`.
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
