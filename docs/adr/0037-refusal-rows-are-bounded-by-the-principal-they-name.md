# 0037 — Refusal rows are bounded by the principal they name

**Status:** Accepted · 2026-09-26

## Context

Two requirements pull against each other. OWASP's Logging Cheat Sheet and
ASVS 5.0 V16 (Security Logging and Error Handling) both require every
authentication decision to be logged, failures included. The same OWASP
guidance requires that logging cannot be used to exhaust the resources it
writes to. An audit row is a durable insert into `audit_events`, kept for
`audit_retention_days`, and a refusal is by definition something an
unauthenticated caller can provoke as often as it likes.

`/token` and `/revoke` refuse by throwing, so their transaction rolls back
and a row written inside it disappears with it. A refusal's row therefore
has to be written somewhere else, and a failure to write it must not turn
the caller's `401` into a `500`: P4c reverted its cross-tenant audit partly
because a throw there did exactly that.

Keycloak draws the same line from the other side. Its `EventType.java`
saves `LOGIN_ERROR` and `CLIENT_LOGIN_ERROR` by default, and leaves
`REFRESH_TOKEN` and `INTROSPECT_TOKEN` off by default as high-volume (read
from source on 2026-09-26).

## Decision

Whether a refusal becomes a row is decided by what the refused request
**names**, and a row is written only where something bounds how many a
caller can cause:

| Refusal                                                                             | Row                                          | What bounds it                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Login failure: bad credential, locked out, unknown subject                          | yes                                          | the per-IP throttle on `login-actions/authenticate`             |
| Client authentication failure naming a **registered** client, any method            | yes, while under budget                      | `auditRefusalBudget`, below                                     |
| Client authentication failure naming an **unregistered** `client_id`                | no, a `warn` line                            | nothing needed: no row                                          |
| Refusal after the client authenticated                                              | yes, while under budget                      | `auditRefusalBudget`: a public client proves nothing but a name |
| Admin `401`                                                                         | no, a `warn` line                            | nothing needed                                                  |
| Admin `403` to an authenticated caller                                              | yes                                          | the caller is authenticated, and the row names it               |
| Admin `409` guarding the built-in admin surface (amendment, 2026-09-28)             | yes                                          | the caller is authenticated, and the row names it               |
| A subject a tenant-wide admin door leaves beyond the ceiling (ADR 0040, 2026-09-30) | no refused row; counted on the `allowed` row | the one row the door writes carries the count                   |
| Foreign-issuer admin token, signature valid                                         | yes                                          | the caller holds a genuine token, and the row names its subject |
| Foreign-issuer admin token, forged or issuer not served here                        | no, a `warn` line                            | nothing needed                                                  |

`auditRefusalBudget` is an in-memory sliding window keyed on
`(tenant, client)`, built from the same `slidingWindow` helper as the
client secret limiter (`apps/server/src/app.ts`): at most 20 rows per
registered client per 60 seconds. Every refusal row at `/token`, `/revoke`
and `/introspect` spends it, not only failed client authentication: a
public client authenticates by presenting its `client_id` and nothing else,
so anyone who knows one could otherwise append a refused `token.refresh`
row per request with a random refresh token. The call that spends the
window writes one row with `reason: rate_limited`, under the action the
refusal would have had; later refusals in the window are `warn` lines. It
is separate from the client secret limiter because that limiter applies to
password methods only, and counting
`private_key_jwt` or `tls_client_auth` failures against it would turn a
`400` or `401` into a `429`, a response change. The budget changes no
response; it decides only whether a refusal is a row or a log line.

A refusal at `/token`, `/revoke` or `/introspect` carries its annotation on
the thrown `TokenError`, and the route's `catch` records it in a sibling
transaction of its own (`packages/protocol-oidc/src/usecase/record-refusal.ts`).
At `/introspect` only failed client authentication is a refusal: a
successful introspection issues and changes nothing, and writes no row. A
throw there is caught and logged at `error`; the response is the one the
caller was always going to get. After authentication, `invalid_grant`,
`invalid_scope`, `invalid_target` and `unauthorized_client` are recorded,
and so is a token exchange's `invalid_request` (the second amendment); an
`invalid_request` from parsing the request, before the client is known, is
not. A public client asking for
`client_credentials` answers `invalid_client` and is recorded as
`unauthorized_client`. A `private_key_jwt` client whose `jwks_uri` cannot be
fetched is a `warn` line, not a row: that is this server failing to reach
the client's keys, not the client failing to authenticate.

