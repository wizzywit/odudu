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

1. **The notice to the old address** when a way to sign in is removed or the address changes
   goes with the notice-mail increment (spec section 5.5), and must land before the phase closes.
2. **The administrator's `updateEmail` holder check is case-sensitive** where the address the
   verification link completes is not; the case-reconciliation increment places it.
3. **Rate limit and CORS on the me routes**, as in increment 1, still open.
4. **The gate and the write are separate transactions** (below), a limit recorded and not removed.

### Known limits of the gated writes

- **The session read and the write are separate transactions.** A session that ends between
  the read (the freshness gate's, or the liveness check's on an ungated change) and the write
  still lets the write through; the check judges the moment it read, not the moment of the write.
- **A username edit is gated on the member being present in the body**, not on the value
  changing, because knowing it is unchanged needs the profile read before the gate.
- **No notice mail goes to the old address** when a way to sign in is removed or the address
  is changed; the admin routes enqueue those mails, and the me routes' notices are placed on
  spec section 5.5 (the notice-mail increment).

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
no such pass: the table cannot hold more rows than the tenant has subjects. The notice to the old address is placed on spec section 5.5.

## Increment 3: which actions a client may start

### Increment 3 owes at close

- Re-run the `get-adminopenapijson.md` admin-paths transcript on a live stack.
  Its content length (810507) and size in KB (792) were edited by hand after
  `allowed_actions` changed the OpenAPI document, so they are a claim until the
  run replaces them.
- Re-run the transcripts the new field and refusals touch: the client read,
  create and amend pages, the export page, `delete-scopesidclientsclientid.md`
  (the 409 with `allowed_actions_need_me_read`) and the scope delete page.
- Console: the clients area page under `admin-console/` and `tour.mdx` describe
  the "Application actions" section of the Advanced tab; then
  `pnpm docs:screenshots` for the Advanced tab. No console e2e spec exists for
  the section.
- `CHANGELOG.md` under `## [Unreleased]`: `allowed_actions` on a client (admin
  API, console, tenant document, `odudu seed client --allow-action`, which
  assigns `me:read` itself), and the guards that keep `me:read` with a client
  that may start an action or holds `me:write` (unassign and delete).
- Concept or guide prose that names client settings, the CLI help and the
  error `allowed_actions_need_me_read` page entries (generated from the kernel).
- Dynamic Client Registration refuses `allowed_actions` as an operator-only
  field, as it does `skip_logout_confirmation`; say so where registration
  metadata is documented.

### The action request owes at close

- Transcripts re-run on a live stack: the authorization request with `action`
  (the refusals at the redirect, the page, the way back with `action_status`),
  the required-action pages with the cancel control and the current-password
  field, and the credential list after a completed action.
- The guide "Send a person to change a credential": `action_status` is a hint,
  the "me" API's credential list is the authority; the page does not run when
  the client may not start the action; a sign-in older than the tenant window
  is asked for again; the person may cancel.
- `CHANGELOG.md` under `## [Unreleased]`: the `action` parameter and
  `action_status`, the audit actions `action.requested|completed|cancelled|failed`
  (generated vocabulary reference), the current password asked for a requested
  password change, a requested authenticator swapping a held one.
- Placed, not built: an expired sign-in under an action returns the person to
  the client with `action_status=error` only where the request cannot be
  restarted (a hinted one); the restart link otherwise carries `action`. No
  audit row is written for that return, which is a link, not a request.
- The "me" write refusal for an agent token has no counterpart at `/authorize`:
  no session or grant carries an agent marker, so there is nothing to refuse.
