# P5a — the MCP server, first release

The running record of what building the phase found. The argument is in
[the spec](../superpowers/specs/2026-11-05-p5a-mcp-server-design.md) and
[the plan](../superpowers/plans/2026-11-05-p5a-mcp-server.md).

## The spike (Increment 0), 2026-11-05

Three claims the plan rested on were about libraries and about this
repository's token exchange. Each was run, not read.

### The SDK serves both eras and mounts on Fastify

verified: `npm view @modelcontextprotocol/server version time` — 2.4.0,
published 2026-10-23. `@modelcontextprotocol/node` 2.1.2 and
`@modelcontextprotocol/fastify` 2.0.1 exist and are older than the 24-hour
release-age floor. The Inspector's latest (2.14.0) was ten hours old, so the
version the floor allows is 2.13.0.

- `createMcpHandler(factory, { legacy })` from `@modelcontextprotocol/server`
  serves 2026-07-28, and by default 2025-11-25 `initialize` traffic **without
  sessions** (`legacy: 'stateless'`). `legacy: 'reject'` answers a 2025 request
  400 `-32022` with `data.supported: ["2026-07-28"]`. A session-keeping legacy
  mode is not provided. The spike did not test 2025-06-18.
- It mounts on plain Fastify 5 at `/tenants/:tenant/mcp`:
  `reply.hijack()` then `toNodeHandler(handler)(req.raw, reply.raw, req.body)`.
  The factory runs per HTTP request (about three times per legacy tool call),
  so per-tenant state comes from `ctx.requestInfo` or a cache.
- `@modelcontextprotocol/fastify` is a thin layer of Host and Origin hooks.
  Its lists are static, but a hook built inside the server's own `onRequest`
  from the tenant's accepted hosts works. The Origin check compares hostname
  only and lets a request with no Origin through. GET and DELETE answer 405.
- The handler verifies no token. A principal is passed in as
  `req.raw.auth = { token, clientId, scopes, resource }` and reaches tool
  handlers as `ctx.http.authInfo`. The 401 and its `WWW-Authenticate`
  challenge are Odudu's own `onRequest` work.
- The Inspector CLI (`--cli`, `--protocol-era modern`) runs headless with
  `--header 'Authorization: Bearer …'` and exits non-zero on failure. A
  headless full OAuth flow was not run; `--stored-auth-only` exits 3 with
  `auth_required` on a 401.

### The exchange works in-process, with three changes

verified by a scratch integration test (deleted) through the real `/token` and
the admin fixture:

- Delegation (an `actor_token`) mints `sub = owner`, a narrowed `scope`,
  `aud = [ADMIN_API_AUDIENCE, issuer]` and `act = { sub: <actor token's
subject> }`, with no `may_act` anywhere. Impersonation mints no `act`.
- **The admin API ignores `scope` and `act`.** A token narrowed to `openid`
  listed clients (`authenticate-admin.ts` checks issuer, audience, `typ`,
  grant, session, client and subject only). The plan's increment 5 owns this.
- **A public client with the exchange grant reaches it at `/token`** with any
  valid actor token, since `/token` needs no secret for a public client, and
  the actor token is not bound to the requesting client. Another client's
  `client_credentials` token worked as actor.
- `issueTokens` is not exported and always authenticates the client; the inner
  functions take an already-resolved client but are not exported either.

Consequences written into the plan: an in-process entry point that sets `act`
to the agent client directly (no actor token, no `/token` request); a refusal
of the exchange for public clients and a binding of an actor token to the
requesting client, both as settings an operator controls.

### What the target clients do (research; official docs unless marked)

- **Claude (claude.ai, Desktop connectors):** speaks the `initialize` era
  (2026-07-28 "rolling out", secondary). Client id: CIMD preferred (needs
  `client_id_metadata_document_supported: true` and `none` in
  `token_endpoint_auth_methods_supported`, else DCR), DCR, or a pasted client
  id. Redirect `https://claude.ai/api/mcp/auth_callback` (may become
  `claude.com`). Needs a public HTTPS URL: Anthropic's servers make the calls.
  No client-credentials extension. Requires a 401 with `resource_metadata`, a
  PRM `resource` equal to the MCP URL, form-encoded `/token`, S256 and rotating
  refresh tokens for public clients; uses the first `authorization_servers`
  entry; appends `offline_access` when the AS lists it.