## Consequences

- No client, public or confidential, can put more than 20 refusal rows a
  minute into `audit_events`, whatever it is refused for.
- An unregistered `client_id` costs a log line, never a row, however often
  it is tried. The line names the tenant and the claimed `client_id`, which
  is not a secret.
- A registered client's refusal costs one extra transaction before the
  response. That makes a registered `client_id` slightly slower to refuse
  than an unregistered one; a `client_id` is not a secret, so this discloses
  nothing the discovery of a client does not.
- The budget is per replica, so N replicas admit N times the window.
  Acceptable while Odudu is single-replica. **P11**, which brings
  multi-replica deployment, owns making it shared alongside the other
  per-process limiters.
- A revocation the server performs on detecting reuse
  (`grant.revoked_on_reuse`) or code replay
  (`grant.revoked_on_code_replay`) is written in the transaction that
  revokes, inside a savepoint: a failed insert is logged and the revocation
  commits regardless, because the revocation is the control and the row
  only reports it. It is written only by the call that revoked the grant,
  so a spent code replayed any number of times writes one, and it names the
  grant's own client; the refusal beside it names the client that asked.
- A refresh whose rotation commits and whose post-rotation check then
  refuses carries two rows under one request id: the `token.refresh`
  `allowed` row, which is true (the presented token was consumed and a
  replacement exists), and the `token.refresh` refusal that explains why no
  token was returned.
- `token.refresh` is written even though Keycloak does not save it by
  default: a refresh is a credential being renewed, which is what an audit
  exists to show, and `audit_retention_days` bounds its volume.

## Alternatives rejected

- **A row for every refusal.** Meets the letter of OWASP and ASVS and
  breaks OWASP's own resource rule: an unregistered `client_id` sprayed at
  `/token` would grow `audit_events` without limit.
- **Count every method against the client secret limiter.** One window
  instead of two, but a `private_key_jwt` or `tls_client_auth` client past
  it would start answering `429`, which changes the response the audit is
  meant to leave alone.
- **Write the refusal row inside the request's own transaction.** It rolls
  back with the refusal, so no refusal would ever be recorded.
- **A row for an unregistered `client_id`, keyed by the claimed value.**
  The key is caller-chosen, so the budget bounds nothing: a caller rotating
  `client_id`s gets a fresh window with each one.

## Amendment, 2026-09-26 — refused credential and session changes

The table above lists the refusals that write a row; these write none, by
the same principle.

- **A refused reset or verification link** — spent, expired or unknown —
  and a refused registration name no principal. The caller chooses the key
  or the username, which is the unbounded append this ADR rejects for an
  unregistered `client_id`.
- **A password the policy refuses, a reused password, and a wrong TOTP code
  or refused passkey at enrolment** are form validation on a session that
  has already authenticated, not authentication decisions. The change that
  succeeds writes its row.
- **A logout that ends no session** changes nothing, so there is nothing
  to record.

Nothing logs why any of these was refused. The request log at `info`
records each request's method, path without its query, status and request
id, so an operator can see that one happened, but not that it was a refusal
or its reason.

## Amendment, 2026-09-26 — a token exchange's `invalid_request`

A token exchange's `invalid_request` is a refusal. RFC 8693 §2.2.2
answers `invalid_request` when the subject or actor token "is invalid for
any reason, or is unacceptable based on policy", so at this grant it is a
decision about an authenticated client's tokens, not a malformed request.
Every `invalid_request` the exchange answers after the client authenticated
is a `token.exchange` refusal under the client's budget: a subject or actor
token that is unknown, expired, revoked or another client's, and an act
chain that cannot be extended, as `invalid_grant`; an actor `may_act` does
not name, as `subject_mismatch`; a token type this server does not
exchange, as `unsupported_token_type`. A request missing a parameter is
refused while it is parsed, before any client is known, and writes nothing.

## Amendment, 2026-09-26 — `request_id` is a correlation id, not evidence

