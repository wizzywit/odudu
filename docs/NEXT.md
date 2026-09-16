# Next

## Start here

**P0, P1 and P2a are complete. P2b is brainstormed, specified and planned;
Tasks 1 through 19 have landed and Task 20 is next.**

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
that buys: a realm that disables `password` and keeps only `passkey` answers
`no_applicable_execution` at `/authorize` and cannot be signed into at
all** — nothing makes the passkey step applicable except already holding an
assertion, and the only page that could produce one is never rendered. No
realm `provisionRealm` creates is in that state, and any realm that keeps
`password` applicable is unaffected. The fix is to let a challenge name
every applicable member of its group rather than the first, which changes
`nextStep` and `AuthenticatorResult`, so it is its own increment rather than
a widening of this one. `AuthenticatorResult`'s
success variant grew an optional `commit`, run by `advance` **after** the
subject-mismatch guard — a factor that names its own subject must not move
any state until the attempt is known to be that subject's.
`POST /realms/{realm}/login-actions/passkey-challenge` issues the options
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
Migration 0037 adds `realms.otp_required` (default false) and 0038 adds
`authentication_sessions.subject_id` (nullable, FK to `subjects (realm_id,
id)`). `@odudu/authn-flows` gained `totpStep`/`otpApplicable`
(`src/service/authenticators/totp.ts`, a leaf in `password.ts`'s shape),
`beginTotpEnrolment`/`completeTotpEnrolment`, and
`renderTotpEnrolmentPage`, which draws the `otpauth://` URI as text and as
a QR code (`qrcode-generator` 2.0.4, exact, zero dependencies, confined to
the view layer). `executor.ts` registers `otp` for real: applicability is
now per-subject and per-realm, `AdvanceInput` carries `code`, and every
successful factor binds `subject_id` so a later factor cannot answer for
somebody else — a mismatch fails with `subject_mismatch`. The OTP step
looks its secret up by the bound subject, never by anything the form
submits. `credentialRepository.recordTotpUse` stores the accepted time
step as the credential's `lastStep`, which is the half of RFC 6238 §5.2's
no-replay rule `verifyTotp` leaves to its caller.

A realm that requires OTP from a subject with no credential cannot express
that as a step — asking for a code nobody can produce parks the login, and
the required-action gate sits downstream of a successful authentication —
so `advance` records the `configure-totp` required action instead, and
`POST /realms/{realm}/login-actions/required-action` (new, in
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
`authentication_executions`: one flat, ordered list per realm (`id`,
`realm_id`, `index`, `authenticator`, `requirement`), `requirement`
constrained to `required`/`alternative`/`conditional`/`disabled` and
`(realm_id, index)` unique. `@odudu/authn-flows` gained
`executionRepository` (`forRealm`, ordered by `index`; `create`) and
`provisionBrowserFlow`, which seeds `BROWSER_FLOW_DEFAULT` — `passkey` and
`password` at `alternative`, `otp` at `conditional` — for every realm.
`@odudu/domain-realm` does not depend on `@odudu/authn-flows` — the umbrella
spec fixes the direction the other way — so `provisionRealmDefaults` does not
call `provisionBrowserFlow` itself; a `dependency-cruiser` rule
(`no-domain-to-authn-flows`) forbids that edge, alongside `no-circular`,
which would also catch it (`authn-flows` now depends on `@odudu/domain-realm`
too, so the edge would close a cycle, not just point the wrong way).
`@odudu/authn-flows` exports `provisionRealm(tx, realmId)`, which calls
`provisionRealmDefaults` and then `provisionBrowserFlow` — the one function
a realm-creation site should call so the two cannot drift apart. The seed
CLI's two realm-creation sites (`apps/server/src/cli/seed.ts`) call it; so do
all but one of the ~25 protocol-oidc and domain-realm test fixtures that
stand up a realm, mechanically migrated from calling `provisionRealmDefaults`
directly. The one exception is `domain-realm`'s own
`provision-defaults.int.test.ts`, which cannot reach `provisionRealm` —
`domain-realm` sits underneath `authn-flows` in the dependency graph — and
still calls `provisionRealmDefaults` directly, with a comment saying why.
`provisionBrowserFlow` and `provisionRealmDefaults` both stay exported
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
realm from admitting anyone with no credential at all. `executor.ts`'s
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
realmId)` answers what a realm's flow would ask for first, with no session
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
performed" — was `deferred: P2` because no realm could ever reach a state
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
test including a foreign-`realm_id` probe (`ODUDU-AUTHN-SATISFIED-PERSISTENCE-01`),
realm-ordered dispatch asserting — not assuming — that `passkey`/`otp` are
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
`acrFor` returns this realm's own bare digit, which is neither, so that
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
the grant was issued under, and `sessions` needed a `UNIQUE (realm_id, id)`
it did not have before this so the composite foreign key could exist.
`tokenGrantRepository` gained `revokeForSession` and `bySession`, and
`rotateRefreshToken` refuses to rotate a revoked grant's refresh token
(`RotationOutcome`'s `'revoked'` case), answered with the same
`invalid_grant` a reused or unknown token gets.

**Migrations 0027 and 0028 give a session two clocks.** `sessions` gained
`last_active_at`, touched on every use; `expires_at` stays the hard
ceiling, `created_at` plus the realm's maximum lifespan. `realms` gained
`sso_session_idle_seconds` (default 1800) and `sso_session_max_seconds`
(default 36000), each bounded to `[60, 2592000]` by a `CHECK`, plus a third
`CHECK` refusing an idle timeout longer than the ceiling. `isSessionLive`
(`packages/authn-flows/src/service/session-liveness.ts`) treats both
boundaries as exclusive; `sessionRepository(tx).liveById` is the read
anything that authenticates should use, `byId` stays liveness-blind for the
reaper and a future session list, and `establishSession` now takes the
ceiling as a `maxSeconds` parameter instead of a fixed 12-hour constant. The
plan is
[2026-09-15-p2b-credentials-mfa-sessions.md](superpowers/plans/2026-09-15-p2b-credentials-mfa-sessions.md)
— 29 tasks, 211 steps, 95–125 h, three spike gates (Tasks 11, 17, 24), and
fourteen migrations numbered 0026–0039 in the table at its end, which
supersedes the spec's section 4 numbering. The
phase spec is
[2026-09-15-p2b-credentials-mfa-sessions-design.md](superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md),
on branch `p2b-credentials-mfa-sessions`. It settles nine design decisions
against stated alternatives — a flat per-realm flow, `jsonb` credentials
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
`__Host-<realm>-session` cookie P1 wrote and never read, resolves it
through `sessionRepository(tx).liveById` scoped to the realm's own idle
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
/realms/{realm}/protocol/openid-connect/logout` is new
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
`tokenGrantRepository(tx).revokeForSession`, one `withRealm` transaction.
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
token's gate, not the ID token's. See [docs/request-paths.md](request-paths.md#roles-once-a-scope-reaches-it)
for the walkthrough — its "I created a role and it is not in my token"
paragraph, and [README.md](../README.md)'s "Give ada a role" section, are
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
id and is unique per `(realm_id, lookup_key)`, which is what lets a
passwordless assertion resolve its subject without scanning `jsonb` across
a realm. `@odudu/domain-identity` gained `parseCredentialSecret` (a Zod
schema per type, `unknown` in, a narrowed discriminated union out — no
cast) and `credentialRepository` gained `listFor`, `byLookupKey`, `insert`,
`markUsed` and `deleteOne`; `passwordFor` and `setPassword` keep their exact
signatures. Nothing yet writes a `totp`, `webauthn` or `password-history`
row or reads `lookup_key` — that is TOTP, passkeys and password history's
own tasks to build on top of this.

**Task 13: every realm now carries a password policy, and every writer of
a password is bound by it.** Migration 0035 (numbered past the brief's
0034 — 0034 was already `user_credentials_types`, per Task 12 above) adds
nine columns to `realms`: `password_min_length` (default 8, floored there
by a `CHECK` so a realm cannot configure below it, ceiling 256),
`password_require_digit`/`_uppercase`/`_lowercase`/`_special` (all off by
default), `password_not_username`/`_not_email` (both on by default — `not_email`
matches the local part of the address, not the whole string, so a
candidate containing just the account-name half is refused the same as one
containing the username, and a subject whose username equals its email's
local part trips both rules at once, not either-or),
`password_history_depth` (0–24) and `password_max_age_days` (0–3650) — the
last two are columns with no reader yet; `update-password` is the task that
gives them one. `@odudu/domain-identity` gained
`evaluatePassword(candidate, policy, subject)`, a leaf service (no `tx`, no
clock) that returns every violated rule, not just the first, and counts
characters with `Array.from(candidate).length` rather than `.length` so an
8-emoji password is not miscounted as 16 characters. Three of the four
writers now call it: registration (`register.ts`), reset redemption
(`completePasswordReset`, checked against a non-consuming `peek` so a weak
password never burns the link), and both of the seed CLI's password-writing
paths (`--user`/`--password` and `seed user`) — there is no development
override for the seed CLI; it enforces the same policy every other writer
does. The fourth writer, the change-password required action, does not
exist until `update-password` lands; `apps/server/tests/password-policy.int.test.ts`
carries its case as `it.fails` rather than a skip, so it stays visible
until that task turns it into a plain `it`. That cross-cutting test lives
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

**Task 14 gives a realm-level requirement something to require against: a
pending action that blocks a login, not just an offer.** Migration 0036
(0035 was already `realm_password_policy`, per Task 13) adds
`user_required_actions` (`realm_id`, `subject_id`, `action`, `created_at`,
primary key on the first three, `action` constrained to the four decision
#1 fixes: `update-password`, `configure-totp`, `configure-passkey`,
`generate-recovery-codes`), RLS policy copied verbatim from
`authentication_sessions`' (`app.realm_id`, `nullif(..., '')`, no `WITH
CHECK`) rather than the brief's `current_setting`-named one, which a
`withRealm`-set session would never match. `@odudu/authn-flows` gained
`requiredActionRepository(tx)` (`pendingFor(subjectId)`,
`add(realmId, subjectId, action)` — `realmId` explicit, the same way every
other repository's insert in this codebase takes one, unlike the brief's
signature, which had no way to supply a fresh row's `realm_id` —
`complete(subjectId, action)`), `nextRequiredAction(pending)` (the fixed
order: password first, so an expired password is never usable to enrol a
second factor), and `renderRequiredActionPage(realm, authSessionId,
action)` — a page shell in the same dependency-free, `escapeHtml`-everything
style as `authorize-html.ts`, carrying the same hidden `auth_session_id`
CSRF field, with real fields only for `update-password` today (the other
three have no enrolment UI yet, the same gap `executor.ts` already has for
`passkey`/`otp`).

`login-submission.ts`'s `handleLoginSubmission` gates on
`nextRequiredAction(await deps.pendingActions(realm.id, result.subjectId))`
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

**What this task does not build.** No route answers
`POST /realms/{realm}/login-actions/required-action` yet — the page's form
posts there, but nothing is registered to receive it, so
`apps/server/tests/password-policy.int.test.ts`'s
`it.fails('refuses a weak password at the change-password required
action', …)` still fails exactly as before (a 404 where it expects 400),
for the same reason its comment gives: that writer does not exist yet.
Nothing seeds `user_required_actions` in any live path either, so no
existing realm's login behaviour changed — the mechanism exists; nothing
yet turns it on.

**Reaping now covers five tables, not four, and ADR 0021's warning covers
all five.** P2a added `action_tokens` (email verification and password
reset links) alongside `sessions`, `authentication_sessions`,
`authorization_codes` and `refresh_tokens` — all five carry `expires_at`
(or, for `action_tokens`, `consumed_at`) with no `DELETE` anywhere in a
repository. The dead rows are load-bearing: `action_tokens` needs its
consumed and expired rows kept for the same reason a consumed
`authorization_codes` row is kept, so that a replayed link can be told from
one that never existed rather than silently treated as fresh. A reaper that
deletes eagerly breaks replay and reuse detection on **any** of the five
while leaving every test that only checks "was the request refused" green —
see "Do not write `DELETE … WHERE expires_at < now()`" below, which now
applies to `action_tokens` too.

**A trap P2b will walk into: reading the SSO cookie at `/authorize`
bypasses the email-verified login gate unless it re-checks it.** Today the
cookie is written at login and never read (`/authorize` starts a fresh
authentication every time), so the gate that refuses to complete a login
for an unverified self-registered address only has one door to guard: the
form POST. That gate lives in `login-submission.ts`, reached only through
`POST /realms/{realm}/login-actions/authenticate`. The moment `/authorize`
can complete a request from a cookie instead of a form submission, that
check needs to run on the cookie path too, or an unverified user who
happens to hold a live session cookie signs back in for free. Nothing
today would catch this by accident — the form-POST tests exercise the form
POST.

**Rate limiting was always P2b's, and P2a's registration endpoint widens
what it needs to cover.** There is no rate limiting or lockout anywhere in
the repository. `POST /realms/{realm}/login-actions/registration` is
unauthenticated and performs one Argon2id hash at 19 MiB per request with
no maximum password length; Fastify's 1 MB body limit is the only ceiling
on the request itself. Before P2a this was "guess a password against an
existing account"; now it is also "burn CPU with no account requirement at
all" — a cheaper attack for the same missing control.

**A stated limitation, not an accident: the password-reset request endpoint
awaits the SMTP send before responding.** An existing address is therefore
measurably slower to answer than an unknown one, even though the response
body and status are identical — a timing oracle where the visible channel
is closed. Closing it needs an outbox table and a background sender to take
the send off the request path, which is the first background loop the
codebase would have and a second table nothing deletes from; this phase's
design spec rejected building one. [README.md](../README.md)'s "Known
limitation" paragraph, right after the password-reset walkthrough, states
it for a reader; this is the record that it was a judgment call, not an
oversight, so P2b inherits a decision rather than a bug report.

**New environment variables.** `ODUDU_PUBLIC_BASE_URL` — the origin every
mailed link is built from, never from a request's `Host` header, which is
client-controlled; sending fails closed (500, logged as a misconfiguration)
when a realm needs to mail and this is unset. The `ODUDU_SMTP_*` set —
`ODUDU_SMTP_HOST`, `ODUDU_SMTP_PORT` (default `587`), `ODUDU_SMTP_FROM`,
`ODUDU_SMTP_USERNAME`, `ODUDU_SMTP_PASSWORD`, `ODUDU_SMTP_STARTTLS` — with
`ODUDU_SMTP_HOST` unset, the server logs every message instead of sending
it, which is what the compose stack does today.

**Migrations now run to 0026.** `packages/db/drizzle/0023_users_email_unique.sql`
is the realm-scoped `(realm_id, email)` uniqueness self-registration needs;
0025 is the last one P2a added. 0026 (`token_grants_session`) is P2b's
first, and the plan's own table numbers the rest through 0039.

That is P2a done. **P2b** takes what P2 always meant: the flow tree with
TOTP and passkeys, password policies, brute-force protection (a clause row
already records it as `deferred: P2`, and means this half), session idle and
maximum lifespans, offline access, an SSO session that is **read** as well as
written, and RP-initiated logout to end it. Odudu now serves the OAuth 2.1 /
OpenID Connect core plus the full P2a identity model. The rest of this file
is the record of how P0 and P1 happened; what follows below this point is
kept for that history, not as current guidance.

**Nothing is ever deleted, and P2b now owns fixing that — five tables, not
four (see above).** The tables carrying `expires_at` or `consumed_at` —
`sessions`, `authentication_sessions`, `authorization_codes`,
`refresh_tokens`, `action_tokens` — enforce expiry (or consumption) at read
time, so an expired or spent row can never be redeemed, and **no repository
contains a `DELETE`**. Every `/authorize` request leaves an
`authentication_sessions` row behind holding `client_id`, `redirect_uri`,
`scope`, `state`, `nonce` and `code_challenge`, whether the login completed
or was abandoned; every refresh rotation leaves a `refresh_tokens` row,
about 288 per session per day for a client refreshing every five minutes;
every mailed link leaves an `action_tokens` row. It is P2b's because P2b
owns the session idle and maximum lifespans, and a lifespan says when
something stops working, not when it stops existing.

**Do not write `DELETE … WHERE expires_at < now()`.** Replay detection reads
the dead rows. `rotateRefreshToken`
(`packages/protocol-oidc/src/usecase/refresh-rotation.ts`) tells reuse from an
unknown token by reading the already-used row back through
`refreshTokenRepository.byHash`; delete it and a replayed token returns
`{ kind: 'unknown' }` instead of `{ kind: 'reused' }`, so the request is still
refused with the same `invalid_grant` the client would have seen anyway and
**family revocation silently never fires**. A consumed `authorization_codes`
row is the same: revoking the grant on a replayed code depends on the row
existing. Retention is bounded below by the **detection window — the life of
the grant family — which is a different and much larger number than the token
TTL.** Whatever reaper P2b writes needs a test that replays a consumed
credential after a reaping pass and asserts the family was revoked; asserting
the request was refused proves nothing, because the broken implementation
refuses it too. **ADR 0021** has the decision, what the specifications do and
do not require (they require nothing about retention — that was read, not
recalled), and what Keycloak does instead.

**P2 now owns logout, which the roadmap had never assigned to anyone.**
RP-initiated logout (`end_session_endpoint`) belongs to the phase that makes
the SSO session real: P1 writes a session cookie and never reads it, so an
endpoint ending a session nothing consults could only assert that a row
changed. Make the session load-bearing and make it endable in the same
phase. Front-channel and back-channel logout are P3's — both are addressed
to a client and need a registered logout URI, and back-channel issues a
logout token, which is a second token type and therefore its own clause
table. Section 11 of the design spec carries the full reasoning.

**Comment blocks are capped at eight lines, and the cap is a test.** An
essay belongs in an ADR or a `docs/protocols/` reading note with a one-line
pointer back, not above the function it concerns.
`tests/lint/comment-block-length.test.ts` enforces it over both source trees
with no allowlist and no inline waiver; blank lines do not split a block and
over-long lines are weighed by width, so neither dodge works. This exists
because comment density on this branch ran from 3% of added lines to 42%
before anybody noticed — the rule was in `CLAUDE.md` the whole time and
nothing could tell a well-commented file from an over-commented one.

**`pnpm trace` runs strict, and a new MUST that is not `covered` costs
something in every one of the six statuses.** That is the one workflow
change to know. Add a clause row for every MUST and SHOULD P2 introduces,
and close it with a test id. Left `gap` or `documented:`, a MUST is an error
under `pnpm verify`, not a warning to be triaged later. Recorded
`accepted:`, it warns on every run and its reference must quote a heading
the tool checks still exists. Recorded `deferred:` or `n/a:`, it prints
nothing — but the count of MUSTs each clause table silences that way is
recorded in `tools/trace/silenced-musts.json`, the tool requires the
recorded number to equal the number it finds, and a new one therefore fails
the build until somebody raises the count in a diff a reviewer sees.
The six statuses and what each is for are in
`docs/protocols/rfc6749.md`'s reading note "The six statuses, and what the
two prose ones are for"; why the silent two are held by a census rather than
by printing is in ADR 0017's 2026-09-12 amendment.

**Eighteen MUSTs are `accepted:`, and they are not work items.** Seventeen
of them come to the same thing — a property of a connection this process
does not terminate. Fifteen are one claim in five specifications' words:
that TLS is present, and good, on the wire. Odudu serves HTTP behind a
reverse proxy, so nothing here can observe a ciphersuite, a certificate, or
whether the bytes were encrypted; closing them needs Odudu to terminate TLS
itself, or evidence gathered where the connection actually is. Neither is a
test in this repository, and neither is P2's job. The other two are the
`https` half of an issuer identifier (OIDC Core §2 and RFC 9207 §2):
`realmIssuer` builds the identifier, but the scheme is whatever the proxy
asserts through `X-Forwarded-Proto`, and closing those needs a scheme this
process establishes rather than reads off a header. The eighteenth is RFC 6749 §10.10's umbrella sentence, which is fully held —
by three test ids, where a row can carry one. Each cites the reading note
that explains it, and `pnpm trace` fails if that note is renamed away. ADR
0017 records the status, and the hole in strict mode it deliberately opens.

**The TLS posture, stated once.** `assertProductionTls`
(`apps/server/src/config-guard.ts`) refuses to boot with `NODE_ENV=production`
and `ODUDU_TLS` off. That is what closes the rows phrased as the server
_requiring_ TLS, and it rests on **two** operator assertions, not one:
`NODE_ENV` gates the guard and is exactly as operator-controlled as
`ODUDU_TLS` — `infra/docker/compose.yaml` turns the guard off with one line,
legitimately, because it serves plain HTTP on loopback.
`infra/conformance/compose.yaml` is the stack that runs the production
configuration behind real TLS.

**Key rotation is still owed.** `signing_keys` carries `status`
(`active` / `rotating` / `retired`) and `not_after` from migration 0003;
JWKS publishes every non-retired key, signing selects the active one, and
`signing_keys_one_active` permits exactly one active key. The _operation_
that promotes and retires keys does not exist. It is **P4**'s as of
2026-09-14, and P4's exit criterion names it: no relying party's request
triggers a rotation, so it needs the authenticated administrator, the audit
event and the surface P4 builds, none of which P3 has. Nothing in P2 needs
it, and nothing forbids an earlier CLI, but a deployment running long enough
to want a new key today has no supported way to get one.

**47 rows are `deferred:`, and 11 of them name P2**: ten in
`docs/protocols/oidc-core.md` and one in `docs/protocols/rfc6749.md`. They
are the clauses that need a reusable session to have a reachable branch at
all — `prompt=login`'s "an error is returned if reauthentication cannot be
performed" is the shape of them, unreachable while `/authorize` starts a
fresh authentication every time and never reads the SSO cookie it sets.
Read them before scoping P2; they are its requirements, already written
down. The other 36 are P3's (consent, dynamic registration, audience
configuration, RFC 8707 `resource` indicators) — all of which P3's exit
criterion now names, along with consent and signed or encrypted UserInfo
responses, none of which it named before 2026-09-14.

**Known limitations carried into P1 are still carried**, at the end of this
file — the `id_token_hint` audience, cookie namespacing, the single RLS
policy, the native-module bundling trap `@node-rs/argon2` walks into in P2,
and the migration runner's missing advisory lock.

**The last of OIDC Core's MUST gaps.** `docs/protocols/oidc-core.md` went
from 29 MUST rows with no test to 6. Twenty-two were closed — the ID
Token's REQUIRED claims and its signature read off a token `/token`
actually returned, the Token Endpoint's registered-authentication-method
rule, the `id_token` that arrives exactly when the code was issued for a
request carrying `openid`, the Token Error Response's media type and
status, the UserInfo endpoint's RFC 6750 §3 error shape, RS256, and
`auth_time` — and seven of those cite RFC 6749 assertions rather than new
tests, because §3.1.3.2 restates §4.1.3's verification steps for the OIDC
case and Odudu has one token endpoint. One row moved to `deferred: P2`:
`prompt=login`'s "an error is returned if reauthentication cannot be
performed" has no reachable branch until a session can be reused, which is
what `deferred:` is for.

**A covered row was passing for a reason that was not the requirement.**
`RFC9068-2.1-03` proved "no key may spell `none`" by inserting
`alg = 'none'` with `status = 'active'` and asserting the insert fails. It
does fail — because of `signing_keys_one_active`, the unique index that
refuses any second active key whatever its algorithm. Relaxing
`signing_keys_alg_check` to admit `'none'` left the test green. Both that
assertion and the new `OIDC-CORE-2-06` now offer the probe row as
`retired`, so the algorithm check is the only thing that can turn it away,
and the relaxed-constraint breakage proof turns both red.

**Six oidc-core MUSTs stay `gap` on purpose**, with a reading note each:
§3.1.2, §3.1.3, §5.3 and §16.17 ×2 are TLS on the wire, and §2's `iss` row
asks for an `https` scheme this process does not choose — the same operator
assertion `docs/protocols/rfc9207.md` already declines to treat as proof.
That call has since been made: all six became `accepted:` rows, and strict
mode is now `pnpm trace`'s default. **ADR 0017** records the status, the two
options rejected, and the hole in strict mode a tolerated status is.

**Two defects found by reading a row against its test.** Both were found
while writing clause tests, and both were real rather than theoretical.

`readOptionalField` (`packages/protocol-oidc/src/usecase/token-issuance.ts`)
returned `''` for a parameter sent with an empty value, where RFC 6749 §3.2
requires it to be read as omitted. Its two callers are `client_secret` and
`client_id`; the first one mattered. A redemption carrying an
`Authorization: Basic` header **and** `client_secret=` was refused 401
`invalid_client` as two authentication methods presented at once (§2.3.1),
where the identical request with the parameter left out returned 200 — the
rule being applied was right and its trigger was wrong. §3.2's row is now
`RFC6749-3.2-04` rather than a gap, and the test is built around the
optional parameter, because a required one cannot tell empty from absent:
both fail it identically. The reading note under "The default scope, and
the empty parameter value" records why that distinction is the whole of
the row.

**Nothing is consumed on the refresh grant until the grant has been
evaluated.** `issueRefreshTokens` rotated first and checked the
token-to-client binding afterwards. The binding was enforced — so no MUST
was broken — but rotation marks the presented token used and commits in
its own transaction, so any client registered in the realm that learned
another client's refresh token could burn it: the victim's next legitimate
refresh was then detected as reuse, and reuse revokes the entire family.
Reuse detection is one of this phase's headline security properties, and
it was usable as a weapon against the client it exists to protect. The
same was true of a client's own request that merely asked for a wider
scope than it was granted.

`evaluateRefreshGrant` now runs on both sides of the rotation. Before it,
from a read-only lookup, as a gate that can only refuse: a request that
was never going to succeed marks nothing used. After it, against the grant
the rotating transaction itself read, as the decision that governs — a
family revoked between the two reads must not still yield an access token.
What is atomic is unchanged and deliberately so: the single-use `consume`
in `refreshTokenRepository` is still one `UPDATE ... WHERE used_at IS NULL
AND expires_at > now() RETURNING *`, and it alone picks the winner between
two concurrent redemptions. Adding a read in front of it cannot turn that
into a race, because the read grants nothing — two concurrent redemptions
by the rightful client both pass the gate, and exactly one `UPDATE` still
matches. The widened window can only produce additional refusals, never an
additional success.

`client_oidc_config_refresh_token_ttl_floor` (migration 0014) puts a floor
of one second under `refresh_token_ttl_seconds`, which had no bound of any
kind. Zero or less issues a refresh token that expired before the client
received it, indistinguishable to every caller from one that was never
issued. There is deliberately **no** ceiling to match 0013's hour: an
`at+jwt` access token is self-contained, so its TTL is the whole
unrevocable window, whereas every refresh token presentation is a database
round-trip that reads the grant — revoking the grant ends it whatever the
column says, which makes the TTL an idle timeout rather than exposure. No
clause row asks for a number and none is derivable, so none was invented.

**`prompt` and `id_token_hint` are answered at `/authorize`.** OIDC Core
§15.1's mandatory `prompt` behaviours are implementable without P2's
reusable session: `/authorize` starts a fresh authentication every time and
never reads the SSO cookie it sets, so no End-User is ever already
authenticated there and `prompt=none` is `login_required` unconditionally —
§3.1.2.3's actual requirement, not a stand-in. `none` beside any other
value is refused (§3.1.2.1 makes them exclusive), as is a value outside the
four the specification defines. `id_token_hint` is verified as a token this
realm signed carrying this realm's `iss` (§3.1.2.2) against the same keys
`/jwks` publishes, before the prompt is acted on; the validated subject
rides on the parked request, so a sign-in by somebody else answers
`login_required` with no code, no cookie and no consumed authentication
session. Two rows stay `gap` knowingly — see the reading note in
`docs/protocols/oidc-core.md`.

**`pnpm trace` consults every test result carrying a row's id, not the
last one.** A `describe('[ID] …')` holding several `it`s reports one result
per `it`, all under that id, so an id naming several results is the
ordinary case — 55 of 104 ids in a full run. Indexing one result per id
kept whichever the reporter emitted last, and a red test could reconcile
its row green behind a passing sibling. A row is now covered only when
every result carrying its id passed, and the finding names the test that
failed.

**Three defaults that were safe by accident.** An access token's lifetime
now has a ceiling the server owns rather than one its clients happen to
choose: `client_oidc_config_access_token_ttl_ceiling` (migration 0013)
holds `access_token_ttl_seconds` between 1 second and one hour, so no row
a longer-lived token could be issued from can exist. The bound sits on the
column rather than at issuance deliberately — a clamp while minting would
issue something other than the registration says, and would be true only
of the code path that remembers it, while a constraint is true of every
writer including the admin API that does not exist yet. Raising it costs a
migration on purpose. That closes RFC 6750 §5.2's "token lifetime is
limited" and §5.3's "one hour or less" with a test about what the database
will hold at all plus the `exp - iat` of a token issued for the
longest-lived client that can exist — not about a fixture's own TTL.

`verifyJwt` no longer accepts a token with no audience policy stated:
`audience` is a required argument, and a call site that is genuinely not
the token's audience — the OP reading an `id_token_hint`, whose `aud` is
the requesting client — passes `AUDIENCE_UNCHECKED`. An optional option
made RFC 7519 §4.1.3 switch off by silence, which is what let a token
minted for another audience reach `/userinfo`; the type now carries the
guarantee, and `packages/crypto/src/service/sign.test.ts` holds it with a
`@ts-expect-error` that `pnpm typecheck` fails on the moment the argument
becomes optional again. **`packages/protocol-oidc/src/usecase/authorization-request.ts`
was the one live call site that named no audience.** Whether an
`id_token_hint` issued to one client should be honoured when presented by
another is left open, and recorded under "Known limitations" below.

RFC 7519 §4.1's `jti` row is closed where the claim is actually minted
(`packages/protocol-oidc/src/usecase/token-issuance.ts`), by asserting
that an access token fetched from `/token` carries a uuidv7 and that two
of them differ — `packages/crypto` could never have answered it, since
`signJwt` assigns no `jti`.

**The issuer, TLS, userinfo POST and email.** The issuer is canonical
again: the previous increment's move to `request.host` kept a non-default
port but let `Host: idp.example:443` and `Host: idp.example` become two
issuers for one deployment, which `/userinfo` — verifying an access token
against the issuer recomputed from that request's Host — turned into a 401. The scheme's default port is now dropped and every other port kept,
IPv6 literals included, and `realmIssuer` joins base and realm in one
place all five producers use.

`ODUDU_TLS` is no longer advisory: with `NODE_ENV=production` and TLS
unasserted, the server refuses to boot. That closes the four RFC 6749 rows
phrased as _the authorization server requires TLS_ and nothing else — a
boot guard proves an operator was made to assert TLS, not that TLS is on
the wire, and `docs/protocols/rfc6749.md`'s reading note names every row
it deliberately leaves as a gap. The development compose stack now says
`NODE_ENV=development`, since it serves plain HTTP on loopback;
`infra/conformance/compose.yaml` is the stack that runs the production
configuration behind real TLS.

`/userinfo` answers POST as well as GET (OIDC Core §5.3), accepting the
token in the `Authorization` header or, on a POST, in a form-encoded
`access_token` body (RFC 6750 §2.2) — the reading note that excused
GET-only contradicted a MUST and is corrected. Both methods present at
once is §3.1's `invalid_request`. `/authorize` and `/userinfo` now share
one media-type rule, which also answers a body arriving with no
`Content-Type` rather than letting Fastify's own 415 reply in a second
representation.

`email` is constrained **on the column it is emitted from**
(`users_email_addr_spec`, migration 0012), against a stated subset of RFC
5322 addr-spec rather than an approximation of the whole grammar — see the
reading note in `docs/protocols/oidc-core.md` for what the subset refuses.
Validating in `userRepository.create` alone left OIDC Core §5.1 enforced
on no path that produces a claim: nothing in production passed an email to
that method, and every `email` Odudu emitted was inserted raw by a test
helper. The repository keeps its check as the friendlier, earlier refusal;
a parity assertion holds the SQL and TypeScript spellings of the subset in
agreement case by case. `seed --email` exists so the user every demo and
end-to-end run authenticates as can carry the claim at all.

The traceability tables have a fifth status, `documented:`, for the
clauses that oblige an authorization server to _state_ something (RFC 6749
§3.3's scope defaults). Its reference must quote a reading-note heading of
its own file and `pnpm trace` checks the heading still exists, so the
promise that prose exists is enforced rather than trusted. A MUST recorded
this way is reported, and fails under strict mode. (A sixth, `accepted:`,
followed it and is held to the same check — see ADR 0017.)

The TLS reading note now says that four `covered` rows rest on **two**
operator assertions, not one: `NODE_ENV` gates the guard and is exactly as
operator-controlled as `ODUDU_TLS` — `infra/docker/compose.yaml` disables
the guard on the production image with one line. `README.md`'s deployment
steps and `.env.example` document the guard.

OIDC Core §3.1.2.6's "no other parameters on an error response" is
recorded as a knowing deviation rather than a gap: RFC 9207 §2 MUSTs `iss`
onto every authorization response, and a future reader closing that gap
would delete a mix-up-attack countermeasure.

**The authorization endpoint's normative gaps.** `iss` now rides on error
authorization responses as well as successful ones (RFC 9207 §2, whose
single MUST is tabled as two rows precisely because one row covered by a
success-path test is what hid the omission); an empty parameter value is
treated as omitted (RFC 6749 §3.1); an unsupported `response_mode` is
refused with a bare HTTP 400 and discovery states
`response_modes_supported: ["query"]` rather than inheriting Discovery
§3's `["query", "fragment"]` default; `request` and `request_uri` are
answered with `request_not_supported` / `request_uri_not_supported`
instead of being dropped in silence; and `code_challenge` is checked
against RFC 7636 §4.2's shape, sharing one pattern with the verifier. The
issuer has one definition (`packages/protocol-oidc/src/view/issuer.ts`),
which fixes the dropped-port bug recorded below.

Before any endpoint code, write the clause tables:
`docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md`, mapping each
MUST and SHOULD to the test that covers it (design spec, section 10). That
table is what makes "P1 is done" countable instead of a feeling, and it is
the same activity as the learning goal.

Then follow the phase sequence in `CLAUDE.md` — brainstorm P1's scope,
write its spec and plan, execute it task by task.

Everything below is the record of P0: what it delivered, what it
deliberately deferred, and the decisions taken with their trigger
conditions.

---

**Task 19: the conformance harness.** `infra/conformance/` stands up the
OpenID Foundation suite (pinned `release-v5.1.36`) against odudu. Both
open spikes are answered and recorded in `infra/conformance/README.md`:
a Config OP plan demands `https://` unconditionally (verified against the
suite's own source and by provoking the failure directly), and Config OP
is fully driveable through the suite's HTTP API with no browser and — in
the dev-mode setup this harness uses — no token either. `compose.yaml`
puts a self-signed-TLS `nginx` proxy in front of the otherwise-unmodified
odudu container (`ODUDU_TLS=true`, `ODUDU_TRUST_PROXY=true`), which is the
trigger condition Task 10's `__Host-` cookie fallback was waiting for.
`.github/workflows/verify.yml`'s new `conformance` job runs Config OP on
every push to `main` and every pull request, mirroring `container`'s
structure.

Running the **Basic OP** plan (35 modules, `results/`) exposed a genuine
conflict, now settled in **ADR 0016**: odudu requires PKCE on every
`authorization_code` request, and Basic OP — a profile written before PKCE
was mandatory anywhere — sends plain requests in every module but its own
PKCE one, which passes. The ruling is that mandatory PKCE stays and the
exit criterion changes. Odudu does not claim Basic OP certification.

The run stays, with its purpose changed: it is the evidence that the only
divergence is the intended one. That holds only while every module's cause
is individually confirmed, which is why `infra/conformance/README.md`
carries a per-module inventory rather than a summary. The first summary
written for this run said "30 failures, one cause" and concealed an
unimplemented MUST — OIDC Core §3.1.2.1 requires POST at the authorization
endpoint, and it returned 404.

A latent, unrelated bug surfaced while wiring the TLS proxy, and has
since been fixed: odudu's issuer and endpoint URLs were built from
Fastify's `request.hostname`, which silently drops the port even when
`X-Forwarded-Host` supplies one under `trustProxy` — verified directly
against the container. The conformance proxy sidesteps it by listening on
the default HTTPS port 443, so no conformance run would have caught it.
There is now one issuer definition, built on `request.host`
(`packages/protocol-oidc/src/view/issuer.ts`), with `issuer.test.ts`
driving Fastify directly for the ports the proxy never exercises.

---

**Position:** P0 complete. All exit criteria met:

- `pnpm verify` green locally and in CI (format, typecheck, lint,
  boundaries, unit, integration)
- the server boots in a container and reports ready; CI proves it on every
  push
- the migration runner is proven, including idempotency
- ADRs 0001–0013 committed
- dependency-cruiser enforces both package and layer boundaries, with
  fixtures proving the rules reject violations

**Task 9: container, compose, and the boot proof.** The bundler path was
taken, not the `pnpm deploy` fallback: `apps/server` builds with tsup
(`noExternal: [/.*/]`, ESM, `target: node24`), and the bundle was run for
real against a live PostgreSQL container before it went anywhere near the
Dockerfile — pino's transport machinery, the documented risk, did not
misbehave under the bundle. The multi-stage `infra/docker/Dockerfile` builds
with `pnpm --filter @odudu/server build` and ships only `dist/` plus a
separately-copied `packages/db/drizzle` (bundling destroys the
`import.meta.url`-relative path `MIGRATIONS_DIR` computes, so the directory
is passed explicitly via `ODUDU_MIGRATIONS_DIR`). The runtime stage runs as
a non-root `odudu` user — confirmed inside a running container
(`uid=100(odudu) gid=101(odudu)`), not just read off the Dockerfile.

`infra/docker/compose.yaml` uses two connection strings on purpose:
`ODUDU_DATABASE_URL` (the `odudu` owner) runs migrations; the server itself
serves on `ODUDU_APP_DATABASE_URL` (`odudu_svc`), which is subject to the
`realms_isolation` RLS policy from Task 7. Verified from inside the running
stack, not asserted: `psql -U odudu_svc -d odudu -c 'select count(*) from
realms;'` returns `0` (not a permission error), and `select policyname from
pg_policies where tablename = 'realms'` returns `realms_isolation`. Setting
`ODUDU_APP_DATABASE_URL` also means `main.ts`'s bypass warning never fires
in the compose stack — confirmed absent from the container's logs.

Wiring `odudu_svc` into RLS originally needed a workaround the brief's
literal SQL did not have — see "Review fixes" below for the finished
shape. `infra/docker/initdb/01-app-role.sql` now creates `odudu_app`,
`odudu_svc`, and grants membership between them during Postgres cluster
init, all before the `odudu` container (and therefore any migration) ever
starts. `packages/db/drizzle/0001_row_level_security.sql`'s `CREATE ROLE
odudu_app` is guarded (`IF NOT EXISTS`) so it still creates the role in
the integration-test path, where no `initdb` script runs and
`@odudu/testkit`'s `createAppRole` grants membership explicitly after
migrations, the same as before. `packages/db/drizzle/0002_grant_service_role.sql`
is kept as a harmless guarded no-op backstop rather than deleted (Drizzle
already recorded it applied); its comment is now explicit that it does not
make every ordering safe — see "Review fixes" for the production ordering
it still cannot repair.

The host-side `postgres` port in `compose.yaml` was moved from `5432` to
`5442` (the container still listens on 5432) because this machine already
has a native PostgreSQL bound to host port 5432; changing the host mapping
rather than the in-container port keeps every service in the file
addressing postgres by its default port. Both host-side ports
(`127.0.0.1:5442:5432` and `127.0.0.1:3000:3000`) are now bound to
loopback only — see "Review fixes".

`infra/docker/smoke.sh` brings the stack up, polls `/health/ready` for up
to 120s, then asserts from inside the running stack that `odudu_svc` can
query `realms` and sees `0` rows (not a permission error) and that the
`realms_isolation` policy exists, before tearing the stack down on exit
either way. It is the `container` job in `.github/workflows/verify.yml`,
run on every push alongside the existing `verify` job.

**Review fixes (post-merge hardening of this task).** A scoped review
found three hardening gaps and two smaller issues, all now closed:

1. `smoke.sh` originally only probed `/health/ready`, which runs `select 1`
   and needs no table privilege — it could not tell a working RLS grant
   from a broken one, and both smoke runs during the original
   implementation were green before and after the grant migration existed.
   `smoke.sh` now runs the brief's step 8 as hard, automatic assertions
   (query `realms` as `odudu_svc`, expect `0` not `permission denied`;
   query `pg_policies` for `realms_isolation`) so CI enforces this on every
   push. Verified by breaking the grant deliberately (commenting out both
   the `initdb` grant and the 0002 migration's grant) and confirming
   `smoke.sh` still reports `odudu became ready` but then fails on the new
   check with `permission denied for table realms`, not a readiness
   timeout; restored, and confirmed green again.
2. The grant migration's `IF EXISTS` guard made it a permanent silent
   no-op in a third ordering — `odudu_svc` created by tooling after
   migrations, with nothing playing `createAppRole`'s part — which is
   invisible to `/health/ready` forever after. Fixed by moving role and
   membership provisioning for the compose stack into
   `infra/docker/initdb/01-app-role.sql`, which always runs before
   migrations, rather than depending on a migration to grant membership
   into a role that may not exist yet. `0001`'s `CREATE ROLE odudu_app`
   was made idempotent so it still works standalone in the
   Testcontainers-based integration-test path. `0002` is kept as a
   redundant backstop with an honest comment about what it still cannot
   fix (a real deployment with a third provisioning path).
3. `compose.yaml` committed a plainly-passworded Postgres and app server
   published on `0.0.0.0`, unmarked, in a public repository for a security
   product. Added a header comment stating this file is local-development
   only and the credentials are public knowledge, and bound both publishes
   to `127.0.0.1`.
4. The Dockerfile's build stage did not copy the root `.npmrc`
   (`engine-strict=true`), so the image build silently ran `pnpm install`
   with engine enforcement off. Added `.npmrc` to the `COPY`.
5. `smoke.sh`'s `cleanup` trap ran under `set -e`; a failing
   `docker compose down` could mask a pending success exit code. `cleanup`
   now tolerates its own failure.

**Carried review item, closed:** Task 8 added a `res` serializer so
`res.headers["set-cookie"]` redaction was live but unproven.
`apps/server/src/logger.test.ts` now has a test that sets a real
`set-cookie` header on a reply via `buildApp`/`inject()` and asserts the
cookie value is absent from the captured log while `[redacted]` is present.
Confirmed this test actually exercises the redact path: removing
`'res.headers["set-cookie"]'` from `logger.ts`'s redact paths makes it fail
with the raw cookie value in the log line.

**Next increment:** P1.1 — begin the OAuth 2.1 / OIDC core. Start by
writing `docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md` with
the clause tables described in spec section 10, before any endpoint code.
The requirement table is what makes "P1 is done" countable.

**Verify:** `pnpm verify` exits zero; `./infra/docker/smoke.sh` exits zero
(one-time setup: `cp infra/docker/.env.example infra/docker/.env` — the
stack deliberately refuses to start without it, see ADR 0015; CI does this
itself as an explicit step in `.github/workflows/verify.yml`'s `container`
job).

**Blocked on:** nothing.

**Known limitations carried into P1:**

- An `id_token_hint` is verified with `AUDIENCE_UNCHECKED`: this server
  checks that it issued the token (OIDC Core §3.1.2.2) but not that the
  client presenting it is the one the token was issued to. The hint only
  constrains which End-User may complete the login, so a foreign hint
  grants nothing; tightening it to the requesting `client_id` is a
  behaviour change that wants its own clause row and test.
- Realm cookies are namespaced rather than host-isolated (spec section 6).
- Only the `realms` table has an RLS policy. Every new tenant table needs
  `ENABLE`/`FORCE ROW LEVEL SECURITY` plus a policy, and a foreign-realm
  probe in the adversarial suite.
- The server bundle inlines all dependencies (tsup, `noExternal: [/.*/]`).
  P2 introduces `@node-rs/argon2`, a native module that must be marked
  external in `tsup.config.ts` regardless of which bundling path is in use
  by then — a native `.node` binary cannot be inlined into an ESM bundle.
- `infra/docker/compose.yaml` publishes postgres on host port `5442`
  instead of the default `5432` to avoid colliding with a native postgres
  on the development host; anyone connecting to the compose stack's
  database directly from the host needs to use that port. Both host
  publishes are bound to `127.0.0.1`, and the file is local-development
  only — its credentials are fixed and public.
- `infra/docker/initdb/01-app-role.sql` is what makes `odudu_svc`'s RLS
  grant reliable in this repository's only deployment surface (compose). A
  real production deployment that provisions `odudu_svc` a different way —
  after migrations, with nothing playing the part of that script or
  `@odudu/testkit`'s `createAppRole` — would still hit the silent,
  permanent no-op described in `packages/db/drizzle/0002_grant_service_role.sql`'s
  comment: Drizzle marks the grant migration applied on the first run
  regardless, and no later redeploy repairs it, while `/health/ready` stays
  green throughout. There is no production deployment target yet to build
  the equivalent safeguard for; whoever adds one needs an explicit,
  idempotent, post-migration provisioning step for this role, not a
  migration.
- `databaseModule` runs `runMigrations` on every boot, from every process,
  with no advisory lock. One replica is fine; the three replicas P11
  promises would all attempt the migration runner concurrently on
  deployment, racing each other. Whoever adds the second replica needs a
  `pg_advisory_lock`-guarded runner (or an out-of-band migration step) before
  scaling `odudu` horizontally.
- The plan for this phase listed `apps/server/src/context.ts` as a file to
  create. It was never created — its job (correlation id generation,
  per-request setup) folded into `app.ts`'s `genReqId` option and its
  `onRequest` hook instead, which turned out to be all that was needed.

**A clause row concealed missing security work for the thirteenth time, and
the first time it was security work.** OIDC Core §3.1.2.3 asks for CSRF
_and_ clickjacking countermeasures in one sentence; one row carried both
against `OIDC-CORE-3.1.2.1-05`, which asserts the CSRF half only, and no
clickjacking defence existed anywhere in the repository. It does now —
`Content-Security-Policy: frame-ancestors 'none'` with `X-Frame-Options:
DENY` beside it, on every page this server renders, set at a single choke
point (`packages/protocol-oidc/src/view/html-response.ts`) that
`html-response.test.ts` keeps single by failing the build if any other file
in the view layer names the HTML media type. The row is now two rows with
two test ids, which is the arrangement that cannot lose a half silently: one
id carried by two tests stays green when one of them is deleted, two ids do
not. **The general rule: a row's requirement text names one obligation, and
a conjunction in the specification's words is a reason to split the row.**
The clickjacking obligation on the authorization server is RFC 6749 §10.13
and needs a row of its own in `docs/protocols/rfc6749.md`, which has none.

**Two of the six statuses failed a build over nothing.** `deferred:` and
`n/a:` were skipped before any level check, so a MUST silenced with either
produced exit 0 and no output at all — not even the warning `accepted:`
gets. They are still quiet per row, on purpose: 111 MUSTs sit behind them,
and printing 111 lines would bury the 18 `accepted:` warnings rather than
surface anything. What changed is that the counts are recorded per clause
table in `tools/trace/silenced-musts.json` and required to match exactly, so
silencing a new MUST now fails strict trace until somebody raises a number
in a reviewed diff. ADR 0017's 2026-09-12 amendment has the ruling, what it
buys, and the two ways it can still be defeated.

## Login page theming, for P2 to decide

The design spec lists `ThemeProvider` among `kernel`'s registries (section 8)
and puts theming in P10, whose exit criterion is that a third-party provider
loads without a rebuild. Nothing is in place yet: the registry does not exist,
and the sign-in and error pages are hardcoded HTML in
`packages/protocol-oidc/src/view/authorize-html.ts` — dependency-free, with
every interpolated value escaped.

Those forty-odd lines are not the risk. The risk is page count: P2 adds an OTP
page and a passkey page, P3 a consent screen, P4 the console. Each one written
the same way, by a different task, leaves P10 retrofitting a theming contract
across six pages that never shared a shape. The spec's promise that
extensibility is "additive rather than a rewrite" is made about modules, and
does not extend to pages on its own.

Defining that contract now, against a single page, would be guessing. **P2 is
where it should be decided**, when three pages exist and the real variation is
visible. Whoever picks it up: the seam is the render function's signature, and
the question is what a theme is allowed to replace — the whole document, a
body fragment, or only styling.

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
