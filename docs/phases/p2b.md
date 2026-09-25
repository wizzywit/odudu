# P2b — credentials, MFA and the session lifecycle

What the phase found, in the order it found it (newest first). Split out of
`docs/NEXT.md` when that file reached 1,873 lines and the part describing
where the project actually stands had become three per cent of it.

The phase's own argument is in
[its spec](../superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md)
and [its plan](../superpowers/plans/2026-09-15-p2b-credentials-mfa-sessions.md);
section 11 of [the umbrella spec](../superpowers/specs/2026-09-10-odudu-design.md)
carries the close note. This file is the running record those three do not keep:
what was discovered while building, including the things that turned out to be
wrong.

### A second-factor bypass closed after P2b's whole-branch review, 2026-09-17

**A required action was satisfiable by a session bound by only the first
factor.** `advance` binds the subject as soon as a factor identifies
somebody — deliberately, so a later factor cannot hand the login to
somebody else — and the required-action route read that binding as its
whole authorization. A password alone therefore reached
`generate-recovery-codes`, whose page prints ten codes that stand in for
the second factor, and the state that made it reachable is one closed tab:
completing `configure-totp` owes the codes, and the page that issues them
sits behind the very factor being enrolled.

Two things were missing, and both are now enforced where submissions are
judged rather than where pages are chosen. `authentication_sessions` carries
`authenticated_at` (0044), written by `advance` on every attempt that gets
past the subject binding and **cleared** when a step remains — completing an
enrolment makes a step apply that did not a moment ago, so completion cannot
be a latch — and `authenticatedSubject` requires it, plus an unconsumed
session. And the submission is compared against `nextRequiredAction(owed)`
rather than membership, so the order that keeps an expired password from
enrolling a second factor binds here too.
`packages/protocol-oidc/tests/required-action-gate.adversarial.int.test.ts`
drives the attack through the real routes; each refusal there asserts an
effect — no codes on the page, none in the database, the saved set
unchanged — because a status code alone cannot tell a refusal from a
regeneration. The clear-on-challenge half is pinned separately, in
`packages/authn-flows/tests/totp-login.int.test.ts`, because reducing that
write to a latch left every attack test green.

**What P3 will meet here.** `authenticated_at` is a snapshot taken at the
last `advance`, so a factor that becomes applicable **out of band** — a TOTP
enrolled from another session, a tenant flipping `otp_required` — leaves a
live session recorded as complete until it is next re-run. It is bounded by
the authentication session's own lifespan, and no factor is bypassed by it:
whoever holds such a session completed a login when the flow had nothing
else to ask. Re-deriving applicability on every read of the column is the
alternative, and it costs the flow's two queries on a path that currently
costs one row read. Worth revisiting when P3 reshapes the `/authorize`
session read it sits beside.

### What re-running every transcript found, 2026-09-17

`docs/request-paths.md` promises that every command in it was executed and
every response is real output, and the phase-close pass re-ran all of it —
not only the sections P2b added. Thirteen transcripts were stale or
unreproducible, in four shapes worth naming because three of them look
fine:

- **A ` ```html ` fence lets Prettier rewrite the response.** Twelve blocks
  were reformatted markup — `<meta charset="utf-8">` shown as
  `<meta charset="utf-8" />`, indented — so the bytes a reader saw were the
  formatter's. **A response fence carries no language tag**, and the
  document's own preamble now says so.
- **Output captured on a stack the document does not describe.** An
  unscoped `select … from login_failures` printed one row where a faithful
  run prints two; the `client_oidc_config` listing printed two clients where
  a faithful run has eleven, and the prose leans on exactly that output; the
  retention counts needed a stack driven only through Path A; the throttle's
  ten `200`s needed `reset_password_allowed` on a tenant the document never
  turns it on for; and the lockout's second run needed a subject with no
  failures behind it, which the run shown above it makes impossible. Each
  now scopes its query or states its precondition.
- **Prose that outlived the behaviour.** The session cookie was described as
  "12 hours" with "nothing reads this cookie yet"; the `prompt=none` row
  said no session is ever reused; "Nothing is ever deleted" survived the
  reaper. `tests/docs/session-lifespans.test.ts` is new, and ties both
  lifespans in both documents to migration 0028's own `DEFAULT` clauses —
  and fails if either document calls the session twelve hours again.
- **A transcript one revision behind the server.** The logout `GET` omitted
  the `set-cookie` and `cache-control` it now returns; four decoded ID
  tokens showed a member order the server does not emit; a groups access
  token predated `sid`; the duplicate-address refusal is a list item now,
  not a paragraph.

Two claims the document asserted can now be shown instead: `reap` and
`send-mail` refusing with `ODUDU_APP_DATABASE_URL` absent (`env -u`, since
`-e VAR=` is a different refusal — an unparseable URL the config schema
rejects first), and both session lifespans, each moved on its own so the
ceiling cannot pass for the idle window.

**Mail is off the request path, and P2a's reset timing oracle is closed.**
Address verification, self-registration and password reset each write their
message to `email_outbox` (0043) in the same transaction that mints the
token it carries, and answer. Nothing in a request speaks to a transport,
so an address with an account costs one `INSERT` more than one without
rather than an SMTP round trip more —
`packages/account/tests/reset-timing.int.test.ts` makes the adapter take two
seconds and asserts both answers inside a second, that nothing was sent
during either, and that the message is nevertheless queued: an assertion
about an absence needs a companion asserting the presence of what should
have happened instead. Before the move, that test failed by 2011 ms, which
was the oracle.

**The sender is the second scheduled pass, and it deliberately takes no
lock.** `sendPending` (`packages/email/src/usecase/send-pending.ts`)
enumerates tenants on the owner connection — the queue cannot be read to
find out whose mail is in it, since the policy keys on `app.tenant_id` — and
claims per tenant on the serving one under `SET LOCAL`, in one
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` that counts the
attempt and leases the message for five minutes. Two senders that meet take
different messages and both make progress, which is strictly better than
the reaper's one-at-a-time exclusion; the reaper needs its lock because its
correctness needs one pass at a time, and this does not. `odudu send-mail`
is the command, `apps/server/src/modules/outbox.ts` the schedule
(`ODUDU_OUTBOX_INTERVAL_SECONDS`, 15), and both refuse without
`ODUDU_APP_DATABASE_URL` for the reason `reap` does.

**A permanently failed message has no `failed_at`, so retention reads the
attempt budget.** `email_outbox` is reaped on two windows: delivered plus
`ODUDU_RETENTION_EMAIL_SENT_SECONDS` (a week), and — for a message that
spent `ODUDU_OUTBOX_MAX_ATTEMPTS` without arriving —
`ODUDU_RETENTION_EMAIL_FAILED_SECONDS` (thirty days) measured from
`next_attempt_at`, the instant the sender would next have tried, so the
window runs from the last attempt rather than from when the message was
queued. Nothing an operator has not had a chance to read is deleted: a
message still inside its retry schedule, and one never attempted, are not
the pass's business at any age. The standing forcing function
(`apps/server/tests/reap.int.test.ts`, the `information_schema.columns`
sweep) went red on `email_outbox` the moment the migration landed and
before the rule existed, which is the mechanism working as designed.

**`odudu reap` exists, and retention is now arithmetic rather than a
warning.** `apps/server/src/cli/reap.ts` deletes what no decision can still
read, in every tenant, in one transaction holding
`pg_try_advisory_xact_lock`; `node dist/main.js reap` prints a per-table
report and a skipped pass says so rather than reporting zeros. Six
`ODUDU_RETENTION_*` windows, all defaulted; **`refresh_tokens` has none and
cannot be given one**, because a refresh token is retained for the life of
its grant family, and `login_failures` has none because its bounds are the
tenant's own. ADR 0021's amendment of 2026-09-16 carries the numbers, the
`token_grants.created_at` derivation and the ordering.

