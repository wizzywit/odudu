# Next

## Start here

**P0, P1, P2a, P2b, P3a, P3b, P4a, P4b, P4c, P4d and P4e are complete, and the
tenant rename is done. P4g has closed as release candidates, and only its
stable tag is left.** Phases are section 11 of
[the umbrella spec](superpowers/specs/2026-09-10-odudu-design.md), whose
"P4 became four phases, then five" subsection has the reasoning.

**P4g, the public release, shipped as `0.1.0-rc.1` to `rc.3`.** The stable
`0.1.0` is an owner step in `RELEASING.md` (the quick start run by hand on a
Mac, on Windows and on arm64, and the CLA tested from a second account), not
more phase work. What it built, and what the whole-phase review found, is in
[`docs/phases/p4g.md`](phases/p4g.md); the licences are in `LICENSING.md`.
What it placed on later phases is on
[the roadmap page](../apps/docs/content/en/roadmap.md).

**P4b, theming and client branding, is built.** Every server page and mail
wears a tenant's theme and a client's over it; the tenant chooses its languages
and wording, Arabic ships as the right-to-left language, and sign-out asks
first. What it found is in [`docs/phases/p4b.md`](phases/p4b.md). Its one owner
step is a reader of Arabic, in `RELEASING.md` before the stable tag.

**What is next, in this order: P4j, P5a, P4f, P4h, P4i, P5, P5b**, then the
phases the roadmap page lists as "Later", P6 to P14. The letters do not read
in execution order. P4j is a custom domain for each tenant, which left P4b
for its own phase; P5a the MCP server;
P4f self-service through a "me" API and application-initiated actions; P4h
console localization ([ADR 0043](adr/0043-localization-is-a-catalogue-a-negotiation-and-a-set-of-owners.md));
P4i the SDKs.

**`gate` is required on `main`**, beside `verify`, `container`,
`commit-messages` and `query-plans`. It covers every job, `e2e` and
`conformance` included, and passes a job skipped for a prose-only change
([ADR 0044](adr/0044-ci-runs-what-a-change-can-affect.md)).

