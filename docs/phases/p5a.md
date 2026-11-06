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
- **Addresses.** An MCP URL is recognised by its path (`/mcp`), so a client
  registered at an address the tenant has since left is held to the tenant's
  current MCP URL while the policy is `mcp` (`audiencesHeld`, at `/authorize` and
  on refresh) and to none of the tenant's MCP URLs, old or new, once it is not.
- **No registration token.** Under `mcp` a presented token is not read: the client
  is stored `anonymous`, so the policy's rules and the per-sign-in consent apply to
  it, and the token is not spent. Rows already carrying origin `token` under the
  policy are unchanged.
- **The 429.** The budget names which limit refused (`address` or `tenant`) and the
  response says so.
- **mcp:write.** A client of those origins is refused `mcp:write` at
  `/authorize` (`refusesWriteScope`) even if an administrator assigned it,
  so the policy's ceiling holds for a row nobody at the tenant vetted.
- **Registration refuses more than the spec lists.** A `jwks`, a `jwks_uri` or
  a logout address is refused under `mcp`: a public client holds no key, and a
  logout address would have the server call or load an address chosen by an
  anonymous registrant.
- **Reaping.** `odudu reap` reports `dynamic_clients`: a public client of
  origin `anonymous`, enabled, older than a week
  (`UNUSED_DYNAMIC_CLIENT_SECONDS`), never approved (`clients.approved_at`, set when
  a consent is first recorded and never cleared, so withdrawing an approval does not
  make the client look unused; migration 0119, backfilled from `consents`), with no consent, no token grant (a grant is reaped by its own rule
  first, once past its retention, and only then can the client go) and
  no unexpired code and no unexpired pending sign-in naming it
  (`authentication_sessions.pending_request ->> 'clientId'`), is deleted; one with
  any of those is kept. It
  applies to every self-registered public client, not only those the `mcp`
  policy made. Served by `clients_anonymous_public_by_created` (migration 0118) with the existing `consents_by_client`, `token_grants_by_client` and
  `authorization_codes_by_client`; the plans suite covers the statement at
  volume (1,000 such clients in one tenant).
- **Settings.** `seed tenant --set`, the settings API, the console and the tenant
  export all take `mcp`; `registrationPolicySchema` accepts it so an export of such
  a tenant does not fail.

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
  filters find it. `recordAgentToolCall` (`usecase/access-audit.ts`) writes it.
  It is called by the MCP endpoint, which lands in Increment 8, and nothing
  calls it before. `route` must be an `ADMIN_ROUTES` key and `tool` an
  identifier of at most 64 characters from `[a-z0-9_.-]`; the detail allowlist
  rejects anything else, so text an agent chose cannot reach the trail.
- Attribution is proved against `mintAgentToken`: the owner's grant belongs to
  the named agent client, so `principal.clientDbId` is the agent client row and
  `act.sub` is its `client_id`; the int test mints through the real function.
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
- Two per-client settings, migration 0120, both default off:
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
- Console: the client page's Token exchange section shows both settings beside
  impersonation, saved together; wording lives in `services/tokenExchange.ts`.
- A token exchange is not bound to the client that holds the subject token, with
  the new settings off. RFC 8693 does not ask for it, and the resource server
  that exchanges the tokens of the client it serves is the grant's ordinary use
  (the `disableddoc-reader` of Path D), so binding would break it; the actor
  token is the credential of whoever acts, which is why that one is bound.
- Volume: nothing here adds a query per request on the hot path. The mint
  reads a grant, a client, a tenant, a session and a subject by primary key
  and writes nothing; a tool call costs those five reads and one signature.

## The tool catalogue

`packages/mcp` holds the tool model (`service/tool.ts`), the catalogue
(`service/catalogue.ts`: `TOOLS` and `NOT_TOOLS`) and the read tools
(`service/tools/*.ts`). `tests/lint/mcp-tool-coverage.test.ts` holds the
catalogue to the route table: each of the 152 `ADMIN_ROUTES` is exactly one of a
tool's route or a `NOT_TOOLS` entry with a reason, each tool's capability is its
route's, and a read tool's route is a GET. A new admin route fails it until placed.