**Three things in that pass are correctness rather than tidiness.** The
rows referencing a grant are deleted **before** the grant, because
`refresh_tokens` cascades from it and a cascade deletes rows the report
never counts. Sessions are deleted **last**, and only when no grant
references them at all — the `ON DELETE SET NULL` on
`token_grants.session_id` is never reached, since nulling it promotes a
session-bound grant to an offline one. And a family with a still-usable
refresh token is not deleted however old it is, so an offline window is a
floor on retention and never a ceiling on the credential.

**`login_failures` needed both bounds, and the second is the one that
matters.** A pass keyed on the quiet period alone deletes the row holding a
lock in any tenant whose `brute_force_max_lockout_seconds` outlasts its
`brute_force_failure_reset_seconds` — which `tenants_brute_force_bounds`
permits, because it relates neither to the other. The integration case pins
the pathological tenant, not a default one: against defaults the broken
condition passes.

**The command refuses to reap on the owner connection.** `reap` requires
`ODUDU_APP_DATABASE_URL` in every environment, not only production: the boot
guard that demands it is never reached by a CLI branch, and the owner must
bypass row-level security for the tenant enumeration, so falling back to it
would run every delete with the policy switched off — N unscoped passes for
N tenants, and ADR 0021's "the policy is the scoping" made false in the
document that says it. Both roles are asked of `pg_roles` rather
than assumed — the listing role must escape row-level security, the serving
role must not, and a serving role that escapes it is the same property
failing for a configuration reason instead of a code one. An empty tenant
list is reported as "no tenant was enumerated" rather than as a clean pass.

**Now scheduled, and that is the codebase's first background loop.**
`apps/server/src/scheduler.ts` is an interval, its jitter, a call, a
`catch` that logs and a `stop` that awaits the pass in flight — no lock of
its own, because `withEachTenantExclusive` already takes one and a second
key would break the guarantee rather than strengthen it.
`apps/server/src/modules/reap.ts` wires it behind the `database` module, at
`ODUDU_REAP_INTERVAL_SECONDS` (3600) plus a tenth as jitter, with
`ODUDU_REAP_ENABLED=false` for a deployment that runs the command
externally. Without `ODUDU_APP_DATABASE_URL` the schedule **declines to
start** and logs once, rather than throwing `reap_requires_app_database_url`
every hour forever; production still refuses to boot. ADR 0024 and
CLAUDE.md's "Background work" carry the convention, which the next
scheduled pass follows.

**The per-origin throttle lands, and brute-force authority is now split on
purpose.** `slidingWindow` (`apps/server/src/throttle.ts`) is a window per
key in this process's memory; an `onRequest` hook in
`apps/server/src/app.ts` applies it, keyed on `request.ip`, to exactly
three routes — the sign-in submission, registration and the reset request —
at `ODUDU_THROTTLE_LIMIT` (10) per `ODUDU_THROTTLE_WINDOW_SECONDS` (60),
shared across all three rather than one budget each. Over budget answers
`429` with `Retry-After` and an empty body. **`onRequest`, not the plan's
`preHandler`**: both precede the Argon2id cost, and this one also precedes
the body parse, with nothing in the decision needing a body. It is also
what keeps the refusal from being an oracle — nothing has looked an account
up when it fires, so the refusal cannot vary with whether the address was
one the tenant knows, which the integration suite asserts by comparing a
known address's `429` against an unknown one's byte for byte.

**A refused request is not recorded**, so retrying does not extend the
wait — the opposite of an attempt during an account lockout, deliberately:
that mechanism protects a credential and this one issues a budget. The key
map is bounded at `MAX_THROTTLE_KEYS` (10 000) and evicts the
**least-recently-seen** key: eviction by insertion order would throw away
the attacker being throttled, since that key was inserted first, and hand
back a fresh budget at every ceiling. A key whose requests have all aged
out is dropped without waiting for the ceiling, one per call. The ceiling
is asserted by `size()` after thirty thousand distinct keys, because a
limiter keyed on caller-chosen input is a memory-exhaustion vector of its
own unless the eviction is real.

**The maximum password length went where the brief did not say.** The plan
named `packages/contracts/src/`, which holds no password field and is not a
dependency of `@odudu/account`. Passwords are read from form bodies at four
sites, and the tempting home — `evaluatePassword`, which already owns
`minLength` — would have missed the one that matters: the login POST
_verifies_ rather than evaluating, so a bound stated only there leaves
every attempt on the attacker-controlled route paying an Argon2id
verification for input of any length. So `readPasswordField`
(`packages/kernel/src/password-field.ts`) caps it at 256 code points at
every read, and `evaluatePassword` carries the same rule as well — the seed
CLI reads no form, and a password it accepted but the login form refused
would be one nobody could sign in with. Over-long input is refused, never
truncated. Not a tenant setting: it bounds work rather than shaping
passwords, and ASVS 2.1.2 permits denial above 128, so 256 refuses no
passphrase anybody types.

**Two limitations are stated because they cannot be shown.** The window is
per instance, so N replicas admit N times the budget — accepted, because
the throttle protects this process's CPU while the property that must hold
globally is the lockout's, in Postgres; there is no load balancer in this
repository to demonstrate it against. And the key is `request.ip`, so with
`ODUDU_TRUST_PROXY=true` a proxy that _appends_ to `X-Forwarded-For` rather
than overwriting it leaves the key client-controlled and the throttle
decorative. `infra/conformance/proxy/nginx.conf` now sets
`X-Forwarded-For $remote_addr` — it had set every other `X-Forwarded-*`
header and passed this one through — and the conformance stack raises
`ODUDU_THROTTLE_LIMIT`, since the whole OIDF suite arrives from the proxy's
single address. ADR 0023 holds the reasoning and the rejected alternative
(both halves in Postgres, at the cost of a write on every request to a
throttled route, exactly when the database can least absorb it).

**Two transcripts in `docs/request-paths.md` were re-run rather than
re-worded.** The lockout's bursts are fifteen submissions in a minute from
one address, which the new default refuses, so that section now says it was
captured with `ODUDU_THROTTLE_LIMIT=1000` and the stack passes the variable
through. Re-running also exposed a claim that had never been reproducible:
the eight-submission digest covers a response carrying `auth_session_id`,
so it differs per parked request — the property is that all eight agree,
which the document now says.

**Brute-force lockout lands, and closes the last `deferred: P2` clause row
by splitting it.** Migration 0041 adds `login_failures` — one row per
subject, keyed `(tenant_id, subject_id)` with a composite foreign key onto
`subjects (tenant_id, id)`, RLS enabled and forced with its own policy — and
four `tenants` columns bounded by `tenants_brute_force_bounds`:
`brute_force_max_failures` (5), `brute_force_lockout_seconds` (60),
`brute_force_max_lockout_seconds` (900) and
`brute_force_failure_reset_seconds` (43200). **On by default, alone among
this phase's tenant switches**, because RFC 6749 §2.3.1 is a MUST and a MUST
that ships off is not held. `nextLockout` in `@odudu/domain-identity` is the
whole of the arithmetic; `isLockedOut` is the read side, with the exclusive
boundary every other expiry here uses. A missing row reads as nobody's
failure and nobody locked — the only answer that does not refuse every
first login in the tenant — but `flowSettings` still raises rather than
defaulting on a missing tenant row, so a policy is never invented.

`loginFailureRepository.recordFailure` is a compare-and-swap with a bounded
re-read: the count it observed is the `ON CONFLICT DO UPDATE`'s `WHERE`, and
a zero-row result means a concurrent attempt committed a failure from the
same number, so it re-reads and re-applies rather than overwriting it with
the same count. Four concurrent wrong passwords reach `failure_count = 4`;
removing that one predicate takes it to 2, which is what the test is for.
Exhausting the five retries means **this** attempt was not counted — the
others were — so it is reported as `contended` rather than folded into the
`no_subject` an unknown username gets: one is ordinary and the other is
contention worth knowing about. Six concurrent writers each end `recorded`,
which the count alone could not have shown.

