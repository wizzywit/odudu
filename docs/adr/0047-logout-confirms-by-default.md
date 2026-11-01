# 0047 — Logout confirms by default; a client may opt out for its own hint

**Status:** Accepted · 2026-10-27

## Context

`/logout` ended the session at once for any request carrying a valid
`id_token_hint`. OIDC RP-Initiated Logout 1.0 §2 says the OP "SHOULD ask the
End-User whether to log out", and its §6 calls a logout request that needs no
End-User action a denial-of-service vector. An ID token is a bearer value that
lands in logs, browser history and referrers, and a `GET` with one signed the
End-User out of every client from any page that could cause a navigation.

The confirmation form's `client_id`, `post_logout_redirect_uri` and `state` were
also outside the anti-forgery token, so a form edited after it was issued still
verified.

## Decision

- `/logout` shows its confirmation page by default. Only the confirmation
  `POST` ends a session; a request with no valid hint, a hint for another
  session or an expired hint (accepted only to identify the session, as the
  spec says) asks as well.
- The form's `client_id`, `post_logout_redirect_uri` and `state` are bound into
  the anti-forgery token (`SessionEntry.proof`, each value length-prefixed).
- A per-client setting, `skip_logout_confirmation`, is off by default and lets a
  client skip the page. It applies only to a valid hint whose audience is that
  client and whose `sid` is the live session's; every other request asks.
  Dynamic Client Registration never accepts the field. It is set only through
  the admin API with `manage-clients`, audited. The console's own client has it
  on, because its ID token is held server side and its sign-out is a click in
  an authenticated page. Built in P4b: `clients.skip_logout_confirmation`, the
  tenant document carrying it, and the console's own client set by the migration
  and by `provisionAdminClient`.

The residual risk of the opt-out is the one the confirmation closes: anyone
holding an ID token for such a client can force that sign-out. An expired token
counts, as it does for every logout hint, which the warning beside the setting says. The
console says so beside the setting.

## Consequences

An RP sees one extra page on sign-out unless its operator opts in, and a
console sign-out is unchanged. A forger who can read the page only through the
victim cannot retarget the redirect or `state`.

## Alternatives rejected

- **Skip for every valid hint (Keycloak).** It is the leaked-token sign-out,
  for every client, with no way to turn it off.
- **Never skip.** It adds a click to the console's own sign-out, where the
  request already comes from an authenticated, anti-forgery protected page.
- **A tenant-wide switch.** One client's trust would extend to every client.