- **Claude Code:** `http://localhost` works; CIMD document at
  `https://claude.ai/oauth/claude-code-client-metadata` with redirect URIs
  `http://localhost/callback` and `http://127.0.0.1/callback` (any port); a
  static `--client-id` and DCR also work; the v2 runtime can speak 2026-07-28.
- **Cursor:** DCR as a public client or a static `auth.CLIENT_ID`; no CIMD;
  redirects `http://localhost:8787/callback` and
  `https://www.cursor.com/agents/mcp/oauth/callback` (no `cursor://` found);
  `http://localhost` works; protocol revision unpublished.
- **Unknown, to capture by transcript:** the exact DCR bodies, any `iss`
  validation, Cursor's revision, hosted Claude's CIMD URL path.

Gate result: no target client needs a revision the SDK does not serve, so the
phase continues. Residual risk: the SDK source names only 2025-11-25 and
2026-07-28; the hand run records what each client negotiates.

## The built-in client

`odudu-mcp` is provisioned with every tenant and backfilled by migration 0114;
`clients.builtin_mcp` marks it, once a tenant. Its posture stays amendable: an
administrator may disable it (the off switch), change its name or lifetimes, even
its redirect URIs. Only deletion is refused, because its id is reserved and a
deleted client could not be created again, and only the marker is not
amendable. `odudu-admin` is guarded harder because every administrator depends
on it; nothing depends on `odudu-mcp`.

The export document carries no marker field. An import derives the marker from
the id, which is safe because the import refuses an `odudu-mcp` client that is
not public, has a `client_credentials` grant, or registers anything but the bare
`http://127.0.0.1` and `http://[::1]`: the shape that gets any-port loopback
matching cannot be smuggled in under that id. The replacement of the provisioned
row by the document's happens in the import's one transaction. Its row ids come
from `gen_random_uuid()` in the migration, not `newId()` (v7); lists key on the
id as a total order and `isUuid` accepts any version, so nothing assumes v7.

## Client ID metadata documents

A URL `client_id` becomes a client row, not a transient object: the usecases
after `/authorize` (consent, token, userinfo, introspection) all read clients
by `client_id` from `clients`, and a second path for a client that is not there
would have touched each of them. So `persistCimdClient` upserts the row, from
the validated projection, every time `/authorize` resolves the document; a
no-store document is fetched every time and never cached.

- **Off is unknown.** With `cimd_enabled` off, `/authorize` answers a URL id,
  including one with a stored row, byte for byte as it answers an unknown id,
  and `/token` refuses a stored row's client as `invalid_client`. A client
  registered by hand under a URL id is served whatever the setting says.
- **A failed fetch refuses the client**, even with a stored row, so a redirect
  address the owner has withdrawn does not keep working while their server is
  down.
- **Bounds.** At most 1,000 per tenant (a lock per tenant makes the check
  hold under concurrency); at the ceiling a new client evicts the least recently
  used one with no consent, no usable refresh token and no live code, else is
  refused, because resolving a document needs no sign-in; last use written at most once a day, and `reap`
  deletes a client unused for thirty days unless a refresh token of it can
  still be used. An administrator's `enabled = false` is never undone by a
  resolution.
- **Review round.** A client's `jwks_uri` is fetched public-only whatever
  `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` says; a `private_key_jwt` document needs a
  non-empty key set or a `jwks_uri`; the cache keeps the later fetch (stamped
  with when the fetch began); eviction and `reap` skip disabled clients (evict)
  and count a refresh token only while its grant is unrevoked and it has not
  lapsed by more than an access token's life; a late DNS answer sends nothing;
  roles of an omitted cimd client are left out of the export (and out of its
  size bound); `reap` also spares disabled clients; the userinfo encryption
  fetch is public-only for cimd clients. Every `clientKeySet.fetch` caller is
  the private_key_jwt authentication (/token, /introspect, /revoke) and that one.