The row is inserted **from an RLS-scoped `SELECT` on `subjects`** rather
than from a tenant id the caller passes, which is what lets the login path
key every read and write on `DUMMY_SUBJECT_ID` for an unknown username: the
statement runs identically, writes nothing, and violates no foreign key
there would be no safe place to catch. Measured over 40 attempts apiece,
median 21.2 ms for a known username against 21.4 ms for an unknown one, and
24.0 ms locked against 23.9 ms unlocked.

The refusal is `invalid_credentials`, which `handleLoginSubmission` turns
into the same reasonless `reject` a wrong password produces, so there is no
second branch and no second page to keep in step. In process, the whole
response is compared for equality with `date` the only exclusion — status
code, body, and every header including `content-length`, the CSP header and
the absence of `location` and `set-cookie`. Against the container, where
`apps/server` stamps an `x-request-id` and the login page mints a CSP script
nonce for its passkey button, those two are normalised out as well: both
differ between two identical wrong passwords, so neither can distinguish
anything. Eight submissions hash identically in `docs/request-paths.md`.
**An attempt during a lockout still counts**, which is what keeps a locked
account the same statements as an unlocked one; the cost is that retrying
extends the wait, which the transcript states.

**The reaper owes `login_failures`.** A row is removed only by a successful
login, and a broken quiet period rewrites it rather than removing it, so the
row an abandoned attack leaves behind stays forever — and it carries no
`expires_at` or `consumed_at`, so the five tables named further down this
file do not describe it. Its retention window is its own, and has two
bounds rather than one: a row is dead once `last_failure_at` is older than
the tenant's `brute_force_failure_reset_seconds`, because from that point the
arithmetic restarts from one whether the row exists or not — **and** once
`locked_until` has passed, which is not implied by the first, since nothing
stops a tenant setting `brute_force_max_lockout_seconds` longer than its
reset window. Deleting a row before both **unlocks an account**, so the
window is per tenant and per row, never a global age.

**The clause row was split rather than moved.** RFC 6749 §2.3.1's MUST
covers "any endpoint using password authentication", and the row's own
evidence named `/token`'s client secrets. The end-user half is now
`covered` by `RFC6749-2.3.1-03`; the client-authentication half is a second
row, `deferred: P3`, with a reading note explaining the split. **That filing
is new**: nothing had scoped a rate limit on `client_secret` attempts, and
P3 was chosen because its exit criterion already reworks client
authentication (`private_key_jwt`, mTLS). Section 11 of the umbrella spec
now names it in P3's criterion, so it is scheduled rather than only
recorded. `rfc6749.md`
has **zero `deferred: P2` rows**, and its silenced-MUST census is unchanged
at nine because one deferred MUST replaced another.

**Task 21 gives `password_history_depth` and `password_max_age_days` a
reader, and the change-password required action a route.** No migration was
needed: 0035 added both columns and 0034 already allowed the
`password-history` credential type and deliberately left it out of the
per-subject partial unique indexes. `passwordExpired(credential,
maxAgeDays, now)` is a leaf service in `@odudu/domain-identity`; a maximum
of zero is the feature off, not an immediate expiry.
`recordPasswordExpiryIfOwed` runs in `advance`, beside
`recordOtpEnrolmentIfOwed` and for the same reason, and takes the maximum
age as a parameter rather than reading `tenants` again — `otpRequired` and
`passwordMaxAgeDays` are one `flowSettings` read now, carried on
`FlowFacts`, so a login costs no more tenant reads than before: **an expired password
still authenticates**, and the required-action gate — which sits downstream
of a success — is what blocks the login from completing. Refusing the
factor instead would have been a deadlock, the shape Task 17's
applicability table nearly shipped. `credentialRepository` gained
`passwordHistory(subjectId)` (retired hashes, newest first) and
`rotatePassword(subjectId, { from, to }, historyDepth)`, a compare-and-swap
on the outgoing hash rather than the brief's `(subjectId, newHash, depth)`
returning `void`: the predicate is the decision, so two rotations racing
one observed state archive one hash, not two. A `false` return is reported
as `superseded`, not as success — the action is satisfied either way, but
the password in force is then the one the other transaction set, and
telling the person at the form otherwise would leave them with a password
they never chose. `rotatePassword` and
`setPassword` both now move `created_at` with the hash — one row holds a
subject's password for the life of the account, so it dates the password
and not the row, and left alone a rotation would leave the new password
already expired and the action owed forever. Trimming history past the
depth is the one `DELETE` in this phase that is right, and the comment at
it says why against ADR 0021's default: a row past the depth is not
something any decision can read. `passwordHistoryShape` needed no widening
— it was already `{ hash }`, unlike `recoveryCodeShape` in Task 20.
`completeUpdatePassword` evaluates the tenant policy first and only then
verifies reuse, sequentially and short-circuiting: at a depth of 24 that is
up to 25 Argon2id verifications, and awaiting them together would hold the
whole default libuv pool for as long as the slowest — affordable here only
because the path requires a subject a factor has already bound. Reuse is
reported as a policy violation (`REUSED_PASSWORD`, beside
`evaluatePassword`), so the page renders one list. `update-password` got a
page of its own, `renderUpdatePasswordPage`, which is both the form a
parked login shows and the re-render a refused candidate returns to, at
`400` like registration and reset redemption.
`apps/server/tests/password-policy.int.test.ts`'s fourth case is a plain
`it` and drives the whole journey — `/authorize`, the login POST, then the
required-action POST — because nothing shorter reaches the fourth writer:
the route refuses a submission whose session names nobody, and the gate
refuses an action the bound subject never owed. Moving `created_at` on every password write is necessary, and was also a
hole: reset redemption reaches `setPassword` having evaluated only the
candidate-decidable rules, so an aged-out password could be **set straight
back** through a mailed link and the clock would restart —
`password_max_age_days` evadable through a supported flow by anybody with
mailbox access. A necessary fix opening a hole elsewhere is the easiest
defect shape to miss, because every individual change is right; the lesson
is to enumerate the other readers of a value before moving it. Closed
narrowly: reset redemption now refuses **the password in force**, which
needs only `passwordFor` and no threading of the depth or the stored
history into `@odudu/account`. It also clears an `update-password` the
subject owed, so a reset is not followed by a demand for a third password.
Both are injected at the composition root beside `setPassword`, for the
reason that one is. **What this leaves open: reset redemption still
consults no history**, so a password retired more than one change ago can
be restored through a reset and its age starts again — README.md and
`docs/request-paths.md` both say so rather than stating the guarantee
unqualified. And expiry compares a `created_at` the database wrote with an
instant the application's clock reports, so the two clocks must agree to
within far less than a day — which they do, but nothing asserts it.