A caller sets `request_id` with `x-request-id` whatever `ODUDU_TRUST_PROXY`
says, because a proxy in front and every transcript in
`apps/docs/content/en/reference/transcripts/request-paths/` rely on naming their own.
`ip` is the evidence, and only a trusted proxy can change it. So a
`request_id` join between rows is reliable only for requests an operator
made or that came through a proxy it trusts; for anyone else's it shows
what the caller chose to claim, and an investigation reads `ip`, the actor
columns and `occurred_at` instead. Gating the header on `ODUDU_TRUST_PROXY`
was rejected: it would break every transcript's scoping and protect a value
that proves nothing either way.

## Amendment, 2026-09-28 — a `409` guarding the built-in admin surface

An admin `409` that refuses to change what every administrator of a tenant
depends on is a refusal to an authenticated caller, and writes a row the way
a `403` does, with the reason under `detail.reason`. That is
`builtin_admin_guarded` — amending or deleting the tenant's built-in admin
client, unassigning one of its scopes, deleting one of its roles, and adding
or removing a composite of one — `openid_guarded`, on deleting the `openid`
scope, and `system_tenant_guarded`, on disabling the system tenant through
`PATCH /admin/tenants/{tenant}` or `PATCH /settings`. The same protection
already wrote a row at create (`reserved_client_id`,
`default_on_admin_client`), so the question an operator asks — who tried to
delete `tenant-admin` — had an answer on one door and none on the others.
A `409` that reports a conflict with the data rather than a guard, such as
a cycle, a taken name or a stale `If-Match`, is not a refusal of the caller
and writes nothing.

## Amendment, 2026-09-29 — a `409` guarding the last administrator

A `409` of type `about:blank#last-administrator` is the same kind of
refusal as `builtin_admin_guarded`:
a guard on what every administrator of a tenant depends on, refused to an
authenticated caller. So it writes a `refused` row under the action the
caller attempted, with the reason under `detail.reason`, on every door
ADR 0040's amendment lists. The attempted write itself is undone first,
inside a savepoint, so the row is the only trace it leaves.

## Amendment, 2026-10-15 — what `actor_origin` says

A row's `actor_origin` is computed when the row is read and never stored
(`originOf`, `packages/protocol-admin/src/usecase/audit.ts`). It is `tenant`
when the row's `actor_tenant_id` is the tenant whose trail is being read,
`system` when it is the system tenant's (a system administrator acting
across tenants), and `other-tenant` otherwise: a subject of another tenant
whose token reached this one and was refused (`token.foreign_issuer`). It is
`null` when the row names no actor subject or no actor tenant, so a caller
from elsewhere recorded with no subject is not marked. Every admin writer
passes the caller's subject, so no producer of that case exists today.

A name is resolved only for `tenant` rows, and only for a caller who holds
`view-users`; `system` and `other-tenant` callers are shown by id. The
console marks `system` and `other-tenant` as "from elsewhere" and does not
compute the comparison itself, since the row carries no id for the tenant it
is read under.

## Amendment, 2026-10-23 — a registration for an address that has an account

When `verify_email` is on, registering an address that already has an account is answered as a
registration of a free one is: the same page ("Check your email"), status 201. A free address is kept
as a pending registration, with the hash of the password the person typed, and mailed a link. The
account is created only when the link's button is pressed, so neither request reserves a username and
no later request can tell them apart. A held address writes one `credential` row,
`account.registration_duplicate`, `refused`, reason `already_registered`, and one mail to its holder.

The row names the account the attempt ran into (`resource_id`), never the username or address asked
for. The first amendment above says a refused registration names no principal. This one does. So it is
bounded as a login failure is, by the per-origin throttle on the registration form.

**Mail.** Mail to one address is bounded at three an hour for each kind (the registration link, the
notice to a held address, a password reset), per tenant and address, by an in-process limiter that
suppresses the queueing and never changes the answer. A refused registration mail also leaves an
earlier pending request, and its link, as it was, so flooding an address cannot kill a person's own
link. To evict one address from the limiter an attacker needs about 100,000 accepted requests, and
gains one more budget of three mails. The limiter is per process: a restart clears it and N replicas
allow N times as much (P11).

