# P4f — self-service: the "me" API and application-initiated actions

The running record of what building the phase found. The argument is in
[the spec](../superpowers/specs/2026-11-11-p4f-self-service-design.md) and
[the plan](../superpowers/plans/2026-11-11-p4f-self-service.md).

## Spike results

Each spike of the plan is recorded here by the increment that runs it.

### S4: where access tokens are verified, and whether one verifier serves a second audience

`verifyTenantAccessToken` (`packages/protocol-admin/src/usecase/authenticate-admin.ts`)
takes `expected.audience` and `expected.issuers` as arguments and passes them to
`verifyJwt` with `typ: 'at+jwt'`; `apps/server/src/mcp-deps.ts` wires it as
`verifyAccessToken` for the MCP door, which passes the MCP URL. The same verifier
therefore serves the "me" audience with no change: `validateMeToken` passes the
tenant's "me" URL. The admin door and `/userinfo` verify with their own fixed
audience (the admin API's, the accepted issuers), so a token with only the "me"
audience already fails there; a token naming the "me" audience beside theirs
passed, and each of the three now refuses it by name (`namesMeAudience`, kernel).

### S1: `/authorize` forces a new sign-in against a live session

Run through the real app (`apps/server/tests/me-gate.int.test.ts`, "`/authorize` against a
session that is already live"). With a live session cookie, a plain request is answered with a
code (the session is reused); `max_age=0` and `prompt=login` each render the login form instead;
`max_age=300` reuses a session younger than that and renders the login form once the session's
`created_at` is older, and the sign-in that follows opens a new session whose `created_at` is
current. `auth_time` is the session's `created_at` (`authorization-request.ts`
`authTime: session.createdAt`), and the access token names that session by `sid`: the gate reads
the one row. A session that has ended or expired answers `401` with no challenge.

### S2: the `acr` a session earns

`acrFor` (`packages/protocol-oidc/src/service/acr.ts`) returns `'2'` when the
authenticators that ran count at least two factors (a passkey counts as two) and
`'1'` otherwise; an empty list gives null. Confirmed by
`pnpm --filter @odudu/protocol-oidc exec vitest run acr`.

### S5: whether the action-token table already names a client

`git grep -n client -- packages/account/src/schema/action-tokens.ts packages/account/src/service/action-link.ts`
found nothing: the table carried no client, so the column was needed. An earlier column that named one
(`redirect_client_id`, migration 0093) was dropped by 0094 because nothing read it; this one is read by the
link's last page, as the closing section of Increment 4 says.

## Increment 1: the "me" API reads

### What shipped

- A `me` package, `@odudu/me` ([ADR 0052](../adr/0052-the-me-package-sits-above-protocol-oidc.md)),
  mounted beside the MCP route: `GET /tenants/:tenant/me/{profile,credentials,sessions,consents}`,
  and the same under `/me/...` at a tenant's own domain. The audience is `<issuer>/me`.
- Two built-in scopes, `me:read` and `me:write`, defined in every tenant and backfilled into
  existing ones by `0125_me_scopes.sql`; assigned to no client. A tenant now starts with
  twelve scopes. `me:write` is held only with `me:read`; at any audience but the me URL both
  are refused with `invalid_scope`. Discovery lists them.
- The door: a token this tenant signed, `typ` `at+jwt`, an accepted issuer, the me URL as its
  audience (the issuer may stand beside it), then `me:read` for a read. No request member names
  a subject. A tenant that is unknown or disabled answers an empty `404`.
- Paged reads, `limit` (default 50, at most 200) and an opaque `cursor`, keyset on id (consents
  on `client_id`), a constant number of queries each. New repository reads: a credential's
  non-secret summary page and a subject's live-session page.

### The layering deviation

`me` has no `adapter` folder. A view and a usecase may not import an adapter and `me` may not
import `@odudu/db`, so the wire mapping is `service/wire.ts` and the reads are a port,
`MeReads` in `repository/reads.ts`, implemented in `apps/server/src/me-deps.ts`.
ADR 0052 carries the amendment.

### What the live run found

Replaying the sign-in against a built stack showed that a token from a real authorization-code
flow names two audiences, the me URL and the issuer, and the door refused every one of them,
because it required the me URL alone. The tests minted tokens with a single audience, so none
saw it. The door now accepts the issuer beside the me URL and still refuses any other resource
(`validate-me-token.test.ts`, `me-reads.int.test.ts`). A request for the me URL with no me scope
never gets a token, so a `403` `insufficient_scope` from a sign-in cannot be shown; the
integration test is what runs it. The live run showed `profile` ignoring a query member and answering `200` with the token's own person; `profile` now refuses
one with `400` like the three lists, and its block in the transcript was re-run at the close of increment 2, which shows the `400`.

### Open placements

None of these is argued in `docs/NEXT.md`; the row there points here.

1. **Liveness of a me token's session on reads** is a design choice, not a gap: reads stay
   stateless (spec 10a), so a token whose session has ended can still read until it expires (five
   minutes at the default). Reads are cheap and expose what the person already sees; a session
   lookup on every one would add a read to each of the four routes for no change of state. Every
   write checks the session (increment 2).
2. **Rate limit and CORS on the me routes.** The MCP route has a per-principal limiter and an
   origin throttle; the me routes have neither, and a browser application on another origin
   cannot call them yet.
3. **`/me` is missing from the previous-address window.** After a tenant switches address, the
   old address serves the routes in `WINDOW_SERVES` (`host-rules.ts`) for an hour, and `/me`
   is not among them, as the MCP route is not either.

## Increment 2: the "me" API writes

### What shipped

- Five routes behind `me:write`, each for the token's own subject and each in one tenant
  transaction: `PATCH /me/profile` (claims; `username` where the tenant allows it; `email` alone
  in its body), `DELETE /me/sessions/{id}` and `DELETE /me/sessions` (the others, a hundred at
  most, `{ended, more}`), `DELETE /me/consents/{client_id}`, and `PATCH` and `DELETE
/me/credentials/{id}`. A token that carries `act` is refused every write with
  `agent_not_permitted`; a token without `me:write` with `insufficient_scope`.
- The freshness gate: a new address, a new username, ending all the other sessions, withdrawing a
  consent and removing an authenticator need a session signed in within the tenant's
  `session_freshness_seconds` (default 300, 30 to 3600, migration `0126`; a field in the console's
  Settings under Sessions). An older sign-in answers `401` with the RFC 9470 challenge, with
  `acr_values="2"` for a removal by a person who holds a second factor. The claims, a rename and
  ending one session are not gated. Every write, gated or not, needs the token's session to
  stand: a session that is gone, or a token that names none, is `invalid_token`, no challenge.
- The removal rule (`removal-rule.ts`): only a TOTP or a passkey can be removed; `409`
  `last_sign_in_method` and `last_second_factor` are the refusals; removing the last TOTP revokes
  the recovery codes that stood in for it.
- A new address (`0127_pending_email_changes.sql`, see "Changing the address" below), the audit
  actions `subject.credential_rename` and `email.changed`, and a session a person ends is
  `session.ended` with `via: self`.
- Documentation: the changes transcript
  ([The me API: changes](../../apps/docs/content/en/reference/transcripts/request-paths/the-me-api-changes.md)),
  a section of the protocol reference, the settings page, the audit concept page.

### What the review found

Three of the findings were real defects and each was fixed in the increment: the gate's answer
for a session that had ended (signing in again is a new session, not an answer to a challenge,
so a gone session is refused `invalid_token` and names none); a pending address survived an
administrator changing the address, so an old link could swap it in (an administrator's change and
a skipped request both clear it now, `e34a77bd9`); and the service-account migration test compared
`pg_class` versions, which a later column change rewrites, and broke on the new migration (it
stops comparing them).

### What the live run found

Nothing that needed a code change, three things the tests had not shown. A tenant with no mail
relay answers an address change `503` `mail_unavailable`, which is the stack the other
transcripts run on, so the page adds a relay that keeps what it is given. The gate answers before
the removal rule, so a stale removal by a person with a second factor is a `401` and never a `409`.
And a token whose session was ended by `DELETE /me/sessions` still made an ungated write: the
claims, a rename and ending one session ignored a dead session. Every write now needs a live
session (`requireLiveSession`, `84e1fb63c`), and the transcript block shows reads answering and
every change refused `401`.

### Open placements

1. **The administrator's `updateEmail` holder check is case-sensitive** where the address the
   verification link completes is not; the case-reconciliation increment places it.
2. **Rate limit and CORS on the me routes**, as in increment 1, still open.
3. **The gate and the write are separate transactions** (below), a limit recorded and not removed.

### Known limits of the gated writes

- **The session read and the write are separate transactions.** A session that ends between
  the read (the freshness gate's, or the liveness check's on an ungated change) and the write
  still lets the write through; the check judges the moment it read, not the moment of the write.
- **A username edit is gated on the member being present in the body**, not on the value
  changing, because knowing it is unchanged needs the profile read before the gate.

### Changing the address

`PATCH /me/profile` with `email` (alone in its body, behind the freshness gate) stores one pending
address per subject (`pending_email_changes`) and queues the existing verification mail to the new
address; the current address and its verified flag stay until the link is used. The link is an
ordinary `verify_email` action token: when its address is not the current one,
`completeEmailVerification` takes the pending row for that address and swaps it in, verified, in
the same transaction, refusing like an expired link when the row was replaced or cleared or another
account holds the address by then. The answer is `202` whether or not the address is held; the
audit row says `skipped` (`address_in_use`, `unchanged` or `throttled`, the last from a new
per-address mail budget of its own kind). A pending row is one per subject and is cleared when the
change completes, when a later request replaces it, when a later request is skipped, and when an
administrator changes the address; it is deleted with the subject. It is not reaped by age and needs
no such pass: the table cannot hold more rows than the tenant has subjects. A notice to the address being left is queued when the request is made (increment 6), only when the request is not skipped and the old address is verified.

## Increment 3: which actions a client may start

### What shipped

- The client setting `allowed_actions` (`update-password`, `configure-totp`, `configure-passkey`,
  `generate-recovery-codes`; empty by default): the admin API (create, amend with `If-Match`, read), the tenant
  document (export and import), the console's Advanced tab under "Application actions", and
  `odudu seed client --allow-action`, which assigns `me:read` itself. A database CHECK, a refusal on create and amend
  and import, and the stable code `allowed_actions_need_me_read` hold the pairing with `me:read`. Unassigning `me:read`
  from such a client and deleting the scope while one holds it are refused too. Dynamic registration refuses the field
  as operator-only.
- The `/authorize` parameter `action`: one value only; unknown, repeated, empty and not-allowed are `invalid_request` at the
  redirect address; a session older than `session_freshness_seconds` signs in again first. The page is the one the tenant's
  required action already uses, with a cancel control; recovery codes ask to confirm replacing a held set and the page
  that shows the new codes has no cancel; `update-password` asks for the current password (a wrong one counts as a failed
  sign-in against the lockout, a right one ends the run); a requested authenticator swaps a held one. The return carries
  `action_status=success|cancelled|error` from state the server parked. The audit rows are `action.requested` (per page
  shown), `action.completed`, `action.cancelled` and `action.failed`.
- Documentation: the transcript
  ([Sending a person to change a credential](../../apps/docs/content/en/reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md)),
  the guide ([Send a person to change a credential](../../apps/docs/content/en/guides/send-a-person-to-change-a-credential.md)),
  the clients page of the console with a new picture, the `allowed_actions` sections of the client amend and the scope
  pages, the registration refusal, the changelog.

### What the review found

- Deleting the `me:read` scope stripped it from clients that may start an action or hold `me:write`; unassigning it was
  guarded and deleting was not. Fixed with a refusal and a test.
- A requested `generate-recovery-codes` replaced the held set when the page rendered, so a reload or a cancel changed it.
  The set is now replaced on a confirmation, and the question page is not a change.
- The `update-password` intro said the tenant had asked, and the page took no current password. Both corrected.
- A console slice reached across a boundary that two reviews missed: the clients service imported wording from another slice.
  It now takes the wording from its use case.
- Tests were written beside the code, not before, in several places; the review said so and the missing red runs were
  not recreated.
- This close repeated it: the assertions that the codes page offers no cancel after a confirm, and the test of the
  corrected `me:read` message, were written together with their fixes and not run red first. A later assertion for the
  re-render that issues a fresh set was shown red by reverting the fix.

### What the close found

- After a confirmed replacement the codes page offered cancel, which would have recorded `cancelled` for a changed set. A page
  that shows a freshly issued set now never offers it. The rule "requested and not owed by the tenant" was written three times
  and is one pure function, `requestedVariant`.
- The refusal for removing or deleting `me:read` said to assign it, the opposite of what the caller was doing. It now says to
  clear `allowed_actions` first.
- The amend of `allowed_actions` needs `If-Match` like the six list fields, and answers `400` for a client without `me:read`
  before it answers `428`. The patch transcript shows both orders.
- The admin OpenAPI transcript had a hand-edited size; the real fetch gave the same 810,507 bytes.
- The wrong-current-password lockout was shown live: one failure after a wrong answer, none after the right one.

### Open placements

- An expired sign-in under an action returns the person to the client with `action_status=error` only where the request cannot
  be restarted; the restart link otherwise carries `action`. No audit row is written for that return, which is a link, not a
  request.
- The "me" write refusal for an agent token has no counterpart at `/authorize`: no session or grant carries an agent marker.
- `update-password` for a person with no password, and the passkey ceremony, are covered by integration tests and not by a
  transcript, which cannot reach them from a shell.
- The close-of-phase pass (the roadmap, section 11 and `docs/NEXT.md` read against each other) still owns the P4f row.

## Increment 4: a place to return to for an administrator-issued link

### What shipped

- Migration 0129 adds `client_id` (the client's internal id) and `return_uri` to `action_tokens`, held both or neither by
  a CHECK. Neither is a foreign key: the client can be deleted or edited before the link is opened, so the page reads the
  client's registration when the link is opened and drops the way back if the client is gone, disabled or no longer
  registers the address. The link is still redeemed.
- The three admin sends (`password-reset`, `verification`, `actions-email`) take an optional `client_id` and an optional
  `redirect_uri`; the two older ones gain an optional body, and a request with no body is as it was. A client of another
  tenant is as unknown as a missing one, and so is a disabled one (`return-client-unknown`). A named `redirect_uri` has to
  match a registered one exactly (`return-redirect-uri-unregistered`); an unnamed one is the client's only address, and a
  client with several or none needs the request to say which (`return-redirect-uri-required`). A `redirect_uri` with no
  `client_id` is refused with a plain `400`. The audit row names the client in `detail.client_id`.
- The last page of each link (the reset, verification and required-actions pages, and the page a link that cannot be used
  gets) carries a "Return to the application" link to the registered address with `action_status=success`, or `error` for
  a link that cannot be used, as a hint only: the "me" API holds the outcome. It is a link on the page and not a redirect,
  so the page that says the factors were removed or the actions still owed is still read.
- Documentation: the three admin pages, the changelog, the capture note.

### Open placements

- A link that is used from the sign-in that mailed it keeps the way back to that sign-in and names no client.

## Increment 5: recovery codes, early re-issue and the bound

### What shipped

- **Where the marker lives.** Migration 0130 adds `subjects.recovery_codes_issued_at timestamptz`, null until a set is
  made. A set has no row of its own (it is the subject's `recovery-code` credential rows, deleted and inserted together),
  so a `recovery_sets` table would have held one row per subject to carry one timestamp, with its own foreign key, policy
  and cascade. The subject row is already the lock every issue and every factor removal takes, so the claim needs no second
  lock. A subject whose set predates the column reads null, so it can be replaced once at once.
- **The claim is one conditional `UPDATE`** (`subjectRepository.claimRecoveryIssue`) that sets the time only where it is
  null, at or before `now` minus an hour, or the caller says the set is used up. `reissueAllowed` (a pure service
  function) decides the same thing from a read and names the retry time, which the claim cannot return. Two calls at the
  same instant: one claims, one reads the claimed time and is refused (tested with two concurrent transactions).
- **The one issuer** is `beginRecoveryCodes`; the sign-in page, a reload of it and the requested action all pass through
  it, so the bound holds for each. The bound does not apply while the action is owed (see Ruling). A refusal writes `recovery_codes.refused` (outcome `refused`, reason `rate_limited`),
  carries `retryAt` and the minutes to wait, and renders a page with a `429`. A page an application sent the person to
  has the cancel control; the page a tenant owes has none.
- **A first set waits for a confirmation too.** `askFirst` replaces `keepHeld`: a requested action issues nothing at
  render, and answers `ask` (with whether it replaces a set) or `too_soon`. The first-set confirmation has its own
  wording and button. The Increment 3 placement is closed.
- Documentation: the action guide, the action transcript replayed whole on a live stack, the
  recovery-code transcript's prose, the audit vocabulary, the changelog. The sessions concept page is at the 900-word
  limit its test holds, so the rule is stated in the guide and the transcripts.

### Found while building

- `beginRecoveryCodes` had no clock, and the bound needs one. It takes `now` as a required input, so the callers in
  four test suites pass one rather than the function reading the wall clock.

### Ruling

- A person whose sign-in waits for a set (the `generate-recovery-codes` action is owed) is exempt from the bound, as the
  first set and a used-up set are, so a reload of the owed page issues a fresh set and the bound never blocks a sign-in.
  It is one input of the pure `reissueAllowed` (`owed`), read from the person's pending actions. A set asked for
  voluntarily, by an application or otherwise, keeps the bound.

### Open placements

- While the recovery-codes action is owed, each reload of its page issues a set: ten Argon2id hashes, bound to a signed-in
  session, with no limit on the count. Placed on P11 (load and p99). The cheap bound is a short cooldown that still lets the
  sign-in finish.

### The low-count warning

- **The setting.** Migration 0131 adds `tenants.recovery_code_warn_below integer NOT NULL DEFAULT 3`, held to 0..10 by a
  CHECK; 0 turns the warning off, and ten is the size of a set. It follows `session_freshness_seconds` end to end: the
  column, `SETTINGS`, the contract range, the tenant document (absent in an older export, imports as 3), the audit detail
  allowlist, the console's Settings (Registration and recovery) and the settings page.
- **The flag.** `GET /me/credentials` carries `recovery_codes_low`. `recoveryWarning(unspent, threshold)` is the pure
  rule (`unspent < threshold`, so a threshold of 0 never warns); `recoveryCodesLow` adds that a person holding no set
  (no recovery-code row at all, spent or not) is `false`. The read takes the held count from `recoveryStanding` and the
  threshold from the tenant row inside the one tenant-scoped transaction, so no `MeTenant` or `TenantLookup` field was added.
- **Where it shows.** Odudu serves no page a person lands on after signing in (the sign-in ends in a redirect to the
  application), and the recovery-codes page is shown only while a set is being made. So the warning is surfaced where the
  person's credentials are read, the "me" API, and an application shows it and sends the person to `generate-recovery-codes`.
  No server page gained a string, so no catalogue entry was added. The spec's "on the next page the person sees" is amended
  to say this. The sign-in's steps are pinned by a test of `BROWSER_FLOW_DEFAULT` (passkey, password, otp, recovery-code).
- **Owed to the closing pass.** `docs/NEXT.md`'s paragraph "Two recovery-code gaps that need self-service" is stale: both
  gaps (early re-issue, the low-count warning) are closed.
- **At volume.** One extra primary-key read of the tenant row beside the credentials page's existing queries; no list grew.

## Increment 6: notice mail on a change the person made

### What shipped

- `noticeRecipient(address, verified)` (`@odudu/email`) is the pure rule: a verified address is sent to, an unverified one
  or none is not. `renderOwnChange` words six changes (an authenticator app or a passkey added or removed, a new set of
  recovery codes, a new address asked for) with an English and an Arabic entry each, shared lines for the time and what to do,
  and no link, code or secret. `queueOwnChangeNotice` queues it in the caller's transaction, themed through the same mail look
  the admin mails use, and answers `sent`, `skipped_unverified` or `skipped_none`.
- The sites, each one transaction with its change: `completeTotpEnrolment` (a swap included), `completePasskeyEnrolment` and
  `beginRecoveryCodes` in `@odudu/authn-flows`, which every required-action page and every application-requested action
  reaches; `removeCredential` and `requestEmailChange` in `@odudu/me`, wired in `apps/server/src/me-deps.ts`. The audit rows
  `otp.enrolled`, `passkey.enrolled`, `recovery_codes.issued`, `subject.credential_delete` and the `subject.profile_amend`
  that asks for an address carry `detail.notice`; the vocabulary refuses any other value on the first three.
- Closes the open placement and the known limit of increment 2: the address that would be left is told.

### Ruling

- The address change is told at the request, not when the link is used: the person hears of it while the pending change can
  still be cleared by asking again, and the new address already receives the link. A request that is skipped (address held,
  unchanged, throttled) tells nobody, since nothing is pending.
- The admin routes keep sending their notices to an address on file whether or not it is verified, as the administrator's
  removal decided: the message carries nothing an unverified address could use. Only the person's own changes follow
  section 5.5's verified rule.
- Enrolling an authenticator app owes a recovery set, so a first enrolment sends two notices, one per change.

### At volume

- A change that sends reads the user row, the tenant's name and display name, and the tenant's mail settings (language, theme and
  wording, through `tenantMailContext`): one primary-key read of the user and two of the tenant. None is read when no mail is sent; no list grew.

## Increment 7a: the authenticator policy

### What shipped

- Six tenant settings, each a column with a CHECK (migration `0132`), a `SETTINGS` entry, a field of the tenant document with
  today's value as its default, an audit-detail entry and a field in the console's new Authenticators section: `totp_algorithm`
  (`SHA1`, `SHA256`, `SHA512`), `totp_digits` (6, 8), `totp_period` (30, 60), `webauthn_user_verification` and
  `webauthn_resident_key` (`required`, `preferred`, `discouraged`) and `recovery_code_count` (8 to 16, default 10).
  `TENANT_SETTING_CHOICES` in `@odudu/contracts` names the values of a list-shaped CHECK, as `TENANT_SETTING_RANGES` does for a
  range, and `tests/tenant-setting-checks.int.test.ts` holds both to the database.
- A TOTP row records `algorithm` and `period` beside the `digits` it already held, a passkey row `userVerification` and
  `residentKey`. The migration writes the values every earlier row was made with (SHA1 and 30 seconds; both required) and
  leaves a row that already has a key alone, so it runs again to no effect.
- `verifyTotp` takes the credential's algorithm, digits and period; `totpStep` reads them from the row, never from the tenant.
  A passkey assertion is verified by the row's own user verification, and a row without one reads as required.
- The enrolment page says what the app must support when the parameters are not SHA1, 6 digits and 30 seconds (an English and an
  Arabic entry), and the `otpauth://` address carries the three parameters.
- A recovery set takes its size from the tenant at the moment it is issued.

### Ruling

- `recovery_code_warn_below` may not exceed `recovery_code_count` (CHECK `tenants_recovery_warn_within_count`, and an ordering
  the console reads), so a tenant cannot flag every set as low. The warning moved to the Authenticators section with its count.
- Digits and period are validated by the CHECK and `tenantSettingProblems` against `TENANT_SETTING_CHOICES`, and the console
  offers them as a choice of two whose values are text; the admin API reads `"8"` as it reads `8`.
- A passkey made without user verification is one factor. The assertion's user-verified flag decides: a passkey whose row did
  not require verification and whose assertion lacked it records `passkey-unverified` beside `passkey`. The second factor then
  applies (`otpApplicable`, `recoveryApplicable`), `acr` is `1` and `amr` has no `user`. Without this a tenant that chose
  `preferred` would have turned a one-factor credential into the two the sign-in counts it as.
- Sign-in always asks for `preferred`. No credential is known when the options are made, and a client refuses an authenticator
  that cannot verify before the server sees it, so asking `required` because the tenant now requires it for new passkeys locked
  out a passkey made earlier under `preferred`. Enforcement is per credential, at verification: `passkeyStep` reads
  `requireUserVerification` from the row's own `userVerification`, so a passkey made under `required` is refused an assertion
  without verification whatever the tenant has chosen since.
- Facts for discoverability: `git grep -n "allowCredentials\|passkeyAuthenticationOptions" -- packages apps` finds one place an
  assertion is requested, `beginPasskeyAuthentication`, and it sends no `allowCredentials`; a passkey is never used as a second
  factor after a username. So only a discoverable credential can ever sign in. WebAuthn cannot be asked what the authenticator
  did, but the `credProps` client extension reports `rk`. Registration now requests it and refuses `rk === false` under every
  `webauthn_resident_key` value (`not_discoverable`, shown as `refusal.passkeyNotDiscoverable`, English and Arabic), with
  nothing stored. A client that reports nothing is trusted, which is the one gap left; narrowing the setting's values was
  rejected because `discouraged` and `preferred` still yield a discoverable credential on most authenticators, and no new
  sign-in path was added.
- A TOTP enrolment is checked by the tenant's parameters at the moment it is confirmed, not at the moment its page was drawn; a
  change between the two makes the code refused and the person tries again.

### Found while building

- The brief assumed `digits` and `period` might already be stored. Only `digits` was, and no code read it: `verifyTotp` ignored
  it and always compared six digits at 30 seconds. It is read now.
- A passkey carries nothing in WebAuthn that says how its registration was asked for, so the row is the only place the
  parameters can live; the table of 0132 is `user_credentials.secret_data`.

### At volume

- No path grew a list. An enrolment, an assertion and a recovery issue each read the tenant row once by primary key
  (`authenticatorPolicy`), as the flow settings already do; `recovery_code_count` bounds the hashes a set costs at 16.

### Open placements

- The tenant-wide passkey switch and the per-step configuration are the next two parts of the increment, unchanged.
- A weak-passkey sign-in audits as `login.passkey`, the same as a verified one; the token's `acr` and the session's satisfied list
  are the only record. Placed on increment 8, where the session and audit detail are revisited.

## Increment 7b: the passkey switch

### What shipped

- Tenant `require_passkey` (migration `0133`, boolean, default false): a column, a `SETTINGS` entry, a field of the tenant document
  that defaults to off, an audit-detail entry by value and a toggle first among the passkey fields of the console's Authenticators
  section. Off changes nothing for any tenant.
- A sign-in that completes (every factor passed) adds `configure-passkey` through `requiredActionRepository(tx).add` for a person with
  no passkey registered under the tenant's current relying party id. `add` is an insert that conflicts away, so repeated sign-ins
  leave one row. The same pass already runs for recovery codes, so no step was added to the flow itself.
- `credentialRepository.holdsPasskey(subjectId, rpId)` answers it with one indexed row (`user_credentials_by_subject`).
  `passkeyCheckedAgainst` is the pure decision of whether to look at all.

### Ruling

- The tenant mandate has no skip. The required-action page already hides its way back for an action the tenant owes
  (`requestedVariant`), so an application-requested `configure-passkey` that the tenant also owes shows the page without Cancel
  and is not a second row: an application's request is never a row. An administrator clears the owed action under Required
  actions on the person's record (`PUT .../required-actions`), or turns the switch off. A clear lets the sign-in under way
  finish and no more: the next completed sign-in adds the row again while the switch is on, which the live run shows. There is no
  per-person exemption, so a person whose device cannot make a passkey needs the switch off.
- Turning the switch off does not remove rows already added. They are the person's owed actions like any other an administrator
  or a policy wrote, and removing them on a setting change would need a scan of every subject of the tenant. Completing the
  enrolment, or an administrator, clears them.
- Existing sessions and tokens are never touched: the action is written at a sign-in and read by the gate that follows it, and
  an `/authorize` that finds an open session does not run a sign-in.
- Only a passkey under the relying party id the sign-in would offer counts. After a tenant moves to a domain its old passkeys are
  hidden at sign-in, so a person holding only those is owed a new one; counting them would have left that person with a mandate
  met and no passkey usable.
- A deployment with no relying party (no public base URL, or a path-addressed tenant on a base that names an address) adds
  nothing: the page cannot be shown there, and an action owed for it would be a lockout the switch could not explain.
- Service accounts and agent tokens never pass this path. It runs only after an interactive sign-in has bound a user subject.

### Found while building

- No new index was needed: `user_credentials_by_subject` (subject, type) narrows to the few rows a person holds and `rp_id` is
  filtered on those. `rp_id` is stamped at boot on rows written before domains existed, so a row still unstamped is not counted
  here, although the sign-in reads it against the base host (`credentialRelyingPartyId`). Nothing writes an unstamped row now.

### At volume

- One read of the tenant row by primary key (already made for the flow settings; `requirePasskey` rides on it) and, only with the
  switch on, one canonical-host read and one indexed one-row existence check per completed sign-in. Nothing lists.

### Open placements

- The per-step configuration is increment 7c, below.

## Increment 7c: per-step configuration

Ruling: no code in this increment. A sign-in flow model does not exist yet
(`git grep -n -i "flow_config\|authentication_flow" -- packages/db/src
packages/domain-tenant/src` finds nothing), so there is no step to carry a
setting. The authenticator settings stay on the tenant, where 7a put them, and
increment 13b moves each of them onto the step it governs when it builds the
flow model, with the tenant value as the default a step inherits. A tenant
that never configures a step behaves as it does today.

### Open placements

- Moving the authenticator settings onto flow steps is increment 13b's work.

## Increment 8: session device identity and ADR 0033

### What shipped

- A device cookie, `<tenant>-device`, set (and set again) by every sign-in that ends in a redirect, in both doors that write the
  session cookies (`login-response.ts`, `consent.ts`); `newDeviceId`, `deviceDigest`, `deviceCookie` and `readDeviceId` are one
  file (`packages/authn-flows/src/service/device-id.ts`). `sessions.device_id` (migration `0134`) stores the digest, never the
  cookie value. `admitSession` takes the digest and reads the subject's live sessions on it, in the same transaction under the
  tenant-row lock, beside the cookie's own entries.
- `device` on `/me/sessions` (was a constant `null`) and on the admin API's session lists: `sessionSchema` is shared by the
  subject list and, extended, the tenant and client lists, so one field covers all three. A Device column on the console's
  three session lists (`shared/ui/DeviceCell`, reusing `CopyValue`).
- `login.passkey` audit rows carry `user_verified` (boolean, passkey only, stated by the executor from `PASSKEY_UNVERIFIED`). The
  generated audit events page names it.
- ADR 0033's amendment, with the measurement.

### Ruling

- The cap is exact only for one person's sessions on a browser that already holds the cookie (a first sign-in stays bounded, and two people racing on one browser are not seen by each other); the orphan is bounded and listed, not closed. The measurement
  (`apps/server/tests/session-cap-k.int.test.ts`, ten races per k, cap 3) gave `cap + (k - 1)` live and `k - 1` orphaned without
  the device read, and exactly the cap live with it, for k of 2, 3, 4 and 6; orphaned stays up to `cap - 1`, because no cookie can
  name a session whose secret the server never stored. The device is read only for the subject signing in, so a forged cookie value
  groups nothing of anybody else's.
- The lists show a digest, not the cookie value, so reading a list never yields a value a browser sends.
- No index: the new read filters on `subject_id` and `device_id` and `sessions_by_subject` narrows it to one subject's rows.

### Found while building

- The brief names a `(tenant_id, subject_id)` index on `sessions`; there is none. The index is `sessions_by_subject (subject_id, id)`
  (`0095_lookup_indexes.sql`), and tenant isolation is the row-level policy.
- The `-session` cookie lint (`session-cookie-authority.test.ts`) only reads the route files, so the device cookie's attributes live
  in `device-id.ts` and the routes call `deviceCookie`.

### At volume

- Admission gains one bounded read (at most 100 rows) by subject and device. The sessions lists are unchanged queries with one more
  selected column. The cookie adds one `Set-Cookie` of about 90 bytes to a sign-in's redirect.

### Open placements

- Five transcript pages still carry the on-page note that they predate the device cookie or field: `the-tenants-own-sign-in.md`,
  `get-consoleauthcallback-refused.md`, `get-consoleauthcallback-restarted.md`, `a-refresh-the-server-refuses.md` and
  `guides/admin-signs-in-and-changes-a-user.md`. They continue one console sign-in across pages, so they need that whole run replayed
  in order, together with `get-sessions-get-sessionscount-and-get-clientsidsessions.md` and
  `get-subjectsidsessions-and-delete-subjectsidsessionssid.md`, whose prose says their blocks predate `device`. Placed on the phase's
  closing pass (increment 14), which replays every console and session transcript once, after the password-change, sign-in-flow and
  required-action increments that still change those same responses. The other nineteen were replayed or cleared, below.
- The roadmap's P4f bullet still names the device and the orphan; it is closed by the phase's closing pass, which reconciles the
  roadmap and section 11.

### Fix round

- The exact-cap claim is qualified in the ADR, the concept page and the CHANGELOG: exact per person on a browser that already holds
  the cookie; a first sign-in stays bounded and an orphan of up to `cap - 1` remains.
- The console's session lists group: a pure `groupByDevice` in the session entity orders sessions by device (devices as they first
  appear, no device last), `deviceCaptionOf` words the count, and the use cases only call them. Grouping applies to the rows loaded.
- The cap test asserts the orphan bound; `query-plans.plan.test.ts` asserts the device read uses `sessions_by_subject` with no Seq Scan.
- The concept page keeps its checked facts (cookie lifetime, grants route and `offline`, both revocation-mail triggers).
- Transcripts replayed on 2026-11-12 on the compose project `odudu-p4f-i8-replay` from `ce1b37221`: `the-mcp-endpoint`,
  `getting-the-token`, `two-factor-authentication-with-totp`, `recovery-codes`, `brute-force-lockout`, `password-reset`,
  `password-expiry-and-changing-a-password`, `path-a-authorization-code-with-pkce`, `rp-initiated-logout`, `the-branches` (the session
  cap), the consents and recovery-codes admin pages, `delete-subjectsidsessions` and `delete-sessions`; the Path A excerpt in
  `guides/sign-a-user-in`. Four pages show no sign-in's cookie list and only lost the note: `self-registration`,
  `a-themed-sign-in-and-the-brand-route`, `following-the-logout-redirect` and `guides/refresh-and-end-a-session`. The consent screen
  in `rp-initiated-logout` now carries the self-registered client's notice, which
  `tests/docs/page-documents-transcripts.test.ts` does not read back yet. The method and the page list are in
  `contributing/transcripts.md`.

## Increment 9: ending the other sessions on a password change

### What shipped

- A checked box, `end_other_sessions` (`value="true"`), on the change-password page in both its variants, wording `updatePassword.endOtherSessions`
  with an Arabic twin. The field is read as `=== 'true'`, the way `remember_me` is.
- `endOtherSessions` in `protocol-oidc` (`usecase/end-session.ts`) shares one batch loop with `endAllAccess`, 100 sessions a round,
  and ends the sessions the way a logout does (grants revoked, back-channel deliveries queued, `session.ended` with `via: 'self'`).
  `completeUpdatePassword` takes it as a callback, runs it after the new hash is stored in the same transaction, and never for a
  refused or superseded candidate. The `password.changed` row carries `ended_other_sessions`, in the audit vocabulary's allowlist.

### Ruling

- An absent field leaves the sessions. A cleared box sends nothing, so the rendered default (checked) is what makes ending the
  usual answer; a script posting the form without the field is not assumed to want it.
- The session in use is the parked request's `reuseSessionId`, present when an application sent a person who is already signed in.
  On a sign-in the change interrupts there is no session yet, so every earlier one ends and the new one is made afterwards.
- A password reset has no box. It already ends every session and revokes every grant of the person, unconditionally
  (`recoverAccount`), because a reset is how an account is recovered; a box on it would let whoever holds the mailbox
  choose to keep the previous holder signed in. `reset-ends-access.int.test.ts` holds it.
- The "me" API has no password change, so there is no API path to cover. Grants no session holds (`offline_access`) are not
  touched, as when a person ends sessions through the "me" API.
- A refused candidate re-renders the page with the box checked again, whatever it was; the safer value on a retry.

### Fix round

- `getting-the-token` was replayed whole from its first block to the token's decoded payload on one stack (port `3082`, empty
  volume), so the page, the posted `auth_session_id`, the code and the token share one run; its later sections keep their own
  notes. The provenance paragraph in `contributing/transcripts.md` says so. The page's sentence on the unchecked box now says only
  that the request sends nothing, so none is ended.
- The sessions concept page names both triggers of the revocation mail again, with room made by tightening two other sentences.

### At volume

- One bounded read by subject (`sessions_by_subject`) and one batch of statements per 100 sessions; a subject with 250 live sessions
  takes under 40 statements (`end-all-access.int.test.ts`).

### Open placements

- None.

## Increment 9, part 2: the breached-password check

### What shipped

- Two tenant settings, `breached_check` (`off|dataset|remote`, default `dataset`) and `breached_on_error` (`open|closed`, default `open`),
  with a CHECK each in migration 0135, import/export, the audit detail allowlist and a Password policy control in the console.
- `BreachedPasswordSource { isBreached }` with two implementations in `domain-identity`: the dataset (one primary-key probe of
  `breached_password_hashes`) and the remote range lookup (`breached-range-source.ts`). `judgeBreached` settles a
  `BreachedLookupFailed` by `breached_on_error` and lets every other error through, so a defect is never read as an answer.
  `createBreachedPasswordCheck` reads the tenant's settings through the caller's transaction and is injected into the four
  writers: registration, reset redemption, actions-link redemption (`@odudu/account`) and `completeUpdatePassword`.
- The remote request is `createBreachedRangeFetch` (`apps/server`), which reuses the pinned transport of ADR 0028: one fixed host,
  a `/range/<five hex>` path and nothing else, every resolved address checked and the connection pinned to one, `Add-Padding: true`
  and no other header, 3 s, 128 KiB, 4 lookups in flight per tenant.
- `odudu breached-passwords load <file>`: a stream, chunks of 5,000, `on conflict do nothing`, the owner connection only.
- Rules `breached-password` and `breach-check-unavailable`, worded in both catalogues and in Arabic; `detail.breached_check` on
  `password.changed`, `password.reset` and `account.registered`.

### Ruling

- The dataset is one global table, not one per tenant: a corpus of hundreds of millions of rows cannot be copied into each of 10,000
  tenants. Every other table is tenant-scoped, and `rls-policy.int.test.ts` demands a policy naming `app.tenant_id` on every one,
  so the table has a read policy that admits any bound tenant context and nothing else, and `INSERT`, `UPDATE` and `DELETE` are
  revoked from the serving role. The load runs as the owner and refuses a role that does not bypass row-level security.
- The default is the dataset, as the spec says, and an empty dataset judges nothing breached, so no tenant's behaviour changes until
  an operator loads one. A tenant is shown as checking whether or not a dataset has been loaded; the console cannot see the table.
- The check runs after the other rules, on a candidate that passed them, and before the reuse check, which can be up to 25 Argon2id
  verifications. A candidate refused by a rule is never looked up.
- The check runs in the writer's own transaction, so it opens no second connection (a second would deadlock a saturated pool).
  Registration has no transaction at that point and opens a short one. (Superseded: see the fix round, a remote lookup now holds none.)
- An administrator never types a password: `POST .../subjects/:id/password` mails a link, and the link's page is the actions-link
  writer. There is no fifth path to cover. `odudu seed` and `odudu init` check the policy rules only; they are operator-typed on a
  command line and a remote lookup from a one-shot command has no bound.
- A refusal is a form error, as a refused rule is, and writes no audit row. `breached` and `error_closed` are in the vocabulary because the
  check reports them, and so no stored row ever carries either.
- A registration that waits for a mailed link runs the check when the form is submitted. Its `account.registered` row, written when
  the link is used, has no `breached_check`, since the verdict has nowhere to wait in `pending_registrations` without a column.
- "Timeout honours the setting" is read as: a lookup that timed out is settled by `breached_on_error`. The timeout is a constant; a
  tenant cannot lengthen the time a form submission can wait.
- The suffix is compared with plain equality: it is public data, and the answer is the whole bucket the service sends anyway.
- A count of zero in an answer is the service's padding and is not a hit. An empty answer is a failed lookup, not a pass.

### At volume

- Dataset: one probe of the primary key (`prefix`, `suffix`), constant whatever the table's size, no listing. Remote: bounded by
  3 s, 128 KiB and 4 in flight per tenant; the limiter's map holds an entry only while a tenant has a lookup running.
  10,000 tenants with one lookup each is 10,000 entries for at most 3 s.
- The load streams and holds one chunk of 5,000 rows.

### Open placements

- None. The remote path has not been run against a live stack, because the real host must not be contacted: its wire is asserted
  with a capturing fake and against a TLS server of the test's own, and the transcripts show the dataset path and the settings.

### Fix round

- A remote lookup holds no pooled connection. The check is two parts: `prepare` reads the tenant's settings in a short transaction of
  its own, releases it and only then asks a remote service; `judge` runs inside the writing transaction and does at most one
  primary-key read. Reset, actions-link and change-password run a read-only phase first (token, rules), so the rules still decide
  before anything is asked and a refused candidate is never looked up; `prepareUpdatePassword` does the same ahead of
  `completeUpdatePassword`. A process-wide cap of `DEFAULT_POOL_MAX - 2` (8) lookups joins the per-tenant 4; a lookup refused by
  either is a failed lookup settled by `breached_on_error`. A test holds three blocked lookups against a pool of two connections and
  shows both still answer.
- `parseRange` skips empty lines, so a terminated last line and CRLF no longer fail a lookup; a body of nothing but line ends is
  still a failed lookup. The hash is computed before a slot is taken.
- A dataset holding no row reads `dataset_empty` in `detail.breached_check` (one `select 1 ... limit 1`, only when nothing was
  found), and `odudu breached-passwords status` prints `{loaded, rows, capped}`, counting up to a million.
- `breachedPasswordCheck` is required in `protocol-oidc`; the module-level default is gone.
- The settings screen record was recaptured by `pnpm docs:screenshots` and is the tool's output. The earlier refusal was the run's
  own admin password: a short, word-like one matched page text (the guard refuses a given string appearing anywhere). A 40-character
  random password passed that guard, then the run needed a database holding only the `system` and `demo` tenants.
- In the change-password transcript, a candidate that fails the current-password proof is still looked up when it passes the rules,
  since the proof writes failures and cannot run before the lookup; the lookup sends only the hash prefix.