| Tool                            | Route                                 | Capability      |
| ------------------------------- | ------------------------------------- | --------------- |
| `count_audit`                   | `GET …/audit/count`                   | view-audit      |
| `count_clients`                 | `GET …/clients/count`                 | manage-clients  |
| `count_groups`                  | `GET …/groups/count`                  | manage-tenant   |
| `count_roles`                   | `GET …/roles/count`                   | manage-tenant   |
| `count_scopes`                  | `GET …/scopes/count`                  | manage-tenant   |
| `count_sessions`                | `GET …/sessions/count`                | manage-sessions |
| `count_subjects`                | `GET …/subjects/count`                | view-users      |
| `get_client`                    | `GET …/clients/:id`                   | manage-clients  |
| `get_domain`                    | `GET …/domains/:id`                   | view-domains    |
| `get_group`                     | `GET …/groups/:id`                    | manage-tenant   |
| `get_role`                      | `GET …/roles/:id`                     | manage-tenant   |
| `get_scope`                     | `GET …/scopes/:id`                    | manage-tenant   |
| `get_settings`                  | `GET …/settings`                      | manage-tenant   |
| `get_subject`                   | `GET …/subjects/:id`                  | view-users      |
| `get_subject_lockout`           | `GET …/subjects/:id/lockout`          | view-users      |
| `list_audit`                    | `GET …/audit`                         | view-audit      |
| `list_client_logout_deliveries` | `GET …/clients/:id/logout-deliveries` | manage-clients  |
| `list_client_sessions`          | `GET …/clients/:id/sessions`          | manage-sessions |
| `list_clients`                  | `GET …/clients`                       | manage-clients  |
| `list_domains`                  | `GET …/domains`                       | view-domains    |
| `list_groups`                   | `GET …/groups`                        | manage-tenant   |
| `list_keys`                     | `GET …/keys`                          | manage-keys     |
| `list_mail`                     | `GET …/mail`                          | manage-tenant   |
| `list_roles`                    | `GET …/roles`                         | manage-tenant   |
| `list_scopes`                   | `GET …/scopes`                        | manage-tenant   |
| `list_sessions`                 | `GET …/sessions`                      | manage-sessions |
| `list_subject_consents`         | `GET …/subjects/:id/consents`         | view-users      |
| `list_subject_grants`           | `GET …/subjects/:id/grants`           | manage-sessions |
| `list_subject_sessions`         | `GET …/subjects/:id/sessions`         | manage-sessions |
| `list_subjects`                 | `GET …/subjects`                      | view-users      |
| `whoami`                        | `GET …/whoami`                        | none            |

- **Forty-two read tools, no write tool yet.** Lists answer one page under
  `MAX_LIMIT` (the input schema's `limit` has that maximum, so a larger one is refused
  before any call) with the cursor beside it as `next_cursor`; the admin API's `next`
  is the same value. Counts, gets and singletons answer one document.
- **Output is `{ data, next_cursor? }`.** All free text (names, descriptions, emails,
  audit detail) sits under `data`. Every string and every object key is stripped
  of control characters, bidirectional overrides and isolates (not the marks Persian
  and Arabic carry: `stripBidiControls`), and of invisible characters that hide text
  (tags, word joiner, BOM, soft hyphen, zero width space; ZWJ and ZWNJ stay), then cut
  to 1,000 characters (UTF-16 units). A cut sets `truncated: true` beside `data`. A
  whole result is capped at 256,000 bytes (`mcp:result_too_large`, which says to ask
  for fewer rows) and a problem's `detail` at 500 characters. Members named
  `client_secret`, `password`, `password_hash`, `secret_hash`, `private_jwk_encrypted`,
  and the private members of a JWK, are dropped from any open record by name: a second
  line, since the contracts keep none of them. The cursor is passed verbatim and never
  cleaned; one too long to pass back is refused. Each tool's description says the text
  is data, not instructions.