- **The policy gives it an audience.** The client has no audience and no MCP
  scope of its own; both come from the tenant's `mcp` registration policy
  (the section below), never from the document. Turning the setting off does not
  disable stored rows: `/authorize` and `/token` refuse them by reading the
  setting, so a later control for the setting changes nothing else.
- **The setting reached the admin API with its column**, because tenant
  settings, their export and `seed tenant --set` are one map. The console
  control is on the Settings screen, in the Client registration section, together with the `mcp` policy.
- **`mcp` reached the same map as a value** of `client_registration_policy`
  (`SETTINGS`' `values`, which the settings API and `seed tenant --set` both
  read; an unknown spelling is a 400 naming the four, as it was for three). A
  settings amendment's audit event now carries a `tenant_settings` diff of
  those two settings only (`ALLOWLISTS`), where it carried no detail at all.

## The `mcp` registration policy

`client_registration_policy` takes a fourth value, `mcp` (migration 0117 widens
the CHECK; the default stays `disabled`). The registration endpoint is then open
to a public client and nothing else: `decideMcpRegistration` (a pure service)
refuses a client that would hold a secret, a redirect that is not `https` or
loopback `http` (a reverse-DNS custom scheme, which `open` admits, is refused),
a grant beyond `authorization_code` and `refresh_token`, a `scope` outside the
sign-in scopes and `mcp:read`, and an `audience` that is not the tenant's MCP
URL. The audience is not a member RFC 7591 defines; it is Odudu's, and the
response echoes it as `audience`. A client that omits
`token_endpoint_auth_method` is refused, not defaulted, because the RFC's
default is a secret. `registerMcpClient` (usecase) runs the budget, the
decision and the shared transaction; the client is written with the MCP URL as
its only audience, `mcp:read` as an optional scope, `consent_required` true and
`registration_origin` `anonymous`, and the existing `max_clients` lock bounds
the tenant.

