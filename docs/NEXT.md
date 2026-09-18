# Next

## Start here

**P0, P1, P2a and P2b are complete. P3 was brainstormed on 2026-09-18 and
became two phases:** **P3a** — clients, registration and consent — and
**P3b** — sessions, logout and the token surface. P3a's spec is
[2026-09-18-p3a-clients-registration-consent-design.md](superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md);
its plan is next, and no P3a code exists yet. P3b gets its own brainstorm
and spec when P3a closes.

The split is recorded in section 11 of
[the umbrella spec](superpowers/specs/2026-09-10-odudu-design.md), along
with the estimate that forced it: two decisions the phase could not avoid —
concurrent sessions per browser, and moving the existing renderers onto the
page contract rather than only writing the consent screen against it — put
P3 at roughly 105–160 hours, larger than P2b. The seam is a one-way
dependency: every P3b clause reads client metadata P3a registers, and no
P3a clause reads anything P3b builds.

Every clause of P2b's exit criterion was driven against a running stack at
close, and section 11 of the umbrella spec records what was observed, what
could only be established another way (the two WebAuthn ceremonies, which
need a browser), and — separately — what P2b leaves behind that its
criterion never asked for. Section 17 of
[the phase spec](superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md)
lists every correction the phase made to its own plan, and the pattern they
share: almost all of them were claims about **this repository** — a table,
a migration number, a helper, a file path, a testing convention — rather
than about the design or a third party.

### Open decisions P3a's plan must settle

- **The `claims` request parameter is placed in P3a and named in no
  criterion.** `docs/protocols/oidc-core.md` sends three rows there —
  §2's Essential-Claim `auth_time`, §3.1.2.2's `sub`-with-a-specific-value,
  and the prose at line 600 — on the reasoning that the parameter needs the
  per-client machinery and consent that P3a builds. P3a's criterion does
  not mention it, which is exactly the failure section 11 catalogues five
  of: work placed in a phase whose criterion can be met without it. P3a's
  plan either names it in the criterion or moves it, and says which.
- **RFC 7592 client management is not in P3a.** Spike 4
  (`infra/conformance/README.md`) read the Dynamic OP plan's own source at
  `release-v5.1.36`: no module `OIDCCDynamicTestPlan` runs touches
  `registration_access_token` or `registration_client_uri`, and none
  exercises a GET, PUT or DELETE against a client configuration endpoint.
  P3a ships RFC 7591 registration alone; registered-client management stays
  where `docs/request-paths.md` already places it, in P4.
- **Decided 2026-09-18: the Dynamic OP plan cannot pass, and P3a's
  criterion no longer claims it will.** The plan's discovery check, when
  `ClientRegistration` is `dynamic_client` — true for every module group it
  defines — requires `response_types_supported` to contain `code`,
  `id_token` **and** `token id_token`, all three
  (`minimumMatchesRequired = SET_VALUES.length`). OAuth 2.1 removes the
  flows behind the last two and ADR 0016 records that decision, so a
  passing run was never available. P3a's criterion is now "the OIDF Dynamic
  OP plan **runs reproducibly with every divergence confirmed as a recorded
  decision**", which is verbatim the treatment P1's criterion already gives
  Basic OP. The ADR is written by the task that runs the plan, from the
  run's own evidence, as P1 did.

  **P3b inherits the same question and should ask it earlier.** Its
  criterion will name a suite plan too; read what that plan actually demands
  before writing the criterion, not after. A criterion that cannot be met
  is worth catching in a two-hour spike rather than in a phase's last task.

- **Decided the same day: the JWKS fetcher is P3a's after all.**
  `OIDCCRegistrationJwksUri` is one of the plan's own registration modules
  and serves the key set over HTTP itself, so the OP must dereference
  `jwks_uri` during the run. A controller ruling had deferred the fetcher to
  P3b on the grounds that nothing in P3a consumed one; the spike reversed it,
  which is the condition that ruling named for its own reversal. Registration
  still validates a `jwks_uri`'s shape without dereferencing it — the fetch
  happens where the keys are used.

