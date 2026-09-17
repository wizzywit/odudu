# Next

## Start here

**P0, P1, P2a and P2b are complete. P3 — realms, clients, consent and
dynamic registration — is next, and has not been brainstormed.** Every
clause of P2b's exit criterion was driven against a running stack at close,
and section 11 of
[the umbrella spec](superpowers/specs/2026-09-10-odudu-design.md) records
what was observed, what could only be established another way (the two
WebAuthn ceremonies, which need a browser), and — separately — what P2b
leaves behind that its criterion never asked for. Section 17 of
[the phase spec](superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md)
lists every correction the phase made to its own plan, and the pattern they
share: almost all of them were claims about **this repository** — a table,
a migration number, a helper, a file path, a testing convention — rather
than about the design or a third party.

### What P3 inherits from P2b

**A session that is read, and one per browser.** `/authorize` resolves the
`{realm}-session` cookie through `sessionRepository.liveById`, scoped by the
realm's own `sso_session_idle_seconds` (1800) and `sso_session_max_seconds`
(36000), and `decideReuse`
(`packages/protocol-oidc/src/usecase/session-reuse.ts`) turns that plus
`prompt` and `max_age` into reuse, a fresh authentication, or a refusal. The
cookie holds **one** session id, so a second login in the same browser
replaces the first. That is the limitation `prompt=select_account` runs
into, and the reason its three clause rows in
`docs/protocols/oidc-core.md` read `deferred: P3`: account selection needs
concurrent sessions, which reshapes this read rather than extending it. P3
already renders a user-choice page during `/authorize` for consent, which is
the same surface.

**A `sid` claim, so a session has a name a client can say.** Every
session-backed access token and ID token carries it (Back-Channel Logout
§2.1), assembled straight into the envelope rather than through
`ClaimMapperRegistry` so no mapper can overwrite it, and an `offline_access`
grant omits it because it has no session. That is what makes P3's
front-channel and back-channel logout addressable at all: a logout token
names a `sid`, and `tokenGrantRepository.bySession` and `revokeForSession`
are already the read and write sides of it.

**Revocation that an access token does not feel.** Ending a session revokes
its grants, and `refresh-rotation.ts` checks the session's own liveness as
well as the grant's `revoked_at` — but an `at+jwt` is self-contained and
nothing consults anything before accepting one, so a logged-out user's
access token works until its `exp` (at most an hour). RFC 7662
introspection is what makes revocation real inside that window, and it is in
P3's criterion for that reason rather than as a checklist item.

**Three gaps filed to P3 during this phase, all recorded rather than
remembered.** A rate limit on `client_secret` attempts at `/token` — RFC
6749 §2.3.1's client half, now its own `deferred: P3` row and named in P3's
criterion. The `prompt=select_account` rows above. And `/authorize` still
verifies an `id_token_hint` with `AUDIENCE_UNCHECKED`, which the per-client
audience configuration P3's criterion names is the place to close.

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

## Login page theming — P2 did not decide it, and P3 inherits the question

The design spec lists `ThemeProvider` among `kernel`'s registries (section 8),
and theming is delivered by **P4b** — split out of P10 on 2026-09-17, because
P10's criterion tested provider loading and would have passed with no theming
at all. Nothing is in place yet: the registry does not exist, and the pages
are hardcoded HTML, dependency-free with every interpolated value escaped.

Those lines are not the risk. The risk is page count, and it has already
grown past what this note first estimated: P2b shipped seven page renderers,
P3 adds a consent screen, P4 the consoles. Each one written the same way, by
a different task, leaves P4b retrofitting a contract across pages that never
shared a shape. The spec's promise that extensibility is "additive rather
than a rewrite" is made about modules, and does not extend to pages on its
own.

**P2 closed without deciding it, and the condition this note set has been
passed rather than met.** It asked for a decision "when three pages exist and
the real variation is visible", and guessed the eventual count at six. P2b
shipped seven page renderers — `authorize-html`, `logout-html`,
`required-action-html`, `totp-enrolment-html`, `passkey-enrolment-html`,
`recovery-codes-html` and `update-password-html` — so the variation is now as
visible as it is going to get before P3 adds the eighth.

Part of the seam appeared on its own, which is the one piece of new
information: `html-response.ts` now takes a `RenderedPage` of
`{ html, script }` rather than a string, because the passkey pages needed a
CSP nonce that only the renderer could know. That is a page contract arrived
at for an unrelated reason, and it is the obvious thing for a theming
contract to extend rather than replace.

The question itself is unchanged and still open: what is a theme allowed to
replace — the whole document, a body fragment, or only styling? It now has a
second consumer and a delivery phase. On 2026-09-17 theming and client
branding were split out of P10 into **P4b**, immediately after the consoles,
and the criterion now requires **a client** supplying its own styling and
images rather than only a realm supplying a theme (section 11, "Theming was
named but never required"). So the contract is decided in P3, beside the
consent screen, and delivered in P4b — deciding it in the phase that
delivers it would mean writing the consent screen the old way first. A contract that fits a trusted operator's theme and not
an untrusted client's stylesheet is the wrong contract, and the difference is
that the second one is an authorization decision about a page carrying a
password field and a CSRF token. Deciding it
in P3 costs nothing but the decision; deferring it again costs the console's
pages too, and P4b then retrofits across nine rather than building against a
contract that already exists.

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
