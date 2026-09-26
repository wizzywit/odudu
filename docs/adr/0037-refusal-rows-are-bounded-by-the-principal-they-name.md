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
| Refusal after the client authenticated                                   | yes                     | the client is authenticated, and the row names it               |
| Admin `401`                                                              | no, a `warn` line       | nothing needed                                                  |
| Admin `403` to an authenticated caller                                   | yes                     | the caller is authenticated, and the row names it               |
| Foreign-issuer admin token, signature valid                              | yes                     | the caller holds a genuine token, and the row names its subject |
| Foreign-issuer admin token, forged or issuer not served here             | no, a `warn` line       | nothing needed                                                  |

`auditRefusalBudget` is an in-memory sliding window keyed on
`(tenant, client)`, built from the same `slidingWindow` helper as the
client secret limiter (`apps/server/src/app.ts`): at most 20 rows per
registered client per 60 seconds. The call that spends the window writes
one `client.authenticate` row with `reason: rate_limited`; later refusals in
the window are `warn` lines. It is separate from the client secret limiter
because that limiter applies to password methods only, and counting
`private_key_jwt` or `tls_client_auth` failures against it would turn a
`400` or `401` into a `429`, a response change. The budget changes no
response; it decides only whether a refusal is a row or a log line.

A refusal at `/token` or `/revoke` carries its annotation on the thrown
`TokenError`, and the route's `catch` records it in a sibling transaction
of its own (`packages/protocol-oidc/src/view/routes/record-refusal.ts`). A
throw there is caught and logged at `error`; the response is the one the
caller was always going to get. After authentication, `invalid_grant`,
`invalid_scope`, `invalid_target` and `unauthorized_client` are recorded;
`invalid_request` is not, since it describes a malformed request rather
than a decision about the client.

## Consequences

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
  only reports it.
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
