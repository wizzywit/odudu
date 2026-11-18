# An administrator's email change is confirmed by mail, and a reset link goes only to a proved address

## Why

`PATCH /subjects/:id` with a new `email` replaces the stored address at once and
sets `email_verified` to false (`updateEmail`, `packages/domain-identity/src/repository/users.ts`).
Three things follow, all observed in code:

- On a tenant where sign-in is by address, the person can no longer sign in
  by it until they verify. With `registration_username` optional or generated
  they do not know a username, so they are locked out.
- The unproved address takes password-reset links, because reset looks an
  address up whether or not it is verified (`users.ts` `byEmail`). A typo or a
  hostile address an administrator (or an agent they approved) types receives
  the way into the account.
- Nobody is told. No mail goes to the old address.

The person's own change already avoids all three: it stores a pending address,
mails the new one, keeps the old one signing in until the link is used, and
tells the old address (`requestEmailChange`, `packages/me`). Cognito
(`AttributesRequireVerificationBeforeUpdate`), Keycloak (`UPDATE_EMAIL`) and
the OWASP Authentication Cheat Sheet describe the same sequence. This
increment gives the administrator's change that sequence.

## Decisions (owner, 2026-11-17)

- Confirmation by mail is the only way an administrator changes an existing
  address. There is no `replace` mode and no option to choose: few installs
  exist, so no compatibility shim.
- When mail cannot be sent the change is refused, with no fallback.
- The old address is told, as the standard asks.
- Its own increment, after the flows increment.
- Owner, 2026-11-18, on reading this spec: gating password-reset on a verified address is in this increment, not placed for later.

## Behaviour of `PATCH /subjects/:id` when `email` is present

| Asked address | Result |
| --- | --- |
| `null` | Cleared at once, as today; any pending change is dropped. Removing an address needs no proof. |
| The address the person already has | No change to the address; a pending change is dropped. This is how an administrator cancels one. |
| Held by another subject in the tenant | 409, as today (`EmailTakenError`). |
| Any other valid address | If the tenant can send mail, the address is stored as the pending change (replacing an earlier one), a verification link is mailed to it, and the old address is told. The stored `email` and `email_verified` do not change. If mail cannot be sent the request is refused before anything is written. |

Other fields in the same request (`username`, `enabled`) apply as today and
are not held back by the pending address.

**Completion is the existing one.** The link goes through
`completeEmailVerification` and `swapAddress` (`packages/account`), which take
the pending row, re-check the holder, replace the address as verified and audit
`email.changed`. A replaced or cleared request is dead because the pending row
is what the link spends.

**Refusals.** Mail cannot be sent when the tenant has no relay and the
deployment has none, or the deployment has no public base URL: the same two
refusals, with the same codes, that `POST /subjects/:id/verification` gives
(`no_mail_relay`, `unavailable`). The usecase reaches them through
`sendLink` and the relay check `sendAccountEmail` already makes; the request is
refused before the pending row is written, so nothing is left behind.

**Response.** 200, as now. The subject carries a new optional `pending_email`
(string or null). It is returned by `GET /subjects/:id` and by the PATCH
response, and not by the list: a list stays a constant number of queries. The
ETag still covers `{id, type, username, email, enabled, created_at}`; a pending
address is not part of it, and an email-only PATCH still needs no `If-Match`.