**What the closed phases left that a later phase has to know.** The admin API
at `/admin/tenants/{tenant}/` is authorized per request by a capability role
on the tenant's `odudu-admin` client, and that client is confidential, so the
server needs `ODUDU_CONSOLE_CLIENT_KEY` to boot with the console on. The
audit trail has six kinds of row and a reader (`AUDIT_ACTIONS` in
`@odudu/domain-audit`); `request_id` in it is a correlation any caller sets,
not evidence (ADR 0037's third amendment). The VoiceOver checklist from P4d is
still to be run by a person ([p4d.md](phases/p4d.md)). The tenant rename
changed the wire: `realm` is `tenant` everywhere, the issuer included
([tenant-rename.md](phases/tenant-rename.md)).

Nothing below is a plan for any phase, only what it inherits and what is still
open.

### What each phase found while building it

The running records, split out of this file on 2026-09-17: P2b reached
1,873 lines here, of which the part describing where the project stood was 58.

- [P4b — theming and client branding](phases/p4b.md)
- [P4g — the public release](phases/p4g.md)
- [P4d — the admin console and the admin API it needs](phases/p4d.md)
- [P4e — authentication and token audit events](phases/p4e.md)
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

## What P4j, P4f and P4h inherit

**A console to build on, and the ways in.** The SPA talks to nothing but
`/console/api/session`, `/console/api/admin/*`, `/console/auth/login` and
`POST /console/auth/logout`; `gateway.request` is the one caller of `fetch`,
and a feature reaches it through `shared/transport`. A feature is five
layers behind one `index.ts`, built from the Instrument components in
`shared/view`, with a draft keyed by tenant and record, a rebase on a `412`
and an unsaved-changes guard. The lints that hold this, and what each cannot
see, are in [p4d.md](phases/p4d.md), "what building the features found".
P4h's catalogue replaces the console's English strings (ADR 0043); P4f's
self-service pages are server-rendered, not console areas.

**Two recovery-code gaps that need self-service.** A subject cannot
ask for a fresh set before running out, and nothing warns as the list gets
short. Both are named in P4f's exit criterion; `beginRecoveryCodes` already
replaces a set wholesale, so what is owed is a surface, not a mechanism.

**A new page or mail is themed by being written the way the others are.** A
renderer is a `*-html.ts` in a `view` layer with its kind in `page-kinds.ts`, and
`theme-reach.test.ts` fails until a theme reaches it; its text is a catalogue
entry, and `arabic-catalogues.test.ts` fails until Arabic has the same key. A mail
takes its look through `resolveMailBranding` in the transaction that queues it.
P4f's self-service pages and P4h's console strings follow these two rules; what a
theme may do and why is in [web-security.md](protocols/web-security.md).

**A custom domain is P4j's.** A tenant is resolved from the path today
(`/tenants/<name>`) and its issuer is `ODUDU_PUBLIC_BASE_URL` plus its name.
P4j resolves it from `Host` instead, which moves the issuer, cookie scope and
the WebAuthn RP ID. The design is in the P4b spec, section 3. Brand asset addresses are
content-hashed under the tenant's path, so they move with the issuer.

## What P11 and P12 inherit

**The image is published by a tag, and the rest of deployment is later.**
`release.yml` publishes a signed image with its contents listed from a `v*`
tag, and the base images are pinned by digest. Secrets are still environment
variables. Backup and restore guidance exists (`operating/backups.md`, run on
the quick start's stack) but is not yet proven by a restore and a login
against it, and the secret store is also owed (**P12**).
Multi-replica deployment is blocked on migration locking and on the
in-process bounds (throttles, the client-secret limiter, the registration and
reset limiters), all **P11**, which also owes the Helm chart or manifests.

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

| What is open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Where it is argued                                                                                | Trigger                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No scope means anything in particular at an audience; RFC 9068 §2.2.3 wants `scope` coherent with `aud`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [rfc9068.md](protocols/rfc9068.md), "Why §2.2.3 is accepted, not held"                            | **P9**, with the row below                                                                                     |
| `/introspect` answers every registered client alike: no per-resource scope narrowing, no "may introspect"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [rfc7662.md](protocols/rfc7662.md), "Two MAYs left `gap`"                                         | **P9**, with the row above                                                                                     |
| RFC 7523 has no clause table, so the clauses of an implemented RFC are untracked by the system built for it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [rfc7523.md](protocols/rfc7523.md)'s own header                                                   | **P13**                                                                                                        |
| The session cap is per browser and admits `cap + (k - 1)` under `k` concurrent logins, orphaning one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [ADR 0033](adr/0033-admitting-a-session-locks-the-tenant-row.md)                                  | **P4f**, wanting a session's device                                                                            |
| `CLAUDE.md` states an untagged-fence rule that `tests/docs/markdown.ts` cannot see, so no JSON response is byte-checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [p3b.md](phases/p3b.md), "`CLAUDE.md` states a rule its own tests forbid"                         | its own change; it untags every JSON transcript at once                                                        |
| Migrations are hard cutovers: Drizzle runs every pending migration in one transaction, so no index is built `CONCURRENTLY`, `0073`–`0075` add stored generated columns that rewrite their tables under lock, `0076` rebuilds an `audit_events` index without `CONCURRENTLY`, `0079` adds three more such columns to `users`, `0080`, `0081` and `0097` build indexes plain, and `0095` builds twenty-odd, four of them on `audit_events`, as `0099` builds a fifth, and `0100` three on `email_outbox`, whose `failed` mail read still sorts a tenant's unsent rows (about 100 ms at 1,000,000 unsent, an incident-sized backlog) | the umbrella spec's §5, "Migrations", and §11's P11 row                                           | **P11**, with rolling upgrades across replicas                                                                 |
| `audit_events` at 100,000,000 rows is one table with seven secondary indexes and per-tenant unbatched retention deletes; the query-plan check ran at a fifth of the subjects and a hundredth of the events, on one node                                                                                                                                                                                                                                                                                                                                                                                                           | `docs/phases/p4d.md`, "Server query plans", and §11's P11 row                                     | **P11**, partitioning by month and batched deletes                                                             |
| Tenant delete is one transaction cascading through every tenant table, `audit_events` included, so it holds locks as long as the tenant's audit trail is deep; no bound or timeout (`apps/docs/content/en/reference/transcripts/admin-paths/`, "Delete a tenant")                                                                                                                                                                                                                                                                                                                                                                 | the umbrella spec's §11, P11 row                                                                  | **P11**, a chunked, resumable delete                                                                           |
| Localization has its catalogue mechanism and the server pages' and mail's catalogues, English and Arabic, with a tenant's languages and wording; the console's extraction (**P4h**) remains, and the new-code rule is unenforced in the console until its lint lands                                                                                                                                                                                                                                                                                                                                                              | [ADR 0043](adr/0043-localization-is-a-catalogue-a-negotiation-and-a-set-of-owners.md)             | **P4b** and **P4h**                                                                                            |
| Logout's per-client opt-out of the confirmation is decided and built (P4b): off by default, only for a valid hint of that client matching the live session, never through Dynamic Registration                                                                                                                                                                                                                                                                                                                                                                                                                                    | ADR 0047                                                                                          | a client operator asks to skip it for a hint of another client or session                                      |
| The admin router validates a body before it authenticates, so an unauthenticated caller makes the server buffer up to 4 MiB on a theme `PUT` and reads schema details in a `400` where a `401` belongs                                                                                                                                                                                                                                                                                                                                                                                                                            | [p4b.md](phases/p4b.md), "Owed at phase close"                                                    | **P11**, with the other load bounds                                                                            |
| A passage in another language than a page's is not marked with its own `lang`; a client's base name has no language of its own to mark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [web-security.md](protocols/web-security.md), the WCAG 3.1.2 row                                  | a tenant states the language of a client's base name                                                           |
| No composite index serves the two-filter audit reads (actor and type, type and action); a 5 s timeout bounds them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [p4d.md](phases/p4d.md), "Server query plans"                                                     | **P11**, whose plan check at scale is the evidence                                                             |
| The console's failure ID is made in the browser and never sent, so an operator cannot search the server's logs for it; sending it with the route to a gateway endpoint that logs it would make it findable                                                                                                                                                                                                                                                                                                                                                                                                                        | [`docs/phases/p4g.md`](phases/p4g.md)                                                             | **P4h**, which reworks the failure screen's text and reports for the catalogue                                 |
| Two console dom tests (`gateway.test.ts`, `useWrite.test.tsx`) once failed alone under the root project; not reproduced on 2026-10-19 under `--project dom`, with and without the other file, or with every project                                                                                                                                                                                                                                                                                                                                                                                                               | [p4g.md](phases/p4g.md), "The console's theme choice reaches the server pages"                    | if it recurs: [p4g.md](phases/p4g.md), "CI runs what a change can affect"                                      |
| An address can be spent by anyone: three mails an hour per kind per address, and a repeat registration request replaces the address's pending row, so a link already mailed dies                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [ADR 0037](adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md), amendment 2026-10-26 | **P11**, when the limiter is shared across instances and can use more signals                                  |
| A person who confirms a "finish registration" mail they did not ask for gets the account its sender chose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [ADR 0037](adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md), amendment 2026-10-26 | **P4f**, registration flow: the confirm page can ask for more than a click                                     |
| Accounts that differ only by the case of their address may already exist, so `users.email_search` has no unique index; reconcile them, then add a partial unique index on `(tenant_id, email_search)`                                                                                                                                                                                                                                                                                                                                                                                                                             | [ADR 0037](adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md), amendment 2026-10-26 | **P4f**, credentials and account lifecycle, which owns account merge and cleanup                               |
| The Node major moves by hand: Node 24 to 26 once 26 is LTS and tested, by running the full CI, replacing `corepack` if Node drops it, amending ADR 0001 and moving `engines`, the Dockerfile and CI                                                                                                                                                                                                                                                                                                                                                                                                                               | [ADR 0001](adr/0001-typescript-on-node.md), amendment 2026-10-27                                  | **P12**, operations: a runtime move is deployment work, and no earlier phase changes what a deployment runs on |
| Committed development credentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [ADR 0014](adr/0014-committed-development-credentials.md)                                         | the conditions that ADR names                                                                                  |

### Argued here, because there is nowhere else

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

**A refresh past its `exp_ceiling` is refused by the database's clock, and
no test drives it.** `refreshTokenRepository.consume`'s literal SQL
`expires_at > now()` refuses it (P4a), but reads PostgreSQL's clock rather
than the injected `Clock`: a `FakeClock` moves every other time-dependent
decision in the file and not this one, so nothing short of a real wait
demonstrates it. Its sibling, the post-rotation `resolveAudience` check, is
now driven by `audit-token-refusals.int.test.ts`.

- Trigger: a clock the refresh path controls end to end, or fixtures that
  can move the database's own.

**`client_oidc_config_tls_client_auth_needs_subject_dn` enforces `NOT
NULL`, not non-blank.** A row with `tls_client_auth_subject_dn = ''` passes
the CHECK, and `tlsClientSubject` only refuses a zero-length header. No
code path produces such a row — `parseClientMetadata` trims and rejects a
blank — so it is reachable only by a hand-written `INSERT`, the class the
`jwks`/`jwks_uri` mutual-exclusion constraint already accepts.

- Trigger: the next migration touching `client_oidc_config` for an
  unrelated reason is where the tightened CHECK belongs.

**Affected-package-only CI filtering.** Turborepo and pnpm both support
`--filter='...[<ref>]'`, so no tooling change is needed. Not adopted:
skipping a package's tests carries "we did not run those tests" semantics
that caching, which landed in P4d, avoids. Typecheck, lint, boundaries and
unit tests stay always-full either way.

- Trigger: slow suites dominate — **P8** SAML interop, **P9** policy
  evaluation, or the nightly conformance suite.

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

- **Twelve administrative capabilities a gap audit against mature identity
  providers found the server lacking** (2026-09-29): more required actions,
  several sign-in flows, per-step authenticator settings and a
  breached-password check (**P4f**); translated pages and mail (shipped, with the console's extraction left to **P4h**); custom subject
  attributes (**P7**); fine-grained admin permissions (**P9**); per-client
  mappers (**P10**); a metrics endpoint (**P11**); key import and scheduled
  rotation (**P12**); client policies and admin impersonation (**P13**).
  Each phase's §11 criterion names its items, and
  [the roadmap page](../apps/docs/content/en/roadmap.md) lists
  them under a test that holds the two together.
- `tests/lint/production-guard-order.test.ts` compares source offsets and
  breaks on a rename or a helper extraction. A reasonable stopgap for the
  still-positional server-boot path, but its narrowness should be visible to
  whoever reads it next. **P12**, whose criterion sources secrets from
  somewhere other than the process environment and so reworks the boot
  sequence in `apps/server/src/main.ts` that the test pins by offset.

- **The audit trail can be rewritten by the serving role and nothing signs
  or chains it.** `audit_events` has no `REVOKE` or trigger making it
  append-only, so a compromised server could change a row. **P12**, whose
  hardening criterion owns a role that cannot, and a signed or chained trail.
- **Self-service credential gaps found in P4g.** A tenant cannot ask
  everyone to enrol a passkey. **P4f**, whose criterion owns the per-tenant
  sign-in settings.

### Recorded judgements, where the code stands and nothing is owed

- Six migration-filename citations under `docs/archive/plans/` are off
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