- **Schemas are the contract's.** Output schemas are the `@odudu/contracts/admin`
  response schemas; input filters are the shape of the route's own count or list query
  schema, so a filter the API gains reaches the tool. The route's server-side checks
  (a refinement the tool's schema drops, such as one search field at a time) still
  apply: the admin API answers 400 and the tool reports it.
- **A problem is an error result** carrying `type`, `title`, `status` and a capped
  `detail`; no stack, no `errors` array, no other body. A success the tool cannot read
  is `mcp:unexpected_response` without the body. Unexpected failures (the caller
  throwing) are not described: they reach the endpoint, which decides.
- **`AdminCaller`** takes `{ method, pattern, params, query, body? }` and answers
  `{ status, headers, body }`. The tenant is the caller's; `expandPattern` refuses a
  parameter named `tenant`, and an empty, `.` or `..` value (which a router would
  resolve), and encodes the rest as one path segment. There is no header field. A
  `body` is a JSON record a tool builds from its validated arguments, accepted only
  with PATCH, serialised by the caller under a fixed `content-type`, at most 64 KiB;
  a write tool declares its `bodyFields`, which the coverage test holds to the agent
  allowlist's fields for its route. The admin API's `agentBodyAdmitted` remains the
  gate.
- **Input schemas.** An id is a pattern-checked UUID, so the JSON schema a client
  lists says so; a limit has minimum 1 and maximum 200 and a cursor at most 1,024
  characters. `tools/list` is generated with `z.toJSONSchema` (the MCP SDK is not yet
  a dependency; check the SDK's own conversion when the endpoint lands).

Not tools (`NOT_TOOLS`, 110 routes). A reason is shared only within one family or
among writes, and the coverage test holds that:

- **Refused to agents** (`AGENT_DENIED_READS`, 3): tenant export, audit export, a
  theme asset's bytes.
- **Destructive** (8, deferred to P5b): tenant delete, end-all sessions, lockout
  clear (one subject, and all), and the four signing-key changes.
- **Descriptive writes** (2): `PATCH` of a client and of a scope; their tools are the
  write tools.
- **Every other write** (69): not an agent write; `mcp:write` admits only the
  descriptive fields of a client and a scope.
- **Reads, each with its own reason** (28): theme and mail previews (browser frames),
  theme, mail look and message wording (authored markup and page text, which the design
  spec's catalogue does not list and the console's Branding screens read), a subject's
  profile, credentials, registration tokens and the mail relay login (personal data or
  credential metadata), the tenant list and record (an agent acts in one tenant;
  `whoami` and `get_settings` cover the record), `clients/:id/evaluate` (it answers one
  subject's claims, personal data, under `manage-clients`, which does not include
  `view-users`), `installation` (restates `get_client`), `username-policy` (one setting
  `get_settings` returns), `passkey-impact` (an input to a change an agent cannot
  make), and scope `builtins` and `impact` (inputs to a restore and a delete an agent
  cannot make).

Eleven reads were added after review because the topic owns them: a subject's
effective roles, admin capabilities, roles, groups and required actions, a group's
roles, a role's composites, a scope's roles, mappers and clients, and the sign-in
flow's executions.

### The package's place (ADR 0051)

`mcp` sits above the protocol packages. Two dependency-cruiser rules name the
edges: `mcp-allowlist` (direct imports of kernel, contracts, `protocol-oidc` and
`protocol-admin` only) and `mcp-imported-only-by-server`. A bare-specifier import
is caught once the package resolves, which its `package.json` decides; one that does
not resolve is not seen, so declaring a dependency is the second gate.
`isDomainAddress` in the kernel replaced four hand comparisons of
`address.prefix === ''`.

## The in-process caller and the exchange

A tool call reaches the admin API as the owner's agent, on a bearer signed for
that call. `packages/mcp` holds the parts that decide; `apps/server/src/mcp-deps.ts`
holds the two that need a database or the app.

- `ValidatedMcpToken` (`service/validated-token.ts`) is what the MCP endpoint
  proves of a presented token: tenant (id and name), issuer, owner, the agent's
  `client_id`, the owner's `grant_id`, scope and `exp`. It is a branded type that
  only `validatedMcpToken(claims)` makes; the endpoint calls it after verification,
  with `exp` in seconds as the JWT carries it, and it holds an instant. The test
  constructor is `unverifiedTokenForTests` and is not exported. The endpoint must
  build it from the verified payload only, take `iss` only from the tenant's accepted
  set, and generate `requestId` itself, never copying an inbound `x-request-id`. The
  exchange and the caller only read it. `mintAgentToken` takes `expectedSubjectId`
  and refuses (`subject_mismatch`) a token whose `sub` is not its grant's owner. The tenant in every admin path is this
  one, never a tool's input (`expandPattern` refuses a `tenant` parameter).
- `exchangeForAdmin(deps, token, scope)` (`usecase/exchange.ts`) refuses a scope
  that is not an MCP scope or that the presented token does not hold, then calls
  `mintAgentToken` with the owner's grant, the token's client, the admin audience
  and `notAfter` = the token's `exp`. No `/token` request is made and no client
  authenticates. A refusal (`AgentTokenRefused`) becomes a `ToolProblem`
  `mcp:access_ended` (401) that names neither the reason nor a token; the reason
  goes to the debug log. Anything else rethrows, so an outage is not called a refusal.
- The bearer is cached in a `RequestScope` the endpoint creates per request
  (`newRequestScope`): a map keyed by grant and scope, dropped with the request.
  There is no module state and no cache across requests. A cached bearer that has
  expired is minted again.
- A GET uses `mcp:read`, or `mcp:write` for a token holding only that (the admin API
  admits a GET under either); a PATCH uses `mcp:write`. Each alone
  (`service/admin-access.ts`): the admin API's own `scopeAdmits` is the second line,
  and a read-scope token is refused a write by both.
- `createInProcessCaller` (`adapter/in-process-caller.ts`) is `fastify.inject` into
  the same app. The request is built from fixed parts: method, a path from the
  route pattern, the query, and four headers (`authorization`, `accept`,
  `x-request-id`, `host`), plus a fixed `content-type` when there is a body. A tool's
  input has no way to add a header or cookie; a body is built from validated
  arguments. Only `content-type`, `etag` and `retry-after` come back; the body is parsed
  JSON or null, and over 1 MiB is `mcp:result_too_large`. The admin API's 401 and
  403 are returned as the result, for `problemOf` to phrase; the bearer is in
  neither the log (debug: method, pattern, status) nor any message.
- The host is the deployment's (`ODUDU_PUBLIC_BASE_URL`), not the tenant's domain:
  a domain host rewrites a path under `/tenants/<name>`, where `/admin` does not
  live. Without a base URL it is the issuer's host.
- Layering: the adapter may not import the usecase, so the composition of the two
  (`adminCallerFor`) is in `apps/server/src/mcp-deps.ts` and is what the endpoint
  is handed. It is not under `modules/` because those are lifecycle modules with a
  `start` and `stop`; this has neither. `mcp` has no database import (ADR 0051), so
  `mintAgentToken` runs in the server's `McpDeps.mintAgentToken`: it reads the
  tenant's session lifespans and opens the tenant transaction.
- The issuer minted under is the presented token's own `iss`, which the endpoint
  accepted; the admin API accepts it from the tenant's accepted set.
- Proved in `apps/server/tests/mcp-admin-caller.int.test.ts` against real signing
  keys: the admin API sees the owner as `sub`, `act.sub` the agent and one scope;
  a role lost between two calls fails the second (also on a cached bearer); a revoked
  grant, ended session, disabled agent client and disabled tenant each fail the next
  call, as does a disabled subject (401 on a cached bearer, `mcp:access_ended` when it
  must mint); a token whose `sub` is not the grant owner is refused; a write-only
  token reads; the bearer
  lives at most 300 s and never past the token's `exp`; no cookie, a fixed header
  set; two concurrent requests of different owners keep their bearers apart; and an
  MCP token presented at `/token` by the public MCP client for the admin audience is
  `unauthorized_client`, and the same call succeeds once the operator switches the
  exchange on for the client, so the refusal is that setting. `act` is proved on the
  minted token; the admin API's own reading of `act` is proved in its tests.
- Without `ODUDU_PUBLIC_BASE_URL` the host of admin calls is the issuer's, which a
  proxy that rewrites the host would refuse; the server warns at start.
- Volume: a call adds six primary-key reads (the tenant by name, then the mint's grant, client, tenant, session and subject) of the mint once per request and
  scope (none on a cached bearer), and the admin API's own per-call checks.

## Closing pass reads

Sentences the closing pass has to revisit, because a placement or the roadmap
still states what an increment has since changed:

- `apps/docs/content/en/roadmap.md`, the P5a bullet: "The admin API has no
  `Idempotency-Key` header today, and P5a adds one". The header shipped in
  increment 6; `tests/docs/roadmap-section-11.test.ts` pins the sentence, so it
  moves with its mapping.
- The same bullet: "The server does not yet publish the metadata an MCP client
  looks for". The well-known documents are published; read it against what
  exists when the phase closes.
- ADR 0050 says the admin token is made by the RFC 8693 exchange; it is made directly
  by `mintAgentToken`. The amendment is written there; read it against the finished
  endpoint.
- `apps/docs/content/en/roadmap.md`, the P5a bullet "create a client's service account
  when its client credentials grant is switched on": the sentence now says what shipped;
  at close it moves to Shipped and out of Next with its mapping in
  `tests/docs/roadmap-section-11.test.ts`.

## Idempotency keys

- A keyed POST joins one transaction; `POST /admin/tenants` cannot (its domain
  service writes on the pool) and the routes that answer a secret shown once
  would have to store it, so both refuse the key (`idempotency-not-atomic`,
  `idempotency-unsupported`). Every other POST is held by a test that drives it
  with a key and fails if a write leaves the transaction.
- Keyed calls run at most `floor((pool - 1) / 2)` at a time, because each holds
  a connection and its handler may take a second (`callerCapabilities`). A call
  waits for a slot at most 10 s behind at most 100 others, then gets 503 with
  `Retry-After`; a pool of one carries none and refuses them. The two POSTs that
  wait on another server while they run (mail relay test, domain verification)
  refuse a key (`idempotency-external-io`), so a slow host cannot hold slots.
- A stored response is a copy of the 2xx response, subject data included, kept
  24 hours and deleted by `odudu reap`. Erasing a subject does not purge it:
  a record names no subject, so a purge would have to scan bodies. Stated in the
  CHANGELOG and the OpenAPI parameter.
- Non-database effects (the test mail) are not undone when the late capacity
  check or the size cap rolls a call back.

## Service accounts follow the grant

- **Where it is decided.** `needsServiceAccount(type, grant_types)` (protocol-oidc `service/`)
  is the one rule; every door that writes a client asks it (admin create, DCR, tenant
  import, both `seed client` paths) and `reconcileServiceAccount` in `amendClient` asks it
  after every `grant_types` write. `ensureServiceAccount` / `retireServiceAccount` are in
  protocol-oidc `usecase/service-account.ts` because the doors that need them are
  protocol-admin, protocol-oidc and the server, and domain-tenant may not see
  domain-identity. `clientRepository.setServiceSubject` is the only writer of the pointer.
- **Exactly once.** Both lock the client row `FOR UPDATE` first, so concurrent PATCHes
  queue and the second finds the account. The pointer is one column, so no unique index is
  needed; a test runs six transactions at once and counts the `service` subjects.
- **Retire deletes the subject; it does not disable it.** Every table naming a subject
  cascades (`token_grants`, `subject_roles`, `subject_groups`, `consents`, `sessions`, …) and
  `clients.service_subject_id` is `SET NULL`, so one `DELETE` removes the grants a leaked
  secret could have used, the roles that made them worth having and the sessions. A disabled
  subject would keep its roles for a later grant to inherit, and `authenticate-admin` already
  refuses a token whose grant row is gone. Cost: the account's history goes with it. An
  access token it already held is refused by Odudu at once (its grant is gone) rather than
  at expiry, and `GET /audit` no longer resolves `actor_name` for its past events (the
  `audit_events` actor id stays; no foreign key names it). Re-adding the grant makes a new
  subject with no roles, by test.
- **Last administrator.** A client's account can hold `tenant-admin`, so a write that retires
  it runs under `guardLastAdministrator`; the refusal is the existing `409`
  (`last-administrator`) and rolls the whole amendment back with it.
- **Audit.** No new action. `client.create` and `client.amend` already carry the
  `grant_types` diff; `service_subject_id` is added to the client allowlist so the account
  appearing or going is in the same row.
- **Migration 0122, in SQL.** The set is "idle accounts nothing names", which needs the
  referencing tables. They are read from `pg_constraint` (every foreign key to `subjects(id)`)
  plus `audit_events.actor_subject_id`, so a table added later is checked too. FORCE RLS is
  lifted only on `clients` and `client_oidc_config` (ACCESS EXCLUSIVE for the migration
  transaction, as 0114 did) to find candidates across tenants; every other table is read and
  deleted from under the candidate's own `app.tenant_id`, one tenant with an idle client at a
  time, so no other table is locked and each read is one tenant's rows. `SET LOCAL
row_security = off` was rejected: for an owner under FORCE it errors rather than bypasses.
  Cost at 10,000 tenants and 100M audit events: one pass over `clients` and
  `client_oidc_config` plus, per tenant holding an idle account, about a dozen reads of that
  tenant's rows (audit through `(tenant_id, actor_subject_id, ...)`); a large installation
  should expect the two locks to be held for the length of that loop. The check is not run
  against a non-superuser owner in the tests (the container's owner bypasses RLS).
  Kept accounts get `clients.service_account_idle` with a partial index, which the bounded
  boot warning reads. Not a command: the removal is the next `grant_types` write.
- **Import and export.** An export lists `service_account_roles` only for a client that
  holds the grant and names `clients[i].service_account_roles` under `omitted` where an idle
  account's roles are left out, so the document re-imports and re-exports equal. An import
  ignores roles a backup lists for a confidential client without the grant (refusing an old
  backup is worse than dropping roles nothing can use) and still refuses them for a public one.
- **Console.** Only copy: the Service account tab says a confidential client without the
  grant has no account and what creates one, the idle note says how an upgrade's leftover
  goes, and the grant's hint says on creates and off removes. No toggle logic changed.
- **Not done here.** The console e2e suite was not run for this increment.

### Fix round 1

- **Idle accounts keep their roles when the grant returns.** `ensureServiceAccount` clears
  `service_account_idle` for an account that stays, and the roles are active again. Kept
  deliberately: the account exists because something named it, its roles were an
  administrator's to give, and the console tab shows them before the grant is turned on;
  the docs say so. A retired account is different: it is gone, and nothing came back.
- **Lock order.** The administrators' advisory lock (`lockAdministrators`) comes before any row
  lock, the subject's included; `amendClient` takes it first when a grant change could retire
  an account, as `guardLastAdministrator` does for the delete, so the two cannot wait on each
  other. The first attempt took it after the ceiling check's subject lock and deadlocked
  (a 500) under a concurrent delete, which the test now catches.
- **Token race.** A `client_credentials` request that loses to a retirement hits the subject
  foreign key when it records its grant; that is now `unauthorized_client`.
- **Pure rules.** `mayRetireServiceAccount` and `retiresServiceAccount` are service functions.
- **Claims.** A token already issued stops being accepted where Odudu checks the grant row;
  a resource server checking the signature alone accepts it until `exp`. Past audit events
  keep the actor id and lose `actor_name`. Both are in the docs and CHANGELOG.

## The MCP endpoint

`POST /tenants/:tenant/mcp` (at `/mcp` on a tenant's own domain, which the host rewrite files
under the tenant) serves the 42 read tools. `GET` and `DELETE` answer 405 with `Allow: POST`.
Nothing is written yet: the catalogue holds reads only.

### The SDK, run

verified by running scratch servers and the endpoint's own int test, `@modelcontextprotocol/server`
2.4.0, `@modelcontextprotocol/node` 2.1.2 and, as a test dependency of `packages/mcp` and `apps/server`,
`@modelcontextprotocol/client` 2.4.0 (all published 2026-10-23, past the 1,440-minute floor, pinned
exact). `@modelcontextprotocol/fastify` is not used: its Host and Origin lists are static, and the
tenant's host is per request.

- **Both eras on one handler.** `createMcpHandler(factory, { legacy: 'stateless' })` answers a 2025-11-25
  `initialize` with no session id and a 2026-07-28 request, each from a fresh server built by the
  factory. The SDK's client reaches both through the same transport: `versionNegotiation: { mode:
'legacy' }` and `{ mode: { pin: '2026-07-28' } }`, both listing and calling in the int test.
- **`Mcp-Method`.** A 2026-07-28 request with the header missing, or naming another method than the
  body, is answered 400 with JSON-RPC `-32020` by the SDK (`data.mismatch` says which), before any
  of this layer runs. `server/discover` answers `supportedVersions: ["2026-07-28"]` and the `tools`
  capability.
- **Cache fields.** `McpServerOptions.cacheHints` sets `ttlMs` and `cacheScope` of `tools/list` and
  `server/discover`; the endpoint says 60,000 and `private`. A 2025 result has neither, by
  design of the SDK. Left out, the SDK says `ttlMs: 0`, `private`.
- **The SDK leaks a thrown message.** A tool callback that throws has its `Error.message` returned as
  the content of an `isError` result (`SECRET internal detail` came back verbatim). Every callback
  here runs through `callMcpTool`, which catches everything and answers a correlation id.
- **The SDK validates arguments before the callback.** With the tool's own schema it answers its own
  wording and the callback never runs, so no audit row. The endpoint lists a tool by the JSON Schema of
  its zod input and hands the SDK a validator that accepts anything, so the tool's schema is the one
  refusal, in the tool's wording, after which a row is written (`mcp:invalid_arguments`, `failed`).
  The listed schema carries `additionalProperties: false`, `maxLength` and the UUID pattern.
- **Batches.** The SDK serves a JSON-RPC batch, which would let one admitted request spend many
  budgets; the route refuses an array body with 400 `-32600`.
- **The handler verifies nothing and reads no `Authorization`.** The endpoint does not pass the token
  to the SDK at all (`authInfo` is optional): the factory closes over the validated principal, and the
  handler is built per request, so nothing is shared between two requests. `handler.close()` follows each.
- **Origin and Host are not the SDK's.** `toNodeHandler` does neither; the route does both from the
  tenant's address before anything is read.
- **No `outputSchema` is advertised.** The 42 response schemas would be sent in every `tools/list` and
  read into every model's context; the result is JSON text and `structuredContent` regardless.

### What a request does, in order

1. **Host** must be the host of the tenant's address (`hostAccepted`, port ignored, a strict
   hostname grammar so `evil@id.example` is not read as `id.example`), else 403. With no
   `ODUDU_PUBLIC_BASE_URL` the address is read off the request, so the check holds nothing there; a
   production deployment states one.
2. **Origin**, when present, must be the tenant's own origin whole, else 403; none passes.
3. **Tenant.** Unknown or disabled: an empty 404, as the metadata route answers, so nothing tells
   them apart and a disabled tenant's token is no longer answered 401.
4. **Token** (`validateMcpToken`): the `Authorization` header alone (no query, body or cookie). The
   tenant's keys verify it (`verifyTenantAccessToken`, the verifier the admin door reads with) for
   `typ` `at+jwt`, an issuer in `acceptedIssuers` and the audience the tenant's MCP URL exactly, no
   trailing slash and no other case; a token naming the admin audience beside it is refused, so no
   token serves both doors. Then `checkGrantLiveness`, the admin door's own read of grant, session,
   client and subject, now one function both call, and the grant's owner must be the token's `sub`.
   No token is 401 with `Bearer resource_metadata="<PRM>", scope="mcp:read"`; any other refusal
   is 401 with `error="invalid_token"` in front; a valid token with no MCP scope is 403
   `insufficient_scope`. A genuine token of another tenant (or of this one at an address it left)
   writes `token.foreign_issuer` and a token with no MCP scope writes `capability.refused`
   (`agent_without_mcp_scope`), as the admin door does; every other refusal is a log line.
5. **Budget** (`createToolLimiter`): 60 requests a minute per principal (subject and client), 600 a
   minute per tenant, four in flight per principal; past one, 429 with `Retry-After` and
   JSON-RPC `-32029`. Fixed windows, at most 10,000 principals and 10,000 tenants, the least recently
   used dropped first (so a throttled principal that keeps asking is not forgotten). Per process: with
   several instances the limit is multiplied, and a shared budget is P11's. Every request counts, not
   only a tool call, because a POST is one message once batches are refused. The slot is freed on the
   response's `close`, so a body refused with 413 frees it.
6. **Body** at most 256 KiB (Fastify's `bodyLimit`), JSON only.
7. **The SDK serves it.** `tools/list` lists the tools the token's scope admits (a read under either
   scope, a write under `mcp:write`) that the owner's capabilities could use; any other method registers
   them by scope alone, so a call to a tool the owner lost the capability for still reaches the admin
   API, is refused there, and leaves a `refused` row. Decision: a tool is **absent from the list**
   when the owner lacks its capability (the plan's Review Focus 7) and **present-and-refused at call
   time**. Cost: one `effective_roles` read per `tools/list` (not per call).

### Identity and audit

- The request id is generated here (`newId`) for every request and is the response's `x-request-id`,
  the audit rows' `request_id` and the one the admin call carries; an inbound header is never copied.
- `callMcpTool` writes exactly one `agent.tool_call` row per tool run: `allowed`, `refused` (403,
  `insufficient_scope` or `missing_capability`) or `failed`, with the tool and its route and no
  argument. A call whose row cannot be written has its data withheld (`mcp:audit_unavailable`).
  Not recorded: `tools/list`, `server/discover`, `initialize`, a call to a name that is no tool.
- The presented MCP token goes nowhere: the admin API gets the token `mintAgentToken` signs for the
  call, whose audience is the admin API, whose `sub` is the owner and `act` the agent client. The int
  test reads the `authorization` of every in-process admin request.

### Shared with the admin door, not copied

`authenticate-admin.ts` now exports `checkGrantLiveness`, `resolveForeignIssuer` (with the audience a
door expects), `unverifiedIssuer` and `verifyTenantAccessToken`; `index.ts` exports `adminAuthDeps`
(the reads, built once and used by the admin router and by the endpoint), `heldCapabilities` and the
audit writers. `@odudu/protocol-oidc` exports `extractBearerToken`.

### Volume (ADR 0041)

Per request: one tenant read (owner connection), the key read, the verification, up to five reads of
grant, session, client and subject, and one more `effective_roles` for a listing; per tool call the
five reads of the mint and one audit insert. The limiter holds at most 20,000 small records. Nothing
here is unbounded or scans a table.

### Not done, and where it goes

- A budget shared across instances, and a pre-authentication budget (a request with a garbage token
  costs the key read and a verification before it is refused): P11, as the other in-process limiters.
- `outputSchema` for the tools, and CORS for a browser client at another origin: the second is
  refused by design (Origin must be the tenant's own); neither is wanted by a target client.
- What hosted Claude, Claude Code and Cursor negotiate: the hand run of the closing increment.

### Fix round 1

- **Host without a base address.** With no `ODUDU_PUBLIC_BASE_URL` the tenant's address is read off the
  request, so comparing the two compared a header with itself (`Host: evil.example` with `Origin:
http://evil.example` was served). `hostAccepted`/`originAccepted` take whether the address is configured;
  when it is not, only `localhost`, `127.0.0.1` and `[::1]` (any port) pass, with the same 403 as any other
  refusal, so the two modes answer alike. A verified custom domain cannot arrive in that mode, since host
  resolution needs a base address too, so there is no domain host to accept. A trailing dot is read as the
  host without it.
- **Throttle before anything is read.** A per-origin budget (`DEFAULT_MCP_ORIGIN_THROTTLE`, 600 a minute,
  the existing `slidingWindow`, bounded by `MAX_THROTTLE_KEYS`) runs as an `onRequest` hook on the MCP
  route, ahead of the host check, so a burst of garbage tokens is `429` with no tenant, key or address read
  (the int test counts the address reads). Behind a proxy the origin is the proxy, so the figure is the
  deployment's traffic from it.
- **The limiter** now has a per-person budget beside the per-principal one (120 a minute across a person's
  clients, so ten registered clients do not spend the tenant's 600), and its windows are sliding (two fixed
  windows weighted), so a burst across a boundary is bounded by the limit: a test spends 60 at the end of a
  minute and is allowed at most two in the next two seconds. Caps: 100,000 principals, 50,000 people and
  10,000 tenants (three numbers each, about 160,000 small records); past a cap the least recently used key
  is dropped and starts afresh, and a key that keeps asking while refused counts as recent.
- **A tool called by name** that the token's scope does not admit now reaches the call path: the exchange
  refuses it before anything is sent to the admin API, the result is a 403 `insufficient_scope` and one
  `agent.tool_call` row says `refused`. Only a listing leaves tools out. Latent until a write tool exists;
  a unit test uses a fake write tool with a read token.
- **A deadline** of 20 seconds per tool call (`TOOL_DEADLINE_MS`): the call is answered `mcp:timeout`
  (504 class) and recorded failed; the admin call it started is not cancelled.
- **Tenant segment.** `%00`, an encoded slash, bytes that are not UTF-8, a lone surrogate and a name of
  5,000 characters are 400, 404 or 414 and never 500 (real Postgres): the segment is neutralised in the
  route's `onRequest`, ahead of the tenant read.
- **Layering.** The sequence of checks is `usecase/admit-mcp-request.ts`; the route maps its outcome.
- **One `extractBearerToken`** (protocol-oidc); the admin door's private copy is gone. It trims a header's
  trailing whitespace, which is not part of a credential.
- **Access log.** A hijacked reply skips `onResponse`, where Fastify logs a request as completed, so the
  route writes that line itself (statusCode and responseTime); a test holds it.
- **Cost per request** (a throwaway benchmark of 200 runs): building a server and registering the 42 tools
  takes 0.08 ms and converting the 42 schemas for a listing 1.2 ms, so nothing is cached.
- **The audit detail** carries an optional `reason` (`insufficient_scope`, `missing_capability`) beside
  `agent_client`, `owner`, `tool` and `route`: a category, never an argument.
- **How a client gets an MCP-audience token** (each kind run by the endpoint's int test with the real
  `/authorize`, login, consent and `/token`, except where said):
  - A client that registered itself under the tenant's `mcp` registration policy: the registration names
    `audience` (the tenant's MCP address, the only one allowed), `/authorize` and `/token` both carry
    `resource` set to it, the person consents to `mcp:read` (an optional scope on the screen), and the
    token's `aud` holds the MCP address and the issuer. Asking for `openid` alone still carries the audience
    but no MCP scope: `403 insufficient_scope`. The policy ending removes the audience at the next refresh
    (`aud` loses the MCP address and the scope loses `mcp:read`), and the endpoint answers `401`.
  - A client from a metadata document: given the audience and an optional `mcp:read` by the policy while it
    is `mcp` (not run through the endpoint here; covered by the oidc suite).
  - A client an administrator created: its `audiences` must hold the MCP address and `mcp:read` must be
    assigned to it; it sends `resource` (not run through the endpoint here).
  - An ordinary client (here the seeded `portal`): its token's `aud` is the tenant's address alone, `401`.
  - The built-in `odudu-mcp`: its audience is the admin API, so a request for the MCP address as `resource`
    is not served at `/authorize`; it is for local tools that call the admin API directly.
  - A machine (`client_credentials`) is not run against this endpoint.
- **Dependencies and release age** (floor 1,440 minutes, checked with `npm view <pkg> time` on 2026-11-06):
  `@modelcontextprotocol/server` 2.4.0 2026-10-23, `node` 2.1.2 2026-10-23, `client` 2.4.0 2026-10-23, `core`
  2.4.0 2026-10-23, `@hono/node-server` 2.1.6 2026-11-02, `hono` 4.13.16 2026-11-01, `eventsource-parser`
  3.1.1 2026-08-10, `eventsource` 3.0.7 2025-05-09, `pkce-challenge` 5.0.1 2025-11-23. All older than the floor.
