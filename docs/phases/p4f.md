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
one with `400` like the three lists, and its block in the transcript is to be re-run at the close of increment 2.

### Open placements

None of these is argued in `docs/NEXT.md`; the row there points here.

1. **Liveness of a me token's session and grant on reads.** The door judges the token, not
   the session it was issued for: a token whose session has ended can still read until it
   expires (five minutes at the default). Decided in the increment that builds the freshness gate.
2. **Rate limit and CORS on the me routes.** The MCP route has a per-principal limiter and an
   origin throttle; the me routes have neither, and a browser application on another origin
   cannot call them yet.
3. **`/me` is missing from the previous-address window.** After a tenant switches address, the
   old address serves the routes in `WINDOW_SERVES` (`host-rules.ts`) for an hour, and `/me`
   is not among them, as the MCP route is not either.

### Known limits of the gated writes

- **The gate read and the write are separate transactions.** A session that ends between
  the freshness read and the write still lets the write through; the gate judges the moment
  it read, not the moment of the write.
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