**Notice to the old address.** The existing own-change mail,
`address_change_requested` (`packages/email`), sent through
`queueOwnChangeNotice` only when the old address is verified, as the person's
own request does. Its text is neutral ("Someone asked to change the email
address on your account. This address stays on the account until the new one is
confirmed."), so it is true for an administrator's request and needs no new
template or Arabic entry. A person with no verified address is told nothing;
the audit row records `skipped_unverified` or `skipped_none`.

**Audit.** One `subject.amend` row. Its before/after diff cannot show a pending
address, so its detail carries `{ email_change: 'requested', pending_email,
notice }`. Completion and cancellation are audited by what already audits them
(`email.changed`) and by the same `subject.amend` for a cancel.

## Console

The subject's Profile tab keeps its email field. After a save that starts a
change it shows "Change pending: x@y. The current address stays until they
confirm it." with a "Cancel the change" action, which is the PATCH back to the
current address. The sentence at `ProfileTab.tsx:86` ("A changed email is
unverified until it is proved or marked verified below") becomes untrue and is
replaced. The "Email verified" switch (profile PATCH) is unchanged. All wording
is a constant in the slice's services, with no logic in a use case (ADR 0010).

## A reset link goes only to a proved address, where the tenant asks for proof

Observed today: `requestPasswordReset` finds the person by address whether or
not it is verified (`users.ts` `byEmail`: "reset and verification are
independent actions"). Redeeming the link ends every session and grant
(`recoverAccount`) and, only for an account that registered itself and was never
verified, removes its second factors and marks the address verified
(`account.address_proved`, `proveAddress`). That covers a stranger who
self-registered with someone else's address. It does not cover an address a
person or an administrator typed wrongly at creation, import or bulk creation:
those rows are not `self_registered`, stay unverified, take a reset link, and
the link sets a password. Where the person has no second factor, whoever reads
that mailbox owns the account. Confirmed administrator changes (above) no longer
add to this set, but the existing members remain.

Rule: **when the tenant's `verify_email` setting is on, a password-reset request
mails a link only to a verified address.** When it is off the tenant has chosen
to accept unproved addresses, so reset behaves as today. The owner confirmed it on 2026-11-18 after research found no
standard that conditions reset on a tenant setting: NIST SP 800-63B-4 and
Amazon Cognito require a verified recovery address, Auth0's and Keycloak's
default reset flows send to unverified ones, and OWASP is silent. The rule is
Odudu's own compromise between them. The alternatives were gating always (breaks recovery for every tenant that turns
`verify_email` off, whose addresses are never verified) and never (leaves the
hazard).

- The request is answered exactly as now ("requested") whatever happens, and a
  skipped request costs the same as one for an address nobody holds, so nothing
  tells a caller whether an address exists or is verified. It does not spend the
  address's mail budget.
- A person with an unverified address on such a tenant recovers by asking for a
  new verification link (`asking-for-a-new-verification-link`) or by an
  administrator's `POST /subjects/:id/verification` or
  `POST /subjects/:id/password-reset`. The administrator's reset is unchanged: an
  administrator chose to send to the address on file.
- Sign-in by address already needs a verified address (`byVerifiedEmail`), so
  reset joins sign-in in treating the address as proved only when it is.
- Left standing, and where it is placed: on a tenant with `verify_email` off,
  reset to an unproved address works as it does today. The plan records that in
  the concept page and the changelog rather than in a `docs/NEXT.md` row, since
  it is the tenant's setting doing what it says.

NIST SP 800-63B-4 ("account recovery SHALL cause a notification") and OWASP
both want a notice to the person after a reset, and a completed reset sends
none today (callers of `enqueueCredentialNotice` are second-factor and
recovery-code removal only). The owner decided on 2026-11-18 that this
increment builds it rather than placing it on a phase.

**Reset-completed notice.** When a reset link sets a new password, a mail goes
to the address on file, in the person's language: it names that the password was
reset and when, carries no link, code or secret, and tells whoever reads it what
to do if it was not them. It goes to the address on file whether or not that
address is verified, as the credential notices do (the notice carries nothing a
stranger could use). It is queued in the transaction that sets the password, so
a rollback sends nothing; a person with no address is skipped without a trace.
It is a new message in the email catalogue with its Arabic counterpart, built on
the existing notice shell, not new markup. The audit row for the reset records
the notice outcome.

Tests the plan owns: the lookup used by reset takes the tenant's `verify_email`
(one settings read, already made by the registration path; no new query per
request beyond it); an int test for verified, unverified and absent addresses
with the setting on and off; the same HTTP answer and mail count in each case;
`apps/server/tests/reset-ends-access.int.test.ts` still holds for the
self-registered case (that case now needs `verify_email` off to be reachable, so
the test sets it); the docs that state the old rule: the comment above `byEmail`,
the reset and recovery concept text, and the reset transcripts re-run on a live
stack.

## Goals, non-goals

Goals: no unproved address is ever stored by an administrator's change; where
the tenant asks for proof, a reset link reaches only a proved address; a
person keeps signing in by their old address and by their handle until they
confirm; the old address is told.

Non-goals, each with where it goes:

- A per-address mail budget on this path. The me API throttles because the
  caller is the person; an administrator is authenticated and audited. My call.
- An administrator setting an address as already verified. `PATCH /subjects/:id/profile`
  refuses `email`, so after this change an existing address changes only by the
  person's confirmation. Creating a subject with an address, the tenant import
  and `odudu seed user --email-verified` are unchanged.
- MCP: there are no subject write tools; P5b's catalogue already classes this
  route as access-changing. Nothing to add.

## Approaches considered

1. **Opt-in `email_change: confirm` field, default replace** (the earlier
   recommendation). Rejected by the owner: it keeps the trap as the default and
   adds a field every caller must learn.
2. **Attestation only** (`email_verified` on the same PATCH, Auth0 style).
   Rejected: it moves the trap to a flag, and an admin can already attest
   through the profile door.
3. **Confirm always** (chosen). Reuses the pending table, token, swap and
   audit vocabulary of the person's own change, and is the Cognito, Keycloak
   and OWASP sequence.

## Performance and scale

One pending row per subject (`pending_email_changes`, primary key
tenant and subject). The PATCH adds a constant number of queries: the holder
lookup it already makes, one upsert, one outbox insert for the link, at most one
for the notice. `GET /subjects/:id` adds one read of the pending row. No list
reads it, and nothing in process is unbounded.

## Left to the builder

Where the planning of the three cases lives (a pure function in
`protocol-admin/src/service`; `packages/me` and `protocol-admin` do not import
each other, so `planEmailChange` is not shared unless a layer both may import
holds it); how `sendLink` is told the address is the pending one
(`AccountLinkRequest.email` already carries it); the error code strings.

## Documentation this owns

`apps/docs/content/en/reference/transcripts/admin-paths/patch-subjectsid.md`
re-run on a live stack with the new behaviour (pending, still signing in by the
old address, completion by link, cancel); `admin-console/subjects.mdx:60`;
`admin-console/settings.mdx:96`; the screenshots; `CHANGELOG.md` under
`Unreleased` (Changed: an administrator's email change is now confirmed by the person, and
on a tenant with `verify_email` on a reset link goes only to a verified address;
Security: no unproved address is stored by an administrator's change). Docs tests that pin the wording change with it.
