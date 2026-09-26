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
defect; migration `0070` closes it (the ADR's amendment).

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
another paragraph. `tests/docs/next-budget.test.ts` holds the file to 400
lines and any one section to 130, so an entry that has somewhere better to
live is pushed there rather than accumulating here.

## What P4e, P4d and P4b inherit

**A table built for the events P4e writes.** `audit_events`
(`0067_admin_audit.sql`) carries `event_type`, a **nullable**
`actor_subject_id` and a nullable `actor_client_id` precisely so an
authentication event — which has a subject it happened to, and often no
administrator at all — fits the same table as an admin mutation, without a
migration. `admin_mutation` is the only `event_type` written today.
Retention is the tenant's own `audit_retention_days` setting, already last
in `REAP_ORDER`, so P4e inherits the window rather than adding a second one
to keep in step. `GET /admin/tenants/{tenant}/audit` filters by
`event_type`, `resource_type`, `action`, `outcome`, `actor_subject_id` and
an `occurred_at` range.

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

Two kinds of entry, split by **where the argument lives**, because that is
what governs how fast this file grows. An item whose argument is already in
an ADR, a protocol note or a phase note keeps one row and a link — a second
full copy here is what took this file to 1,873 lines once. An item with
nowhere else to be carries its argument, at the length it needs.

A new entry belongs in the table if it possibly can. Writing one into the
prose below means asserting there is no ADR, protocol note or phase note
that should hold it, which is usually false.

### Argued elsewhere, and pointed at from here

| What is open                                                                                                            | Where it is argued                                                                      | Trigger                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| No scope means anything in particular at an audience; RFC 9068 §2.2.3 wants `scope` coherent with `aud`                 | [rfc9068.md](protocols/rfc9068.md), "Why §2.2.3 is accepted, not held"                  | **P9**, with the row below                              |
| `/introspect` answers every registered client alike: no per-resource scope narrowing, no "may introspect"               | [rfc7662.md](protocols/rfc7662.md), "Two MAYs left `gap`"                               | **P9**, with the row above                              |
| `private_key_jwt` and `tls_client_auth` reach `/token` alone, never `/introspect` or `/revoke`                          | [rfc7662.md](protocols/rfc7662.md), "Only the two password methods reach this endpoint" | **P13**                                                 |
| RFC 7523 has no clause table, so the clauses of an implemented RFC are untracked by the system built for it             | [rfc7523.md](protocols/rfc7523.md)'s own header                                         | **P13**                                                 |
| The session cap is per browser and admits `cap + (k - 1)` under `k` concurrent logins, orphaning one                    | [ADR 0033](adr/0033-admitting-a-session-locks-the-tenant-row.md)                        | **P4d**, wanting a session's device                     |
| An admin request refused for an issuer mismatch writes no audit row, and cannot safely write one yet                    | [p4c.md](phases/p4c.md), "Things that were reverted rather than shipped"                | **P4e**, which decides what a refusal writes            |
| `CLAUDE.md` states an untagged-fence rule that `tests/docs/markdown.ts` cannot see, so no JSON response is byte-checked | [p3b.md](phases/p3b.md), "`CLAUDE.md` states a rule its own tests forbid"               | its own change; it untags every JSON transcript at once |
| Committed development credentials                                                                                       | [ADR 0014](adr/0014-committed-development-credentials.md)                               | the conditions that ADR names                           |

### Argued here, because there is nowhere else

**One configured issuer base for the whole deployment.** The admin API
derives a token's expected `iss` from the request, the same way `/token`
mints it, because there is nothing configured to compare against — which
also forced the admin audience to a fixed URN rather than `${iss}/admin`
([p4c.md](phases/p4c.md) has that decision). `ODUDU_PUBLIC_BASE_URL` exists
already for mail links and the WebAuthn relying-party id, so the value is
half present. Replacing request-derived issuers everywhere changes how
`iss` is minted on every token, ID token and Logout Token, on the RFC 9207
parameter and in discovery, which is why P4c did not do it in passing.

- Trigger: **P12**, whose criterion now names it.

**Neither of the server's two outbound DNS lookups carries a deadline.**
`createLogoutDeliveryTransport`'s `defaultLookup`
(`apps/server/src/logout-delivery-transport.ts`) and
`defaultClientKeyLookup` (`apps/server/src/client-key-transport.ts`) both
call `node:dns/promises`'s `lookup` with no timeout, and the first ignores
the `AbortSignal` `sendLogouts` already started. The second sits on
`/token`'s `private_key_jwt` authentication and, since encrypted UserInfo
landed, on `/userinfo` — between a resource server's request and its
answer. Bound the lookup, and decide whether the two transports share one
answer and whether `/userinfo` needs a tighter timeout than `/token`'s.

- Trigger: **P11**, whose criterion documents a p99 for both endpoints and
  so cannot be met while either lookup is unbounded.

**A signed UserInfo response's `typ` is a private value.** `userinfo+jwt`
is registered nowhere; it exists to stop a UserInfo response being accepted
as an `id_token_hint`, which it was before.

- Trigger: an IANA registration for the media type, or a conformance suite
  objecting to the private one.

**Two refusals on the refresh path are exercised by no test.** The
post-rotation `resolveAudience` check is load-bearing only for ADR 0019's
revocation race — a revocation landing between the pre-flight and the
authoritative read — which no test drives. Separately, a refresh rotated
past its `exp_ceiling` (P4a) is genuinely refused, by
`refreshTokenRepository.consume`'s literal SQL `expires_at > now()`, but
that reads PostgreSQL's clock rather than the injected `Clock`: a
`FakeClock` moves every other time-dependent decision in the file and not
this one, so nothing short of a real wait demonstrates it.

- Trigger: whichever task next touches refresh rotation, for the first; for
  the second, a clock the refresh path controls end to end, or fixtures
  that can move the database's own.

**`client_oidc_config_tls_client_auth_needs_subject_dn` enforces `NOT
NULL`, not non-blank.** A row with `tls_client_auth_subject_dn = ''` passes
the CHECK, and `tlsClientSubject` only refuses a zero-length header. No
code path produces such a row — `parseClientMetadata` trims and rejects a
blank — so it is reachable only by a hand-written `INSERT`, the class the
`jwks`/`jwks_uri` mutual-exclusion constraint already accepts.

- Trigger: the next migration touching `client_oidc_config` for an
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

- Trigger for caching: CI exceeds roughly 5 minutes (likely **P4d**, when
  Playwright arrives).
- Trigger for filtering: slow suites dominate — **P8** SAML interop, **P9**
  policy evaluation, or the nightly conformance suite.

**Three clause-table judgements, none of them a fix.**
`docs/protocols/rfc6750.md`'s row "`scope` appears at most once" is
vacuous: it is cited to a name-agnostic grammar test and the server emits no
`scope` auth-param, so the row is true and holds nothing. Fifteen tests
share one clause id, `[RFC8705-2.1-03]`, while pinning different
requirements — a disabled client, a public client, the one-method rule, the
duplicate header, tenant isolation — and several are not §2.1 at all; the
undifferentiated id is the defect, and the missing table that surfaced it
is already fixed. `docs/protocols/rfc7662.md` points at a plan file for
when a class of rows was decided, where the durable pointer is this file or
a phase note.

- Trigger: whichever pass next reworks the traceability documents. Each is
  a coverage judgement rather than a defect, so none of them blocks a phase.

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