**Task 20 issues single-use recovery codes.** Ten per subject, each ten
characters from Crockford's base32 alphabet (2^50 apiece, printed
`XXXXX-XXXXX`, with `I`/`L`/`O` folded onto the digits on the way in), each
Argon2id-hashed with the password parameters into its own `recovery-code`
credential row — migration 0034's `CHECK` already allowed the type, so no
migration was needed for it. `recoveryCodeShape` in
`packages/domain-identity/src/service/credential-secret.ts` gained an
optional `usedAt`, without which every read of a spent code would have
thrown on a `strictObject`. `credentialRepository.spendRecoveryCode` is the
compare-and-swap — `usedAt` set only where none is set — and the step
returns it as `AuthenticatorResult`'s `commit`, so a code is spent after
`advance`'s subject-binding guard and inside the transaction that succeeds
the login. The row is kept and marked, never deleted (ADR 0021), which is
what lets a replay be refused _as spent_: safe only because a recovery code
is a second factor, so the attempt is already bound to the subject being
told about their own credential. `BROWSER_FLOW_DEFAULT` gained a fourth
step, `recovery-code` conditional at index 3, applicable only to a
submission carrying a code — the same shape as the passkey step. The OTP
step stands down for the rest of such an attempt rather than asking for a
code from the authenticator that was lost, but **only where the recovery
step actually runs**: the tenant's flow carries the row and the subject holds
codes. Standing down on the field alone left both conditional groups
satisfied by inapplicability (`isGroupSatisfied`) and completed a
two-factor login on the password, which every subject who enrolled TOTP
before this task was exposed to. Migration 0040 appends the row to tenants
provisioned earlier, and **lifts `FORCE ROW LEVEL SECURITY` for its one
statement**: FORCE removes the owner's exemption, so under a schema owner
that is not `SUPERUSER` or `BYPASSRLS` a cross-tenant write sees nothing,
writes nothing and raises nothing.
`packages/authn-flows/tests/migrate-backfill.int.test.ts` runs the whole
migration set as exactly that role. **It also records a pre-existing
requirement nothing had stated: the owner role must be RLS-exempt**, because
`tenantLookupRepository.byName` reads `tenants` on the owner connection with
no tenant context (ADR 0009's amendment), so under a plain owner no tenant
resolves at all. README.md said the opposite in three places — that serving
as the owner bypasses RLS — and now says what FORCE actually makes true. Completing either
`configure-totp` or `configure-passkey` now adds `generate-recovery-codes`
to a subject who holds no codes, and the page that renders them is the only
place they exist in plaintext: a reload re-enters `beginRecoveryCodes` and
replaces the set it just displayed. **What this leaves open: a subject
cannot ask for a fresh set outside the required action**, and while the
action is owed, every login submission carrying a valid password re-renders
the page — ten Argon2id hashes and eleven row writes apiece, bounded by
holding the password and by acknowledging the page, but a heavier multiplier
than verification's. Self-service credential management is the account
console, so until then an operator deletes the rows to make the action owed
again; the rate limit is the brute-force increment's. And `renderLoginForm` now
takes an optional error string, used by exactly one refusal — a spent
recovery code; a wrong password still says nothing, so the form has a
message channel that only one branch fills.

**Task 19 makes a passkey a usernameless first factor.** `src/service/webauthn.ts`
gained the assertion half: `passkeyAuthenticationOptions` (no
`allowCredentials`, `userVerification: 'required'`),
`parseAuthenticationResponse`, `assertedCredentialId`, and
`verifyPasskeyAssertion` — which passes `requireUserVerification: true`
explicitly, as the registration half does. `src/service/authenticators/passkey.ts`
is the leaf step: **resolution happens before verification**, because
`verifyAuthenticationResponse` takes the stored credential as an input, and
the only thing available that early is the raw response's own `id` — which
is what enrolment stored as `lookup_key`. The counter rule is
`newCounter > stored`, except that `0` against a stored `0` is accepted
(WebAuthn §6.1.1 permits an authenticator that never counts);
`credentialRepository.advanceWebauthnCounter` is the compare-and-swap that
enforces the same rule under concurrency, `recordTotpUse`'s shape.
`otpApplicable` grew a third input, the satisfied set, and returns false
once `passkey` is in it: a verified passkey is two factors, which is also
what `FACTOR_COUNT` counts it as, so `otp_required` is a floor, not a tax.
`passkey` shares an ALTERNATIVE group with `password` and a group offers one
form at a time, so the passkey step is applicable to a submission that
actually carries an assertion; with nothing submitted the group falls
through to `password`, whose page carries the button. **The failure mode
that buys: a tenant that disables `password` and keeps only `passkey` answers
`no_applicable_execution` at `/authorize` and cannot be signed into at
all** — nothing makes the passkey step applicable except already holding an
assertion, and the only page that could produce one is never rendered. No
tenant `provisionTenant` creates is in that state, and any tenant that keeps
`password` applicable is unaffected. The fix is to let a challenge name
every applicable member of its group rather than the first, which changes
`nextStep` and `AuthenticatorResult`, so it is its own increment rather than
a widening of this one. `AuthenticatorResult`'s
success variant grew an optional `commit`, run by `advance` **after** the
subject-mismatch guard — a factor that names its own subject must not move
any state until the attempt is known to be that subject's.
`POST /tenants/{tenant}/login-actions/passkey-challenge` issues the options
and parks the challenge per press. **A rendered page now carries its own script**:
`default-src 'none'` was silently blocking the enrolment page's inline
script as well, so no WebAuthn page could ever have worked in a browser.
A renderer returns a `RenderedPage` whose `script` names the nonce it
rendered, and `sendHtml` derives the policy from that one value — no call
site can name a nonce the markup does not carry. `script-src` is added
only for a page that renders a script, and `connect-src 'self'` only where
that script fetches; `packages/protocol-oidc/tests/passkey-enrolment.int.test.ts`
pins the header's nonce to the element's on both scripted pages.

**Task 18 enrols a passkey.** `@simplewebauthn/server` is pinned at
`14.0.2` (the version `docs/superpowers/p2b-spike-log.md` resolved and
probed; the package ships no `dist/`, its declarations are under `esm/`).
Migration 0039 adds `authentication_sessions.webauthn_challenge`, and
`authenticationSessionRepository` gained `setWebauthnChallenge` and
`claimWebauthnChallenge` — the latter one statement that reads and clears
the column, self-joined so `RETURNING` hands back the pre-update value, so
a replayed response finds nothing to match rather than the same challenge
twice. `src/service/webauthn.ts` is a leaf over the library:
`relyingPartyId`/`relyingPartyOrigin` derive the relying party from
`ODUDU_PUBLIC_BASE_URL` and throw rather than defaulting,
`passkeyRegistrationOptions` issues the options (user handle = subject id,
`excludeCredentials` = the subject's existing credential ids), and
`verifyPasskeyRegistration` turns the library's thrown refusals into a
rejection. `beginPasskeyEnrolment`/`completePasskeyEnrolment` store nothing
until the attestation verifies; the credential's `lookup_key` is the
credential id and `secret_data` carries the COSE public key (base64url),
the authenticator's signature counter at registration — the baseline clone
detection compares against — and its transports. `configure-passkey` goes
through the required-action route's existing authorization check
(`pendingFor`), and is cleared only on success.
`assertProductionPasskeyRelyingParty` refuses production boot without a
base URL a relying party id can be derived from; outside production the
action reports itself unsupported rather than binding a credential to a
guessed domain. The enrolment page calls `navigator.credentials.create()`
— which is why `docs/request-paths.md`'s passkey section states its flow
and its refusals instead of showing output nobody produced, and points at
`packages/authn-flows/tests/passkey-enrolment.int.test.ts`, which drives
the whole ceremony against real PostgreSQL with a software authenticator
emitting `none`-format attestations. Passkey login is Task 19's, above.

**Task 16 makes TOTP a real second factor and lets a subject enrol one.**
Migration 0037 adds `tenants.otp_required` (default false) and 0038 adds
`authentication_sessions.subject_id` (nullable, FK to `subjects (tenant_id,
id)`). `@odudu/authn-flows` gained `totpStep`/`otpApplicable`
(`src/service/authenticators/totp.ts`, a leaf in `password.ts`'s shape),
`beginTotpEnrolment`/`completeTotpEnrolment`, and
`renderTotpEnrolmentPage`, which draws the `otpauth://` URI as text and as
a QR code (`qrcode-generator` 2.0.4, exact, zero dependencies, confined to
the view layer). `executor.ts` registers `otp` for real: applicability is
now per-subject and per-tenant, `AdvanceInput` carries `code`, and every
successful factor binds `subject_id` so a later factor cannot answer for
somebody else — a mismatch fails with `subject_mismatch`. The OTP step
looks its secret up by the bound subject, never by anything the form
submits. `credentialRepository.recordTotpUse` stores the accepted time
step as the credential's `lastStep`, which is the half of RFC 6238 §5.2's
no-replay rule `verifyTotp` leaves to its caller.

A tenant that requires OTP from a subject with no credential cannot express
that as a step — asking for a code nobody can produce parks the login, and
the required-action gate sits downstream of a successful authentication —
so `advance` records the `configure-totp` required action instead, and
`POST /tenants/{tenant}/login-actions/required-action` (new, in
`protocol-oidc`) completes it. The secret round-trips in a hidden field and
the credential is written only by a submission that verifies a code.
`id_token_hint` naming a different subject now also clears the attempt's
`satisfied` and `subject_id` (`resetAuthenticationProgress`), without which
the binding would have stranded that refusal's documented retry path.
`docs/request-paths.md` gained a live TOTP walkthrough — real enrolment,
real replay refusal, real `amr: ["otp","pwd"]` / `acr: "2"`.

**Task 15 is RFC 6238 TOTP, built rather than installed.**
`@odudu/crypto/src/service/totp.ts` implements `generateTotpSecret`,
`totpCounter`, `totpCode` and `verifyTotp` directly over `node:crypto` —
`createHmac`, a big-endian 8-byte counter (`Buffer.writeBigUInt64BE`, with
`BigInt.asUintN(64, …)` so a negative step, which arises only in this
package's own tests, still encodes rather than throwing), RFC 4226 §5.3
dynamic truncation, and a from-scratch base32 codec (no padding, matching
what an `otpauth://` URI carries). `verifyTotp` fixes six digits and SHA-1
internally rather than taking them as parameters, refuses a code of the
wrong length before any HMAC runs, compares with `crypto.timingSafeEqual`,
accepts a ±1 time-step window, and refuses a step at or below the caller's
`lastStep` — the replay guard `lastStep` exists for, since without it a
code would keep validating for its whole 30-to-90-second window. Every
vector in `packages/crypto/src/service/totp.test.ts` is RFC 6238 Appendix
B's own (SHA-1, SHA-256 and SHA-512, fetched and read directly on
2026-09-16, not recalled) plus RFC 4226 Appendix D's ten HOTP vectors,
added because appendix B's six fixed timestamps don't exercise every digest
byte the truncation touches. **The task brief's `SEED_SHA256` test constant
was wrong** — the 20-byte SHA-1 secret doubled to 40 bytes, base32-encoded,
rather than the RFC's actual 32-byte secret, which extends the seed by
continuing the cyclic digit string `1234567890` rather than by
zero-padding (Appendix A's reference implementation shows this in the
`seed32`/`seed64` string literals; Appendix B's own prose never restates
the rule). `docs/protocols/rfc6238.md`'s reading notes carry the full
correction and what was actually read; `tools/trace/silenced-musts.json`
gained `rfc6238.md: { deferred: 0, na: 5 }`. Stryker's reported score for
`totp.ts` (6.25%, unchanged by adding ten more real vectors) is the same
`@stryker-mutator/vitest-runner` targeted-test-selection defect already
documented for `sign.ts`/`jwks.ts` in `stryker.config.json`, confirmed by
applying every reported-Survived mutant to the file by hand and running
`vitest run totp` directly — all but two failed the suite, and those two
are equivalent mutants (a symmetric ±1-step window makes
`currentStep - offset` produce the same three steps as `currentStep +
offset`; `Buffer.from` falls back to `utf8` for an unrecognised encoding,
indistinguishable from the original on this ASCII-only input). No credential
row is written yet — Task 16 is the OTP authenticator that calls this
package and gives the two-factor login journey Task 9's own note pointed
at somewhere to land.

Migration 0031 adds
`authentication_executions`: one flat, ordered list per tenant (`id`,
`tenant_id`, `index`, `authenticator`, `requirement`), `requirement`
constrained to `required`/`alternative`/`conditional`/`disabled` and
`(tenant_id, index)` unique. `@odudu/authn-flows` gained
`executionRepository` (`forTenant`, ordered by `index`; `create`) and
`provisionBrowserFlow`, which seeds `BROWSER_FLOW_DEFAULT` — `passkey` and
`password` at `alternative`, `otp` at `conditional` — for every tenant.
`@odudu/domain-tenant` does not depend on `@odudu/authn-flows` — the umbrella
spec fixes the direction the other way — so `provisionTenantDefaults` does not
call `provisionBrowserFlow` itself; a `dependency-cruiser` rule
(`no-domain-to-authn-flows`) forbids that edge, alongside `no-circular`,
which would also catch it (`authn-flows` now depends on `@odudu/domain-tenant`
too, so the edge would close a cycle, not just point the wrong way).
`@odudu/authn-flows` exports `provisionTenant(tx, tenantId)`, which calls
`provisionTenantDefaults` and then `provisionBrowserFlow` — the one function
a tenant-creation site should call so the two cannot drift apart. The seed
CLI's two tenant-creation sites (`apps/server/src/cli/seed.ts`) call it; so do
all but one of the ~25 protocol-oidc and domain-tenant test fixtures that
stand up a tenant, mechanically migrated from calling `provisionTenantDefaults`
directly. The one exception is `domain-tenant`'s own
`provision-defaults.int.test.ts`, which cannot reach `provisionTenant` —
`domain-tenant` sits underneath `authn-flows` in the dependency graph — and
still calls `provisionTenantDefaults` directly, with a comment saying why.
`provisionBrowserFlow` and `provisionTenantDefaults` both stay exported
individually for a caller that wants only one half. Evaluating the flow into
a decision, and rewiring `executor.ts`'s `STEPS` to read it, are Tasks 8 and
9 — Task 7 built only the table, the repository and the provisioning
default.

**Task 8 is that decision, as a pure function.**
`nextStep(executions, state)` (`packages/authn-flows/src/service/requirements.ts`)
walks a flat, ordered list of `Step`s once and partitions it into groups: a
run of adjacent `alternative` steps is one group, satisfied only when one of
its members is actually satisfied; every other step is a group of its own,
satisfied by its member being satisfied or simply inapplicable — `applicable`
is a caller-supplied input, never computed here. `disabled` steps are
dropped before grouping, so two alternative runs separated only by a
disabled entry merge into one (a deliberate choice past what the nine
brief-given cases pin down, covered by a tenth test). An empty flow, or one
where every group runs out of applicable members, returns `{ kind: 'fail'
}` rather than `{ kind: 'complete' }` — the case that stops a misconfigured
tenant from admitting anyone with no credential at all. `executor.ts`'s
`STEPS` rewiring to call this is Task 9's, untouched here.

**Task 9 is that rewiring, and it lands the registry `advance()` was always
going to need.** Migration 0032 adds `authentication_sessions.satisfied`
(`text[]`, default `{}`): the authenticator names this authentication has
already run through, so a multi-step login resumes rather than restarts — a
correct password followed by a wrong second factor never asks for the
password again. `executor.ts` deletes `STEPS`/`StepName` entirely.
`AUTHENTICATORS` is now `Record<string, AuthenticatorFn>` keyed by the
`authenticator` column, holding `password` (real), and `passkey`/`otp`
(registered but throwing if ever actually invoked — never reachable, since
`isApplicable` hardcodes both false: neither has a credential type to
enrol into yet, so there is nothing to look up). `isRegisteredAuthenticator`
lets `provisionBrowserFlow` (`usecase/provision-flow.ts`) reject an unknown
authenticator name in `BROWSER_FLOW_DEFAULT` at provisioning time rather
than at login. The dispatch itself is `dispatchNext(registry, steps,
satisfied, input)` — one decide-and-run against `nextStep`, exported so
resumption is provable as a unit test against a fake registry
(`ODUDU-AUTHN-RESUMPTION-01`) rather than tied to `password` being the one
real authenticator. `advance()` still takes exactly the arguments it always
has; a caller cannot tell the registry exists. `initialChallenge(tx,
tenantId)` answers what a tenant's flow would ask for first, with no session
yet — used both to render the right form at `/authorize` and to detect a
flow with no applicable execution at all before a session is ever started.
`pendingChallenge(tx, authSessionId)` answers the same question for a live
session, letting the login route re-render the right form after a rejected
attempt without `login-submission.ts` learning anything about
requirements — that file is unmodified, on purpose, per the task brief.
`AuthenticatorResult`'s `challenge` widens to `form: string`;
`authorize-html.ts`'s `renderLoginForm` takes the form name and dispatches
its fields on it (only `'password'` renders real fields today), and the
hidden `auth_session_id` CSRF field is emitted once, on every form, not
duplicated per case.

**Closes `OIDC-CORE-3.1.2.1-11`.** `docs/protocols/oidc-core.md`'s
`prompt=login` MUST — "an error is returned if reauthentication cannot be
performed" — was `deferred: P2` because no tenant could ever reach a state
with no applicable execution. Task 9 is what creates that state:
`handleAuthorizationRequest` calls `initialChallenge` before starting an
authentication session, and a `'failure'` answer (no applicable execution)
is reported as `login_required` at the client's `redirect_uri` — a
redirect, nothing rendered, nothing parked — the same way session reuse's
own refusal is. `tools/trace/silenced-musts.json`'s `oidc-core.md.deferred`
drops from 13 to 12.

**A correction the brief needed before this task could start.** Its
original Step 2 described an end-to-end TOTP journey (password success
re-challenging for OTP, a wrong OTP code re-challenging OTP alone, a
correct one completing) that nothing in the tree can produce yet — there is
no OTP authenticator and no non-`password` credential type until the TOTP
tasks. What Task 9 proves instead, each at the layer that can honestly show
it: resumption as a unit test against a fake registry
(`ODUDU-AUTHN-RESUMPTION-01`), `satisfied` persistence as an integration
test including a foreign-`tenant_id` probe (`ODUDU-AUTHN-SATISFIED-PERSISTENCE-01`),
tenant-ordered dispatch asserting — not assuming — that `passkey`/`otp` are
inapplicable today (`ODUDU-AUTHN-FLOW-ORDER-01`), and unchanged expiry
behaviour (`ODUDU-AUTHN-SESSION-EXPIRY-UNCHANGED-01`). The full two-factor
journey is now named in Task 16's own step list, which builds the OTP
authenticator once Task 15 has built RFC 6238 underneath it.

**Task 10 records which authenticators actually ran, and emits `amr`/`acr`
from that record — never from what the subject could have used.** A
completing factor is deliberately never persisted to
`authentication_sessions.satisfied` (Task 9), so `advance()`'s success
outcome now widens into `AdvanceOutcome`, which names every authenticator
the login used, in order:
`[...record.satisfied, authenticator]` for a login that finishes in one
call, and `[...record.satisfied, authenticator, after.authenticator]` for
the (currently unreachable, but type-correct) case where the very next
dispatch also succeeds. Migration 0033 adds `sessions.authenticators`
(`text[]`, default `{}`); `establishSession` takes it as a new parameter
and `login-submission.ts`'s `CompleteLoginInput`/`handleLoginSubmission`
carry it from `advance()`'s result through to the session
`completeLogin` creates. A reused session (`completeReuse`) touches the
_existing_ session rather than creating one, so its `authenticators` are
whatever the original login recorded — nothing new to thread there.
`token-issuance.ts` reads `sessions.authenticators` off `code.sessionId`
(never the offline-nulled local `sessionId` used for `sid`) at the moment
it assembles the ID token, the same "read the stored instant, don't
recompute" rule `auth_time` already follows.

`packages/protocol-oidc/src/service/acr.ts`'s `amrFor` and `acrFor` were
checked against the IANA Authentication Method Reference Values registry
and RFC 8176 §2 directly (2026-09-15), not recalled — see
`docs/protocols/oidc-core.md`'s new reading note for what was read.
**`recovery-code` maps to nothing**, but the first version of this task
gave the wrong reason: RFC 8176's `otp` entry says one-time-password
specifications it applies to "include" RFC 4226/6238, and "include" is
non-exhaustive, so the registry does not in fact scope `otp` to HOTP/TOTP
alone — a confident claim about a registry that a fix round caught the
same way this task caught the brief's own. The decision to omit
`recovery-code` still stands, on the reason that actually holds: a
statically stored, printed-or-saved recovery code carries a materially
different assurance story from a generator-produced code, and reporting it
as `otp` would mislead a relying party that reads the claim that way — a
mislabelling that is unrecoverable once trusted, where an omission is not.
The residual cost is recorded rather than hidden: once `recovery-code` has
a runtime, `amr` for a recovery-code-only login is indistinguishable from
one with no factors at all, while `acr` still counts it as one. `passkey`
still maps to `hwk` + `user`, matching common practice for a
hardware-backed WebAuthn assertion, with a caveat recorded for whoever
gives `passkey` a runtime: a synced (software) passkey would be `swk`, not
`hwk`.

**`acr`'s SHOULD — an absolute URI or an RFC 6711 name — was not closed.**
`acrFor` returns this tenant's own bare digit, which is neither, so that
row moves to `gap`, not `covered`; the adjacent MUST ("a registered name
is not used with a different meaning") closes instead, because it binds
only a value that names a registration, and Odudu's digits never do — a
vacuous satisfaction the clause table's Requirement cell now says plainly,
and `OIDC-CORE-2-09` asserts as a property over several inputs rather than
four fixed pairs that would still pass if the vacuity broke. The `gap`
ships a wire format the moment a client reads it, so if bare digits are
the permanent answer rather than a placeholder, that decision is worth an
ADR while it can still be made.

`acrFor` returns `null` — omitted from the token, the same way `amr` omits
an empty array — for an authenticator list with nothing in it, rather than
asserting `'1'` about a login the record does not describe; a session
recorded before migration 0033 existed, or one somehow established with no
authenticators, no longer reports a single factor it cannot back up.
`amr`/`acr`'s presence in `docs/request-paths.md`'s four decoded-ID-token
transcripts was re-run against the compose stack rather than hand-edited
in, and `tests/docs/id-token-claims.test.ts` now fails the build if a
transcript carrying `auth_time` ever again lacks either claim. A dedicated
integration test also exercises accumulation across a genuine two-factor
login — `recordSatisfied(authSessionId, 'otp')` ahead of a password
submission, through the real `establishSession` and issuance path — so a
simplification of `advance()`'s authenticator list to `[authenticator]`
alone, which every other test left green, now fails.

**As of Task 10, every `deferred: P2` row in `docs/protocols/oidc-core.md`
and `rfc6749.md` is closed except RFC 6749 §2.3.1's brute-force MUST** —
the phase's traceability midpoint; that row alone is left for whichever
task owns rate limiting.

Migration 0026 adds
`token_grants.session_id`, nullable: null means an offline grant, which
nothing expires and no logout can end; a non-null value is the SSO session
the grant was issued under, and `sessions` needed a `UNIQUE (tenant_id, id)`
it did not have before this so the composite foreign key could exist.
`tokenGrantRepository` gained `revokeForSession` and `bySession`, and
`rotateRefreshToken` refuses to rotate a revoked grant's refresh token
(`RotationOutcome`'s `'revoked'` case), answered with the same
`invalid_grant` a reused or unknown token gets.

**Migrations 0027 and 0028 give a session two clocks.** `sessions` gained
`last_active_at`, touched on every use; `expires_at` stays the hard
ceiling, `created_at` plus the tenant's maximum lifespan. `tenants` gained
`sso_session_idle_seconds` (default 1800) and `sso_session_max_seconds`
(default 36000), each bounded to `[60, 2592000]` by a `CHECK`, plus a third
`CHECK` refusing an idle timeout longer than the ceiling. `isSessionLive`
(`packages/authn-flows/src/service/session-liveness.ts`) treats both
boundaries as exclusive; `sessionRepository(tx).liveById` is the read
anything that authenticates should use, `byId` stays liveness-blind for the
reaper and a future session list, and `establishSession` now takes the
ceiling as a `maxSeconds` parameter instead of a fixed 12-hour constant. The
plan is
[2026-09-15-p2b-credentials-mfa-sessions.md](../superpowers/plans/2026-09-15-p2b-credentials-mfa-sessions.md)
— 29 tasks, 211 steps, 95–125 h, three spike gates (Tasks 11, 17, 24), and
fourteen migrations numbered 0026–0039 in the table at its end, which
supersedes the spec's section 4 numbering. The
phase spec is
[2026-09-15-p2b-credentials-mfa-sessions-design.md](../superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md),
on branch `p2b-credentials-mfa-sessions`. It settles nine design decisions
against stated alternatives — a flat per-tenant flow, `jsonb` credentials
with a `lookup_key` index, `session_id` on the existing `token_grants`,
`last_active_at` beside `expires_at`, Postgres lockout with an in-process
IP throttle, reaping as a command under a thin scheduler, required actions
as the enrolment surface, passkeys as a first factor, and typed
password-policy columns — and it settles logout's token handling by reading
the specifications rather than reasoning about JWTs (section 7.2).

**Four roadmap amendments landed with it**, in section 11 of the umbrella
spec: the email outbox and recovery codes become P2b's (so P2b's exit
criterion and estimate are amended — 95–130 h, not 80–110), nested
authentication subflows become P4's, and `prompt=select_account` becomes
P3's. That last one moved three `deferred: P2` clause rows in
`docs/protocols/oidc-core.md` to `deferred: P3`; `pnpm trace` prints nothing
for a `deferred:` row either way, so the move is invisible to the build and
was made deliberately.

**Task 3 makes the SSO session load-bearing.** `/authorize` reads the
`__Host-<tenant>-session` cookie P1 wrote and never read, resolves it
through `sessionRepository(tx).liveById` scoped to the tenant's own idle
window, and decides — alongside `prompt` and a newly-parsed `max_age` — to
reuse the session, start a fresh authentication, or refuse under
`prompt=none`, all in one function (`decideReuse`,
`packages/protocol-oidc/src/usecase/session-reuse.ts`). A refusal is still
a redirect below the §4.1.2.1 boundary, starts no authentication session,
and writes no cookie, exactly as the unconditional P1 answer did. A reuse
issues a code through the same `issueAuthorizationCode` the login form
uses, carrying the session's own `auth_time` rather than a fresh clock
read, and touches the session. The email-verified gate
(`refusedForUnverifiedEmail`, extracted from `handleLoginSubmission`) now
guards this second door into completing a login the same way it guards the
password form — an unverified account holding a live cookie is refused,
not signed in for free. This closes three `deferred: P2` rows in
`docs/protocols/oidc-core.md`: §2's `auth_time`-and-`max_age` row,
§3.1.2.1's `max_age` MUST, and §15.1's `max_age` MUST. §3.1.2.1's
`prompt=login` row stays `deferred: P2` — `decideReuse` never refuses under
`prompt=login` (it is mutually exclusive with `prompt=none` at parse time,
so forcing reauthentication never lands on anything but `authenticate`),
so nothing in this task gives that specific MUST a reachable branch.
**Five `deferred: P2` rows remained at this point, all P2b's to close** —
`prompt=login`, two `acr` rows and `amr` in `oidc-core.md`, and RFC 6749
§2.3.1's brute-force MUST. `prompt=login` closed with Task 9, above; Task
10, below, closes `amr` and one `acr` row and moves the other to `gap`
rather than forcing it — see that paragraph for why. Only §2.3.1 is left.

**Task 4 found that `token_grants.session_id` was write-only: nothing in
the real flow ever set it.** The grant is created at `/token`, from an
`authorization_codes` row, and that table had no `session_id` — so the
column Task 1 added was populated only by tests inserting directly through
the repository. Migration 0029 adds `authorization_codes.session_id`
(nullable, no foreign key: a code redeemed after its session is reaped
must still redeem). `completeLogin` and `completeReuse`
(`packages/protocol-oidc/src/index.ts`) now both pass the session id they
already hold into `issueAuthorizationCode`
(`packages/protocol-oidc/src/usecase/login-submission.ts`), it is carried
on the code, and `token-issuance.ts` copies it onto the grant it creates
and onto the refreshed grant's `sessionId` on every subsequent
`refresh_token` redemption. With the session actually reaching the grant,
`sid` (OpenID Connect Back-Channel Logout 1.0 §2.1) is now emitted in both
the access token and the ID token whenever `grant.sessionId` is non-null,
and omitted entirely otherwise — a property of the grant assembled
straight into the envelope in `mintAccessToken` and the ID token claims,
never through `ClaimMapperRegistry`, so a mapper cannot overwrite it
(`withRegisteredClaimsWinning`, tested against exactly that). No grant is
session-less yet except by this being the only way one is ever null:
`offline_access` (Task 6) is what deliberately forces `sessionId: null`.
`docs/protocols/oidc-backchannel.md` is a new file, one row, `sid`
`covered`; the endpoint and Logout Token clauses are Task 28's.

**Task 5 makes the session endable.** Migration 0030 adds
`client_oidc_config.post_logout_redirect_uris`, the exact-match allowlist
OpenID Connect RP-Initiated Logout 1.0 §3 requires; migration numbering
corrects the brief's own `0029` (Task 4 already took it for
`authorization_codes.session_id`). `GET`/`POST
/tenants/{tenant}/protocol/openid-connect/logout` is new
(`packages/protocol-oidc/src/usecase/logout.ts`,
`view/logout-html.ts`, `view/routes/logout.ts`), built around
`decideLogout` — a pure function, hint subject, hint `sid`, the current
session (or none) and the requested URI and registered list in, `confirm` /
`end` / `render` out — reusing `subjectOfIdTokenHint` (now exported from
`usecase/authorization-request.ts`, and returning `sid` alongside the
subject) for the hint's own validation. §2's "belong to the current OP
session" is compared on `sid` when the hint carries one — Back-Channel
Logout §2.1 put it in every token this phase issues — so a stale hint from
the same End-User's own, already-ended earlier session no longer skips
confirmation just because the subject still matches. (Task 6 below removes
the subject-only fallback this paragraph originally described for a
`sid`-less hint — every session-backed token has carried `sid` since this
task, so the only current hint that ever lacks one is an offline grant's,
which must not skip confirmation either.) With no live session
at all, an exactly-registered `post_logout_redirect_uri` is still honoured
(§3 forbids redirecting to an _unmatched_ URI, not honouring a matched one
when there is nothing to end — Keycloak does the same) rather than always
rendering the "already signed out" page. A refused redirect on a real
session (§3's exact-match MUST) still ends it — the two are independent
outcomes of one decision. Ending a session is `sessionRepository(tx).end`
(new: moves `expires_at` to now, mirroring how `isSessionLive` already
reads it, no new column or row state) followed by
`tokenGrantRepository(tx).revokeForSession`, one `withTenant` transaction.
Access tokens are untouched, and `docs/protocols/oidc-rpinitiated.md` and
README.md's own logout section both say plainly why: they are
self-contained `at+jwt` JWTs nothing consults, so nothing exists to tell
one it has been logged out. The confirmation form's `session_id` hidden
field _is_ the session cookie's own value, echoed back and compared
against what the cookie still resolves to on POST — a double-submit-cookie
defence, not a single-use token the way login's `auth_session_id` is (the
two write-ups calling it "the same" were wrong and are fixed). Every page
this route renders carries `Cache-Control: no-store`, and every outcome
that actually ends a session clears the cookie (`Max-Age=0`, same
attributes login sets it with). `end_session_endpoint` moved into
`@odudu/contracts`' `discoveryDocument()` itself rather than staying a
protocol-oidc-only extension type — `authorization_response_iss_parameter_supported`
(RFC 9207) and `code_challenge_methods_supported` (RFC 7636) already live
there as extension members, so contracts already isn't purely "core OIDC
Discovery", and a document type that omitted a member the server always
serves was the actual defect.

P2a delivered the identity model: roles, groups, client scopes, per-client
web origins, the user profile, email delivery and the account lifecycle
built on it (self-registration, address verification, password reset).
Everything below this point is what P2b needs and cannot derive from the
code.

**The token contract, as P2a leaves it.** `roles` and `groups` are sorted
string arrays, emitted under the names the JWT registry (RFC 9068 §2.2.3.1)
gives them; a client-scoped role is qualified `clientId:roleName`, never
just `roleName`. `clients.full_scope_allowed` is **off by default** — a role
reaches a token only when it is granted to the subject, mapped to a scope,
and that scope is both assigned to the client and actually requested (or
`full_scope_allowed` is switched on for that client, which bypasses the
mapping entirely). Identity claims are gated **off the access token by
default** by `client_scopes.include_in_access_token` — `roles`/`groups`
default the other way, `true`, which is the one asymmetry worth
remembering: an access token carries roles and groups unless told not to,
and carries no profile claims unless told to. `include_in_id_token` gates
`roles`/`groups` off the ID token the same way, unconditionally — a full
role list has no place going to a browser. `/userinfo` reads the access
token's gate, not the ID token's. See [docs/request-paths.md](../request-paths.md#roles-once-a-scope-reaches-it)
for the walkthrough — its "I created a role and it is not in my token"
paragraph, and [README.md](../../README.md)'s "Give ada a role" section, are
the two places this order-of-checks is written down for a reader.

**`user_credentials.type` is widened, as of Task 12.** Migration 0034
rewrites `CHECK (type IN ('password'))` to admit `totp`, `webauthn`,
`recovery-code` and `password-history`; drops `user_credentials_one_password`
(migration 0005's actual name for `UNIQUE (subject_id, type)` — the brief's
second constraint name, `user_credentials_subject_id_type_unique`, never
existed); and replaces it with partial unique indexes scoped to `password`
and `totp` alone, so a passkey or recovery code can have more than one row
per subject while a password and a TOTP secret still cannot. `secret_data`
is `jsonb` now, converted in place with
`jsonb_build_object('hash', secret_data)` (Task 11's spike verified this is
byte-identical and reversible for every PHC string shape tried, including
one containing `"`, `\`, `{`, `}` or a raw newline). `label`, `last_used_at`
and `lookup_key` are new columns; `lookup_key` carries a WebAuthn credential
id and is unique per `(tenant_id, lookup_key)`, which is what lets a
passwordless assertion resolve its subject without scanning `jsonb` across
a tenant. `@odudu/domain-identity` gained `parseCredentialSecret` (a Zod
schema per type, `unknown` in, a narrowed discriminated union out — no
cast) and `credentialRepository` gained `listFor`, `byLookupKey`, `insert`,
`markUsed` and `deleteOne`; `passwordFor` and `setPassword` keep their exact
signatures. Nothing yet writes a `totp`, `webauthn` or `password-history`
row or reads `lookup_key` — that is TOTP, passkeys and password history's
own tasks to build on top of this.

**Task 13: every tenant now carries a password policy, and every writer of
a password is bound by it.** Migration 0035 (numbered past the brief's
0034 — 0034 was already `user_credentials_types`, per Task 12 above) adds
nine columns to `tenants`: `password_min_length` (default 8, floored there
by a `CHECK` so a tenant cannot configure below it, ceiling 256),
`password_require_digit`/`_uppercase`/`_lowercase`/`_special` (all off by
default), `password_not_username`/`_not_email` (both on by default — `not_email`
matches the local part of the address, not the whole string, so a
candidate containing just the account-name half is refused the same as one
containing the username, and a subject whose username equals its email's
local part trips both rules at once, not either-or),
`password_history_depth` (0–24) and `password_max_age_days` (0–3650) —
Task 21 gave the last two a reader. `@odudu/domain-identity` gained
`evaluatePassword(candidate, policy, subject)`, a leaf service (no `tx`, no
clock) that returns every violated rule, not just the first, and counts
characters with `Array.from(candidate).length` rather than `.length` so an
8-emoji password is not miscounted as 16 characters. Three of the four
writers called it as of that task: registration (`register.ts`), reset redemption
(`completePasswordReset`, checked against a non-consuming `peek` so a weak
password never burns the link), and both of the seed CLI's password-writing
paths (`--user`/`--password` and `seed user`) — there is no development
override for the seed CLI; it enforces the same policy every other writer
does. The fourth writer, the change-password required action, did not exist
until Task 21, and `apps/server/tests/password-policy.int.test.ts` carried
its case as `it.fails` rather than a skip until then. That cross-cutting
test lives
under `apps/server/tests/`, not `packages/account/tests/` as the phase plan
named it — `@odudu/account` depends on neither `@odudu/authn-flows` nor
`apps/server`, so it cannot reach the seed CLI or the future required
action itself; `apps/server` is the only place all four writers are
reachable. Fixture fallout: 15 short passwords in
`packages/account/tests/register.int.test.ts`, 5 in
`apps/server/tests/seed.int.test.ts`, and 5 more of `seed user`'s
`--password p` in `apps/server/tests/seed-authz.int.test.ts` all needed a
compliant password — none of them were testing password strength, so the
fix is a literal, not a design change. `infra/docker/smoke.sh` carried the
same problem as a committed credential rather than a test fixture: it
seeded and logged in as `smoke`/`smoke@example.com` with password
`smoke-password`, which the shipped default policy correctly refuses
(`not-username`) — the `container` CI job, which builds the image and runs
this script, is what caught it, since nothing in `pnpm verify` builds the
image. Fixed to a password bearing no relation to the account. Any task
that changes what a password may be should re-run `infra/docker/smoke.sh`
and grep `infra/` for other seeded credentials, rather than rediscovering
this per task.

**Task 14 gives a tenant-level requirement something to require against: a
pending action that blocks a login, not just an offer.** Migration 0036
(0035 was already `realm_password_policy`, per Task 13) adds
`user_required_actions` (`tenant_id`, `subject_id`, `action`, `created_at`,
primary key on the first three, `action` constrained to the four decision
#1 fixes: `update-password`, `configure-totp`, `configure-passkey`,
`generate-recovery-codes`), RLS policy copied verbatim from
`authentication_sessions`' (`app.tenant_id`, `nullif(..., '')`, no `WITH
CHECK`) rather than the brief's `current_setting`-named one, which a
`withTenant`-set session would never match. `@odudu/authn-flows` gained
`requiredActionRepository(tx)` (`pendingFor(subjectId)`,
`add(tenantId, subjectId, action)` — `tenantId` explicit, the same way every
other repository's insert in this codebase takes one, unlike the brief's
signature, which had no way to supply a fresh row's `tenant_id` —
`complete(subjectId, action)`), `nextRequiredAction(pending)` (the fixed
order: password first, so an expired password is never usable to enrol a
second factor), and `renderRequiredActionPage(tenant, authSessionId,
action)` — a page shell in the same dependency-free, `escapeHtml`-everything
style as `authorize-html.ts`, carrying the same hidden `auth_session_id`
CSRF field. Every action has since been given a page of its own, and this
one is now `renderRequiredActionPage(action)` — what is left of it is the
deployment that cannot offer an action at all (no relying party id, and so
no passkey to enrol), which is why it carries no form.

`login-submission.ts`'s `handleLoginSubmission` gates on
`nextRequiredAction(await deps.pendingActions(tenant.id, result.subjectId))`
after the `id_token_hint` comparison and before `resolveClientId`/
`completeLogin`: a non-null action returns `{ kind: 'required_action',
authSessionId, action }` with nothing established and no code issued, and
— like the `unverified` outcome and the `id_token_hint` mismatch before it
— leaves the authentication session unconsumed so the same parked request
resumes once the action is done. This is the **third** gate to leave a
session alive, after the `id_token_hint`-mismatch redirect and the
`unverified` refusal, and it runs last of the three deliberately: by the
time it is reached, the request is already known to be answerable for this
subject, so a subject who is never getting a positive answer (a wrong
`id_token_hint`) is never asked to complete an action for a login that was
always going to end in `login_required`. None of the three touch
`executor.ts`'s `recordSatisfied` (which already only persists a factor
when a further step of the _flow itself_ remains, not when the login as a
whole is still blocked afterward). The existing `unverified` tests are
unaffected because they run with the default harness `pendingActions` mock
returning `[]`, not because of gate ordering — `unverified` is still
checked first, ahead of both the `id_token_hint` comparison and the new
gate. `login.ts`'s route renders `renderRequiredActionPage` for the new
outcome, the same way it already does for `unverified`.

**What this task did not build.** It registered no route for
`POST /tenants/{tenant}/login-actions/required-action` — the page's form
posted there with nothing to receive it — and nothing seeded
`user_required_actions` in any live path, so no existing tenant's login
behaviour changed. Tasks 17 through 21 closed both halves: the route, and
the paths (a tenant requiring OTP, and an expired password) that owe an
action in the first place.