- **What the spike found that needs nothing:** none of
  `backchannel_logout_supported`, `frontchannel_logout_supported`,
  `userinfo_encryption_alg_values_supported`, `introspection_endpoint` or
  `revocation_endpoint` is touched by any module the plan runs, and
  `userinfo_signing_alg_values_supported` is skip-if-absent rather than
  required — so P3a's rule that it registers logout and UserInfo metadata
  without advertising any of it costs nothing against the suite. The plan's
  two sector modules self-skip, because they require
  `subject_types_supported` to contain `pairwise` and Odudu publishes
  `['public']`.

### What P3a and P3b inherit from P2b

**A session that is read, and one per browser.** `/authorize` resolves the
`{realm}-session` cookie through `sessionRepository.liveById`, scoped by the
realm's own `sso_session_idle_seconds` (1800) and `sso_session_max_seconds`
(36000), and `decideReuse`
(`packages/protocol-oidc/src/usecase/session-reuse.ts`) turns that plus
`prompt` and `max_age` into reuse, a fresh authentication, or a refusal. The
cookie holds **one** session id, so a second login in the same browser
replaces the first. That is the limitation `prompt=select_account` runs
into, and the reason its three clause rows in
`docs/protocols/oidc-core.md` read `deferred: P3b`: account selection needs
concurrent sessions, which reshapes this read rather than extending it. P3a
already renders a user-choice page during `/authorize` for consent, which is
the same surface.

**A `sid` claim, so a session has a name a client can say.** Every
session-backed access token and ID token carries it (Back-Channel Logout
§2.1), assembled straight into the envelope rather than through
`ClaimMapperRegistry` so no mapper can overwrite it, and an `offline_access`
grant omits it because it has no session. That is what makes P3b's
front-channel and back-channel logout addressable at all: a logout token
names a `sid`, and `tokenGrantRepository.bySession` and `revokeForSession`
are already the read and write sides of it.

**Revocation that an access token does not feel.** Ending a session revokes
its grants, and `refresh-rotation.ts` checks the session's own liveness as
well as the grant's `revoked_at` — but an `at+jwt` is self-contained and
nothing consults anything before accepting one, so a logged-out user's
access token works until its `exp` (at most an hour). RFC 7662
introspection is what makes revocation real inside that window, and it is in
P3b's criterion for that reason rather than as a checklist item.

**Three gaps filed to P3 during this phase, all recorded rather than
remembered.** A rate limit on `client_secret` attempts at `/token` — RFC
6749 §2.3.1's client half, now its own `deferred: P3a` row and named in
P3a's
criterion. The `prompt=select_account` rows above. And `/authorize` still
verifies an `id_token_hint` with `AUDIENCE_UNCHECKED`, which the per-client
audience configuration P3b's criterion names is the place to close.

### What each phase found while building it

The running records, split out of this file on 2026-09-17: P2b reached 1,873
lines here, of which the part describing where the project stood was 58.

- [P2b — credentials, MFA and the session lifecycle](phases/p2b.md)
- [P0, P1 and P2a](phases/p0-p1-p2a.md)

Nothing in them is current position. They are kept because they record what
turned out to be **wrong** during a phase, which no spec, plan or close note
keeps — and because the pattern across them is worth reading before
brainstorming the next one: almost every correction was a claim about this
repository rather than about the design.

**What belongs in this file:** where the project stands, what the next phase
inherits, and decisions that are still open. Not what a finished phase
discovered. If a section here is addressed to a phase that has closed, it is
overdue for a decision or a move, not for another paragraph.

## Login page theming — decided in P3a, delivered by P4b

**Closed on 2026-09-18.** P2 left this open and the note that carried it
asked for a decision "when three pages exist"; P2b shipped past that without
one, which is the failure the rule at the top of this file describes. P3a's
brainstorm settled it.