**What stays enumerable.** Usernames, on purpose. Addresses only with `verify_email` off, where
nothing can be mailed. An administrator, who is authenticated, still gets a `409` for a taken address.
Addresses match by ASCII case (`ADA@x` is `ada@x`, `É` and `é` are not); an account an administrator made
can still hold a case variant of another, because the unique index compares bytes and a migration that
fails on data already there is worse than the gap. Every creator of an account for an address takes an
advisory lock keyed on the tenant and the lower-cased address, so the check that follows it sees what
the one before committed.

**Pre-registration takeover.** Anybody can register an address that is not theirs with a password they
chose. If its owner confirms the unexpected mail, the account has the registrant's password. Three
things limit it: a later registration for the same address replaces the pending request (the owner who
registers himself overrides an attacker's), the link is single use and short lived, and the mail and
the confirm page say what the link does and name the account. A password reset ends every session and
every grant of the account, so the registrant's access dies when the owner recovers it with "Forgot
password". The risk that remains is a person who confirms a mail they did not expect and never resets.
With `verify_email` off nothing is mailed, the form says the address is registered as before, and no
row is written.

## Amendment, 2026-10-26 — what a mailed link proves

A link mailed to an address proves one thing: whoever redeems it reads that mailbox. Two links
set a password, the reset link and a required-actions link that asks for `update-password`. They
now do the same work, in the transaction that sets it.

- **Sessions and grants.** Every session of the account ends and every grant is revoked, offline
  ones too. The required-actions link used to skip this. Its back-channel logout tokens carry the
  issuer the logout route uses.
- **A self-registered account nobody verified.** The users table records which accounts their
  own registration form made (`self_registered`, migration 0105). Where such an account's address
  is still unverified and is the one the link was mailed to, redeeming the link deletes the
  account's authenticator app, passkeys and recovery codes, marks the address verified and clears
  the mark, so it happens once. The row `account.address_proved` records it, and the page the
  person sees says what was removed. The case it answers: in a tenant without `verify_email`
  anybody can register an address with a password of their choosing and enrol a factor. A passkey
  is a complete first factor, and an authenticator app locks the real owner out behind a code
  they do not hold. The password and its history stay. Nothing else is touched: an account an
  administrator or the seed command made, a verified address, and every other factor keep theirs.
  The mark clears when the address is verified or changed by any route. Accounts that registered
  before migration 0105 are unmarked, so they never lose factors this way: the safe side.
  The owner-notice mail has no template for this, so there is no mail.
- **What this costs.** For such an account the mailbox outranks the factors: whoever reads it can
  reset the password and the link removes the second factor, so a mailbox compromise is a
  second-factor bypass. Accepted: the mailbox is already the only recovery path for an account
  nobody verified, and the alternative leaves a stranger's passkey signed in to it. A person who
  registered themselves, enrolled a factor and never verified the address loses it at their next
  reset and enrols again.
- **Case.** A reset request finds the account by the address ignoring ASCII case, as
  registration does, and mails the stored address. Registration and an administrator's creation
  take the address lock before they look for an existing holder. P4f closed the gap it left: `odudu
reconcile-accounts` folds the pairs, and migration `0139` builds the partial unique index on
  `(tenant_id, email_search)`, skipping itself with a warning where a pair remains (a migration
  that failed on data already there would be worse than the gap) and built by the first start
  after the command has run.

**Accepted.**

- **Spending an address's mail budget.** Anybody may use up the three mails an hour for an
  address, so its owner's reset or registration mail is not sent that hour, and the page says
  the same thing either way. A repeat registration request replaces the address's pending row,
  so a link already mailed dies. Bounding what one person can do is the per-origin throttle on
  the forms; the mail itself tells a real owner what was asked. A limiter shared across
  instances, with more to go on, is P11's. Not replacing a pending row inside the cooldown needs
  no shared limiter but was left: it would let a stranger's earlier request block the owner's own
  registration, which today overrides it.
- **A registration the victim confirms.** Somebody who confirms a "finish registration" mail
  they did not ask for gets the account its sender chose, and the sender may then enrol a
  factor, since the address is verified from that click. The mail and the confirm page name the
  account. P4f made the confirmation page name the address, the account and the tenant and change
  nothing until its button is pressed, which is the whole of what is asked for.
- **Timing on old rows.** A password that is not in NFC form costs one more hash check on an
  account whose hash predates normalising. The row converts at its next sign-in.