- **Budget.** Ten registrations an hour per tenant and address, and sixty an
  hour per tenant over every address (`mcpRegistrationBudget`; the address is
  checked first, so a refused address spends none of the tenant's), over the
  `slidingWindow` the other routes use. The bound: at most `MAX_THROTTLE_KEYS`
  keys in each limiter, ten timestamps a key for the address one (the exact
  log) and sixty for the tenant one, so a tenant cannot be filled by
  addresses faster than sixty clients an hour (ADR 0023). The
  limiter is injected into `oidcRoutes` and is optional: a tenant on `mcp` with
  none wired answers 404, so open registration never runs without a budget.
  The budget is per process, as the other limiters are.
- **Consent.** `decideConsent` gained `approvalRequired` and `approved`. A
  client registered anonymously or resolved from a metadata document is asked
  about until a grant of its own exists, whatever `consent_required` says and
  even for a request naming no scope a grant could cover (`needsApproval`;
  "approved" is any grant row for that exact client id). A client registered
  with a token or by an administrator is unchanged. A consent that can record
  no scope (the client's vocabulary holds none of what was asked) cannot be
  approved, so such a request asks every time.
- **CIMD under the policy.** `/authorize` passes the tenant's MCP URL and
  whether the policy grants it to `persistCimdClient`, which rewrites the
  client's audiences (the MCP URL alone under `mcp`, the MCP URL removed
  otherwise, so one an administrator assigned by hand goes too, and any other
  audience left alone) and assigns `mcp:read` as optional when it holds none.
  Only a public document client takes part: one that authenticates with a key
  (`private_key_jwt`) is given neither, the same rule the registration policy
  has, and the policy never touches a client of another origin.
- **Ending the policy ends what it gave, for every client it touched.**
  `audiencesHeld` is applied at `/authorize` and `refreshUnderPolicy` on every
  refresh, to a client whose origin is `anonymous` or `cimd` (`needsApproval`):
  while the tenant's policy is not `mcp` the MCP URL is not one of its
  audiences and `mcp:read` is dropped from a refreshed token's scope, whatever
  its row or its grant says. So a refresh chain started under the policy
  carries no MCP audience once the policy is turned off, without a client row
  being rewritten. The stored row of a self-registered client still lists the
  MCP URL; it is ignored, and the row is removed by the reap rule below when
  unused or with the client. An administrator who wants one chain ended sooner
  disables or deletes the client.
  A refresh that names the MCP URL as its `resource` after the policy ended is
  refused `invalid_target` before the token is rotated (the pre-rotation check
  derives the held audience the same way), so a client's retry does not trip
  reuse detection. A tenant with a domain is registered and authorized at the
  domain, where both derive the MCP URL from the same address; its path
  address no longer serves registration, so no other audience can be stored.
- **mcp:write.** A client of those origins is refused `mcp:write` at
  `/authorize` (`refusesWriteScope`) even if an administrator assigned it,
  so the policy's ceiling holds for a row nobody at the tenant vetted.
- **Registration refuses more than the spec lists.** A `jwks`, a `jwks_uri` or
  a logout address is refused under `mcp`: a public client holds no key, and a
  logout address would have the server call or load an address chosen by an
  anonymous registrant.
- **Reaping.** `odudu reap` reports `dynamic_clients`: a public client of
  origin `anonymous`, enabled, older than a week
  (`UNUSED_DYNAMIC_CLIENT_SECONDS`), with no consent, no token grant (a grant is reaped by its own rule
  first, once past its retention, and only then can the client go) and
  no unexpired code, is deleted; one with any of those is kept. It
  applies to every self-registered public client, not only those the `mcp`
  policy made. Served by `clients_anonymous_public_by_created` (migration 0118) with the existing `consents_by_client`, `token_grants_by_client` and
  `authorization_codes_by_client`; the plans suite covers the statement at
  volume (1,000 such clients in one tenant).
- **Not done here.** Neither `seed tenant --set` nor the admin settings accept
  `mcp` yet. The settings API must accept it (`tenant-settings.ts` `values`, and
  the console's parity list), and the closing pass lists that against the
  admin-field and console work; the
  tenant export schema (`registrationPolicySchema`) accepts it, because an
  export of a tenant set in the database would otherwise fail.

## The admin API and an agent's token

The principal carries `scopes` and, for an agent, `agent`. An agent is a token
with an `act` claim, one from the tenant's `builtin_mcp` client, or one holding
`mcp:read` or `mcp:write`; a malformed `act` or `scope` is a 401, an agent
holding no MCP scope a 403. An agent must pass both gates: the scope
(`scopeAdmits`, `service/agent-scope.ts`) and the owner's capability.

- `mcp:read` admits exactly the GET routes. `mcp:write` adds
  `AGENT_WRITE_ROUTES`, admitted by field on the body the handler reads:
  `name`, `description`, `name_i18n`, `description_i18n` of a
  client and `description`, `description_i18n` of a scope. Anything else in the
  body, `enabled`, `redirect_uris` or `consent_text` among it, is a 403
  `insufficient_scope`. `consent_text` is left out because it is what a user
  agrees to; an agent that renames a client does so on the consent screen too.
- Each refusal is a `capability.refused` row with `reason` `insufficient_scope`
  or `agent_without_mcp_scope`, the owner as actor and the client row's id
  (`principal.clientDbId`) as the actor client. `agent.clientId` is `act.sub`
  when the token has one and so depends on how it was minted: audit uses the
  database id.
- Reads are every GET except `AGENT_DENIED_READS`: the tenant export, the
  audit export and a theme image's bytes, each a whole document or download
  in one call that a person fetches with their own token (export is not a
  tool).
- `name` and `name_i18n` of a built-in client (`builtin_admin` or
  `builtin_mcp`) are refused to an agent; the handler reads the target row
  with `loadClientState`, no second body read. Residual for the guide: an
  agent may still rename an ordinary client, which shows on its consent
  screen. It is reversible and audited as `client.amend` with the agent's
  client row as actor client.
- Not enforced anywhere an operator can see yet: no agent token exists
  outside tests until the MCP server mints them.

## Audit attribution

- `agent.tool_call` is an `admin_access` action, one row per MCP tool call,
  reads included. Its detail is `agent_client`, `owner`, `tool` and `route`,
  and the allowlist has no key for arguments or results; the row's actor
  columns carry the owner and the agent client row too, so the audit list
  filters find it. `recordAgentToolCall` (`usecase/access-audit.ts`) writes it;
  the MCP server calls it per tool call.
- A mutation an agent makes is not given a second copy of that fact in its
  detail: its actor columns already name the agent client row
  (`principal.clientDbId`) and the owner, which is what `client.amend` shows.
  `request_id` stays a correlation, not evidence.
- `admin_access` cannot be taken out of a tenant's `audit_event_types` by the
  database's own check, so an agent read is always recorded.
- ADR 0050 holds the decision; ADR 0040 carries the amendment.

## Minting for an agent, and the exchange's two holes

- `mintAgentToken(tx, deps, input)` (`usecase/mint-agent-token.ts`, exported
  from `@odudu/protocol-oidc`) signs the admin-audience token the MCP layer
  acts with. It takes the owner's grant id and the presented MCP token's `exp`
  as `notAfter`, and writes nothing: no grant, no refresh token, no audit row.
  The token carries the owner's own `grant_id` and `sid`, so ending that grant
  or its session, disabling the agent client or the subject, or disabling the
  tenant ends it, because `authenticateAdmin` reads all of those from the
  grant. Refusals are `AgentTokenRefused` with a `reason`, never an answer.
- What it will sign: `aud` `[ADMIN_API_AUDIENCE, issuer]`, `sub` the owner,
  `act = { sub: <agent client_id> }`, `client_id` the agent, and a scope that
  is non-empty, only `mcp:read` and `mcp:write`, and a subset of the grant's
  (so `openid`, `offline_access` and an admin-wide scope are refused even when
  the grant holds them). It refuses an audience that is not the admin API's, an
  MCP token already ended, and a grant held by a client other than the named
  agent. Life is the lesser of `notAfter` and 300 s
  (`AGENT_TOKEN_MAX_TTL_SECONDS`), which is under the 600 s cap on `mcp:write`.
- It shares `mintSubjectAccessToken` with the exchange: claim context, role
  reach, the active key and `mintAccessToken` are one path, not two.
- Because the token shares its owner's grant, a token exchange that presents
  it would read the grant's scope, wider than the token's. The exchange now
  intersects the grant's scope with the presented token's own `scope` claim.
- Two per-client settings, migration 0119, both default off:
  `token_exchange_allowed_for_public` (a public client is refused the grant
  with `unauthorized_client`, before any token is read) and
  `token_exchange_actor_from_other_client` (an actor token issued to another
  client is refused, audited as `invalid_grant`, answered `invalid_request` like
  every actor refusal). They are client fields in the admin API (ETag, audit
  detail, tenant document with a default for older documents) and `seed client`
  flags. The audit allowlist now also lists `consent_required` and
  `token_exchange_impersonation_allowed`, which changed silently before. Neither
  is on for any built-in client.
- A narrowing exchange or refresh could turn an agent's token into an
  admin-audience token with no `act` and no MCP scope, which the admin API
  admits as the person. An exchange whose subject holds an MCP scope must keep
  one (else `invalid_scope`) and carries the subject's `act`, or the requesting
  client as `act`; a malformed `act` is refused; the refresh path refuses a
  narrowing that drops the last MCP scope the same way (`mcp_scope_dropped`).
- Console: the client page has a bespoke control for impersonation (a wording
  constant, a use-case value, a save group, a fixture); the two new settings
  have none yet, so they are API and CLI only.
- Volume: nothing here adds a query per request on the hot path. The mint
  reads a grant, a client, a tenant, a session and a subject by primary key
  and writes nothing; a tool call costs those five reads and one signature.