**A theme replaces a body fragment and a token set. Never the document.**
The document is where the CSP nonce, the framing defence and the
`auth_session_id` live, and P4b's criterion requires an _untrusted client_
to supply styling — so a contract that lets a client replace the document is
a contract that lets a client replace the password field. `RenderedPage`
grows `body` and `title` alongside `html`; P4b substitutes a shell around
them without touching a renderer. ADR 0030, written in P3a.

Two things found while deciding it, both now P3a's work:

- **The retrofit is 26 render functions across 10 files, not seven pages.**
  This file and `CLAUDE.md` both said seven, which counted pages a user
  navigates to rather than functions a contract must cover. Both are
  corrected in the increment that does the retrofit.
- **`CLAUDE.md`'s "every page leaves through `sendHtml`" is already
  false.** `packages/account/src/view/verification-html.ts:14` is a second
  exit that hand-duplicates the policy — correctly, since `html-response.ts`
  is a protocol package's internal and no feature reaches into another's
  internals. The two have diverged: one sets `referrer-policy: no-referrer`
  and the other does not. P3a puts the complete header set behind one pure
  `pageHeaders` in `kernel`, which is where `RenderedPage` already lives and
  the only module all three page-owning packages may import. `sendHtml`
  itself cannot move there — it takes a `FastifyReply`, and `kernel` depends
  on `uuidv7` and `zod` only — so the promise P3a's criterion makes is **one
  authority for a page's headers, enforced by a test**, not one exit.

## Recovery codes run out into a fresh set, not into a lockout

