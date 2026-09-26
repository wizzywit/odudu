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

| Refusal                                                                  | Row                     | What bounds it                                                  |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------- |
| Login failure: bad credential, locked out, unknown subject               | yes                     | the per-IP throttle on `login-actions/authenticate`             |
| Client authentication failure naming a **registered** client, any method | yes, while under budget | `auditRefusalBudget`, below                                     |
| Client authentication failure naming an **unregistered** `client_id`     | no, a `warn` line       | nothing needed: no row                                          |
| Refusal after the client authenticated                                   | yes, while under budget | `auditRefusalBudget`: a public client proves nothing but a name |
| Admin `401`                                                              | no, a `warn` line       | nothing needed                                                  |
| Admin `403` to an authenticated caller                                   | yes                     | the caller is authenticated, and the row names it               |
| Foreign-issuer admin token, signature valid                              | yes                     | the caller holds a genuine token, and the row names its subject |
| Foreign-issuer admin token, forged or issuer not served here             | no, a `warn` line       | nothing needed                                                  |

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
`docs/request-paths.md` rely on naming their own.
`ip` is the evidence, and only a trusted proxy can change it. So a
`request_id` join between rows is reliable only for requests an operator
made or that came through a proxy it trusts; for anyone else's it shows
what the caller chose to claim, and an investigation reads `ip`, the actor
columns and `occurred_at` instead. Gating the header on `ODUDU_TRUST_PROXY`
was rejected: it would break every transcript's scoping and protect a value
that proves nothing either way.