Spending the last unspent code owes `generate-recovery-codes` again, in the
login that spent it — the gate reads pending actions after `advance`, so the
page appears in that login rather than the next one. That is Keycloak's own
answer to the same moment: its
[recovery codes](https://www.keycloak.org/2025/10/recovery-codes) re-present
the setup as the last code is used.

What it replaced was a dead end. The guard that owes the action read
`listFor(subjectId, 'recovery-code')`, which does not filter on `usedAt`, so
ten spent codes were still ten rows and a subject who ran out owed nothing —
with no self-service re-issue, the only way back was an operator deleting the
rows, and there is no admin surface for that until P4. It now counts unspent
rows, and the count is the one thing both callers read.

**Two of Keycloak's three are still missing, and both need the account
console.** A subject cannot ask for a fresh set _before_ running out, and
nothing warns as the list gets short — Keycloak warns below a configurable
threshold, four by default. Both are now named in **P4**'s exit criterion
rather than covered by "an account console for self-service", which is
unfailable as written. `beginRecoveryCodes` already replaces a set wholesale,
so what P4 owes is a surface, not a mechanism.

## Realm settings have a command; two client writes do not, by design

`odudu seed realm --name <realm> --set <name>=<value>` applies any of the
twenty-one realm settings, repeatable, named by the column names the schema
and `docs/request-paths.md` already use. All five passages that flipped a
realm setting with `psql` now run it, and `README.md`'s three claims that no
flag existed are gone — one of them had been wrong before this, since
`seed client --web-origin` already existed.

The validation lives in `packages/domain-realm/src/service/realm-settings.ts`
rather than in the CLI, so P4's admin API inherits the name-to-column map and
the coercion rather than growing a second one. **Ranges are deliberately not
there**: they are CHECK constraints (migrations 0028, 0035, 0041), and
`apps/server/tests/seed.int.test.ts` proves the CLI cannot write past one —
the repository's idiom that a policy no writer may bypass belongs at the
database, and the seed CLI having no development override matches what it
already does for the password policy.

**Two `client_oidc_config` writes stay, and the reason is a decision rather
than a gap.** `seed client` registers `--post-logout-redirect-uri` and
`--web-origin` as it _creates_ a client and refuses one that already exists,
because a re-run that quietly widened a registered redirect list is how an
allowlist grows by accident. Both remaining sites change a client seeded
earlier in the document, so they stay `psql` until the admin API can do it
under authentication and audit — **P3a**, whose criterion already names
registered per-client logout URIs.

**Asymmetry worth knowing before P4 builds on it:** `seed realm --set`
changes an existing realm, `seed client` will not change an existing client.
That is not an oversight — a realm's settings are configuration, while a
client's redirect and origin lists are its security-relevant registration —
but an admin API that treats both the same way would be wrong in one of the
two directions.

Two `UPDATE`s in the document are not this subject at all:
`user_credentials.created_at` ages a password ninety days and
`authentication_sessions.*` ages rows for the retention pass. No command can
make a row older than the process running it.

## Deployment gaps, for whoever asks next

`README.md` now has a Deploying section stating plainly that the container
image is the artifact and the compose file is development-only. What it lists
as missing, in the order it would matter: there is no published image or
release process; secrets are environment variables and nothing more; there
is no backup or restore guidance; there is no way to rotate a signing key
once one is in the field; and multi-replica deployment is blocked on
migration locking and a shared session cache, both P11. The protocol surface
itself is no longer among them — P1 shipped it, and `README.md` describes
what it serves.

**All of those now have a phase, as of 2026-09-14.** The first three became
**P12**, Operational readiness, appended to the roadmap rather than folded
into P11 — same audience, different work, and an exit criterion that can be
failed is worth more than a wider one that cannot. Signing-key rotation went
to P4. P12 sits last in the table and is not last in dependency order:
publishing an image depends on no other phase and is the prerequisite for
anybody deploying this at all, so it is the piece to pull forward first.

The fully-local path (your own Postgres, no Docker) needs exactly one
bootstrap statement — `CREATE USER odudu_svc` — because migration 0001
creates `odudu_app` and 0002 grants membership when the serving role already
exists. Verified against a bare PostgreSQL 17 with no init scripts: the
server boots, migrations apply, and the serving role sees zero rows through
row-level security rather than a permission error.

## Recorded decisions with trigger conditions

**Affected-package-only CI.** Turborepo and pnpm both support
`--filter='...[<ref>]'` — changed packages plus their dependents — so no
tooling change is needed to adopt it. Not adopted now: CI runs in about 50
seconds end to end, and `test` is a root-level `vitest run` rather than a
per-package Turbo task, which is a prerequisite. When adopting, prefer
Turborepo **caching** first: an unchanged package replays its cached result
instead of being skipped, which gives the same wall-clock win without the
"we did not run those tests" semantics that a wrong graph turns into an
untested merge. Apply filtering only to genuinely slow jobs, keep typecheck,
lint, boundaries and unit tests always-full, and set `globalDependencies` at
the same time so a root config or lockfile change still forces everything.

- Trigger for caching: CI exceeds roughly 5 minutes (likely P4, when
  Playwright arrives).
- Trigger for filtering: slow suites dominate — P8 SAML interop, P9 policy
  evaluation, or the nightly conformance suite.

**Committed development credentials.** Kept inline deliberately; see
ADR 0014 for the reasoning, the three controls that make it acceptable, and
the conditions under which to revisit.

## Deferred from the final review

- **Closed, differently than this item expected.** The snapshots are not
  maintained at all — `drizzle/meta/` holds two of fifteen migrations — and
  `db:generate` has been retired rather than repaired: pointing it at every
  table would have meant reconciling generated SQL against fifteen
  hand-written migrations carrying RLS policies, thirteen CHECK constraints
  and guarded DO blocks that no `pgTable` expresses, and declaring the
  policies so it could see them emits the 42710 this item describes. SQL is
  the source of truth, `packages/db/README.md` says so, and
  `packages/db/tests/schema-drift.int.test.ts` compares the declarations
  against a freshly migrated database. `drizzle-kit` remains an unused
  devDependency of `packages/db`; removing it rewrites `pnpm-lock.yaml`,
  which is worth doing on its own, away from other work.
- `ODUDU_TRUST_PROXY=` (a bare key) now refuses boot rather than defaulting
  off — correct by strictness, but a new way for a previously-booting
  environment to fail.
- The boundary suite's negative control filters a fixture with no imports at
  all, so it cannot demonstrate that `service-is-a-leaf` is not over-broad.
  A service importing another service would.
- The `res` serializer still emits all reply headers with only `set-cookie`
  denylisted — the remaining instance of the pattern removed on the request
  side.
