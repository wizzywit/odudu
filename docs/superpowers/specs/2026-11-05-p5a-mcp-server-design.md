# P5a — the MCP server, first release

Status: awaiting approval, 2026-11-05. Umbrella row: section 11 of
[the design spec](2026-09-10-odudu-design.md). Roadmap placement:
`apps/docs/content/en/roadmap.md`, "Next", P5a, and the Keycloak-model
service-account item under "Later". ADR 0042's 2026-10-16 amendment fixes that
the MCP server is open and that its destructive tools are P5b.

## 1. Intent

An administrator points Claude, Cursor or any MCP client at an Odudu instance
they run, signs in as themselves, and the agent can read and (narrowly) change
what that person may read and change. Every call is held to the same capability
ceiling as the console and the admin API (ADR 0040), and the audit trail says
that an agent acted, for whom, and through which client. The same release
documents how to protect any MCP server with Odudu as its authorization
server, written against a profile that passes against a real client.

The reason this phase carries the authorization work and not only the tools:
a downloaded instance is its own authorization server, so the instance URL has
to be enough. Today it publishes none of the metadata an MCP client looks for.

## 2. What the standards require (researched 2026-11-05)

Revision **2026-07-28** of the MCP specification is the target. Sources:
`modelcontextprotocol.io/specification/2026-07-28/{changelog,basic/authorization,basic/transports,server/tools,basic/security_best_practices}`
and the ext-auth repository. Findings that decide the design:

- **Stateless transport.** No `Mcp-Session-Id`, no `initialize`; each request
  carries `_meta` protocol version and capabilities; `server/discover` is
  mandatory; Streamable HTTP is POST-only with `Mcp-Method` and `Mcp-Name`
  headers and `Origin` validation; results carry `resultType`; `tools/list`
  must be deterministic and carries `ttlMs` and `cacheScope`.
- **Authorization is OAuth 2.1; the server is a resource server.** It MUST
  publish RFC 9728 protected-resource metadata and use a `WWW-Authenticate`
  `resource_metadata` challenge or the well-known URI; the authorization server
  MUST publish RFC 8414 or OIDC discovery with `code_challenge_methods_supported`;
  clients MUST send the RFC 8707 `resource` parameter; the server MUST reject
  a token not issued for it and MUST NOT pass any token through.
- **Client registration order:** pre-registered, then Client ID Metadata
  Documents (CIMD, an IETF draft), then Dynamic Client Registration, now
  deprecated but still what deployed clients use.
- **Scopes:** `scope` in the 401 challenge; 403 `insufficient_scope` for step-up.
- **stdio:** the spec says a stdio server SHOULD NOT use this flow and reads
  credentials from the environment.
- **Extensions:** `io.modelcontextprotocol/oauth-client-credentials` (stable;
  machine identity, `private_key_jwt` recommended, client pre-registered).
  Enterprise-managed authorization is out of scope (§3).
- **Industry pattern** (vendor documentation, secondary where noted): delegated
  browser OAuth by default, a separate token or agent key for headless use, a
  read-only switch that overrides an allowlist, server-side confirmation for
  irreversible actions, and almost nobody documenting "agent for user" audit.

`assumption:` deployed clients (Claude Desktop, Cursor) speak the 2026-07-28
revision, or the SDK serves an earlier one beside it. Settled by the first
spike (§9), not by reading.

## 3. Goals, non-goals, anti-goals

**Goals**

1. A tenant at `/tenants/{tenant}` (or its verified domain, ADR 0049) is a
   complete MCP authorization server: RFC 8414 metadata, `iss` on
   authorization responses (RFC 9207, already written), and a way for an MCP
   client to obtain a client id.
2. An MCP endpoint on the instance, `/tenants/{tenant}/mcp`, serving the tools
   below to a client signed in as an administrator.
3. A stdio command, `odudu mcp`, for local clients, serving the same tools.
4. The agent acts with the owner's capabilities cut down, never more.
5. Every call is an audit row naming the agent client and its owner.
6. Idempotent creates for an agent that retries (`Idempotency-Key`).
7. Passing the authorization profile against a real MCP client, and the guide.

**Non-goals.** The destructive tools (tenant delete, end-all sessions, lockout
clear, signing-key change) and the owner's out-of-band approval: P5b. Budgets,
attenuation settings, CIBA and a `may_act` mint: P5. Enterprise-managed
authorization: it needs an upstream identity provider Odudu does not have,
and rests on IETF drafts. Sampling, roots and elicitation: deprecated by the
revision. A built-in assistant (ADR 0042). A cross-tenant tool surface: a
tool acts on the one tenant its endpoint names.

**Anti-goals.** A path into the admin API that skips token validation. A
token forwarded from the MCP layer to the admin layer. A tool whose
behaviour depends on text it read (audit rows, names) rather than on what the
token carries. A write that the owner's token could not already make.

## 4. Approaches considered

|                | How                                                                                                                                                                                       | Trade                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A              | Module in the server; validates the MCP token, builds the admin principal itself, calls admin handlers in-process                                                                         | cheapest, no extra hop; but a new admin door that skips token validation, which ADR 0040 would have to be extended to prove                         |
| **B (chosen)** | Module in the server; MCP token (audience: the MCP endpoint) is exchanged with RFC 8693 into an admin-audience token carrying `act`, then the admin API is called with an ordinary bearer | admin authentication, ceiling and audit unchanged; nothing passed through; costs one in-process exchange per call, cacheable for a request          |
| C              | Separate package calling the admin API over HTTP                                                                                                                                          | works against a remote instance, but the HTTP form becomes its own deployment and its own resource server, losing "the instance URL is the MCP URL" |

Chosen: B for the HTTP endpoint and C's shape for stdio, behind one tool
catalogue and one `AdminCaller` interface with two adapters (in-process
`inject` for HTTP, `fetch` for stdio). Picked by the user on 2026-11-05.

## 5. Authentication, in both directions

**5.1 A person (the default).** Authorization code with PKCE, S256, the
`resource` parameter naming `…/tenants/{tenant}/mcp`. The access token has
that URL as its audience (`mcp:read`, `mcp:write` scopes). The MCP layer
validates it (signature, issuer, `aud`, expiry, grant not revoked), refuses any
token not for it, and for each tool call exchanges it for an admin-API token:
subject the owner, `act` the MCP client, scope narrowed per §6, lifetime the
shorter of the owner's token and a few minutes. `assumption:` the P4a exchange
accepts the MCP client as actor with no `may_act`, because nothing mints
`may_act` yet (`mayActPermits` permits an absent claim, per `docs/NEXT.md`),
and the exchange can be requested by the server's own internal client. Verified
by spike, not by reading.

**5.2 A machine.** `io.modelcontextprotocol/oauth-client-credentials`: an
administrator creates a client with the `client_credentials` grant, an
`private_key_jwt` key, and a role of its own on the tenant's admin client; the
agent obtains a token with `resource` and `scope` and calls the endpoint. The
token's subject is the client's service account; the audit actor is the
client. Its ceiling is the service account's roles, so it is only ever as
wide as the role the administrator gave it.

**5.3 Client ids.** The three sources, in the spec's order, all supported:

- Pre-registered: `odudu seed client` and the console already create them.
- **CIMD**: a `client_id` that is an HTTPS URL; the authorization server
  fetches and validates the document (redirect URIs matched exactly, the
  document's `client_id` equal to its URL), with SSRF protection and caching
  by HTTP headers. A tenant setting (`cimd_enabled`) turns it on; off by default.
  A resolved client is kept as an ordinary public client row
  (`registration_origin = 'cimd'`), rewritten from its document each time it is
  resolved, so the token endpoint, consent and userinfo need no second lookup.
  A response that says `no-store` is never cached, a client unused for thirty
  days is removed by `odudu reap`, and a tenant keeps at most 1,000. Its audience
  is the tenant's MCP policy, never the document's.
- **DCR**: the existing registration endpoint stays closed by default. A tenant
  registration policy for MCP clients is added: open registration limited to
  public clients, PKCE required, loopback and HTTPS redirects only, the
  `mcp:read` scope at most, rate-limited, and consent shown per client for
  every sign-in (the confused-deputy rule: a client id a person has not
  approved is never approved by a stale cookie).

Client research, 2026-11-05 (`docs/phases/p5a.md`): hosted Claude prefers CIMD
and uses it only when the metadata lists `client_id_metadata_document_supported:
true` and `none` among the token endpoint auth methods, else DCR; Claude Code
publishes a CIMD document with port-agnostic loopback redirect URIs; Cursor uses
DCR as a public client or a static client id and has no CIMD. So CIMD is a
documented, recommended setting for Claude users (off until a tenant turns it
on), and loopback redirect URIs match any port.

**5.4 stdio.** `odudu mcp --base-url … --tenant …` takes either a service
account key from the environment (5.2, headless) or runs a loopback browser
sign-in (5.1) as a public client the server registers per tenant, and keeps
the refresh token in the operating-system credential store, falling back to a
file readable only by the user. It calls the instance's admin API directly
with the exchange performed by the server's token endpoint, the same as 5.1.
No password is ever typed into the command.

**5.5 What every request does first.** TLS or loopback (the server already
refuses plain HTTP in production without `ODUDU_TLS`), `Origin` validation,
audience check, then the tenant in the path is the tenant in the token's
issuer. A token for another tenant is refused with the refusal audited
(ADR 0037, `capability.refused`).

## 6. Tools and the ceiling

- **Scope to what a call may do.** `mcp:read` admits only admin routes whose
  method is GET; `mcp:write` also admits the allowlisted reversible writes in
  the table below; the exchange always intersects with the owner's capabilities
  (`ADMIN_CAPABILITIES`: `view-users`, `manage-users`, `manage-clients`,
  `manage-tenant`, `manage-keys`, `manage-sessions`, `view-audit`,
  `view-domains`, `manage-domains`, `manage-tenants`). An agent therefore can
  never do what its owner cannot, and a read scope cannot write whatever the
  owner may.
- **Catalogue.** Reads: clients, scopes, roles, groups, subjects (list, get),
  settings, sessions, consents, grants, domains, keys (public metadata only),
  mail and logout-delivery status, lockout state, audit (list, count; export
  is not a tool), `whoami`. Reversible writes behind `mcp:write`: a scope's
  and a client's descriptive metadata (names, descriptions, display text).
  Nothing else writes in P5a.
- **Each tool declares the capability it needs**, its route key from
  `ADMIN_ROUTES` (145 routes today; `grep -c "pattern:" capability.ts`), and
  MCP annotations (`readOnlyHint`, `destructiveHint: false`, `idempotentHint`),
  which are hints only: nothing in the server relies on them.
- **The coverage test.** Every admin route is a tool or is named in a list of
  routes deliberately not tools, with a reason; every tool names a route that
  exists and a capability that the route requires; the test sits beside the
  console's coverage lint. A new admin route fails the build until placed.
- **Output.** A tool returns structured content with an `outputSchema` and the
  serialized JSON as text; errors are `isError` results carrying the admin
  API's problem type, never a stack. Lists are paged under the admin API's own
  bound (`MAX_LIMIT`, ADR 0041) and a tool never returns more than one page.

## 7. Prompt injection

Text an agent reads (audit detail, subject and client names, descriptions) can
carry instructions. The control is structural, not a filter: the token decides
what a call may do, and the writes it may do are a short allowlist with
schema-validated arguments. Tests: audit rows and names that contain
instructions to write, escalate or call another tool cannot produce a write
the token lacks; a `mcp:read` token cannot write by any argument; a write
argument outside the allowlist's schema is refused; tool results mark the
free text they return so a client can treat it as data. The guide says this
plainly and says what a client's own tool approval is for.

## 8. Other parts

- **Idempotency.** `Idempotency-Key` on admin POSTs and non-idempotent
  actions: stored per (tenant, key, route) for a bounded time; replay returns
  the stored response; the same key with a different request fingerprint is
  refused with 422; an in-flight duplicate is refused with 409; the table is
  bounded and reaped (a command first and a timer second, per CLAUDE.md); the
  MCP tools that call such routes set a key per call. ETag and `If-Match`
  stay the optimistic lock; a replayed successful ETag write answers by
  design.
- **Audit.** The admin principal reads `act` and every admin audit row
  records the agent client and the owner (a new `detail` field in the
  allowlist and a documented vocabulary entry). `request_id` stays a
  correlation, never evidence (ADR 0037's third amendment). `assumption:`
  today the principal ignores `act` (`authenticate-admin.ts` verifies
  signature, issuer and `ADMIN_API_AUDIENCE` only); confirmed by reading, to
  be re-checked by a failing test first.
- **Service accounts.** Created when a client's `client_credentials` grant is
  switched on, not for every confidential client, with a migration for the
  ones that exist and a test that a client that switches the grant off keeps
  no token path.
- **Metadata.** RFC 8414 at `/.well-known/oauth-authorization-server/tenants/{t}`,
  RFC 9728 at `/.well-known/oauth-protected-resource/tenants/{t}/mcp`, the
  `WWW-Authenticate` challenge from the MCP endpoint, `scopes_supported`,
  `code_challenge_methods_supported`, `authorization_response_iss_parameter_supported`,
  `client_id_metadata_document_supported` when CIMD is on, the extension's
  `token_endpoint_auth_methods_supported`. A tenant on a verified domain
  answers at its domain (ADR 0049).
- **Transport.** Official TypeScript SDK v2 (`@modelcontextprotocol/server`,
  stdio from `@modelcontextprotocol/server/stdio`; Fastify middleware package
  for HTTP). `assumption:` the SDK mounts on this server's Fastify with this
  server's tenant routing; spiked in §9. The endpoint holds no session state,
  per the revision.
- **Where it lives.** `packages/mcp` (tools, the caller interface, the
  coverage test, the stdio entry), mounted by `apps/server`; the CLI command in
  the help registry. Layering per CLAUDE.md; it imports no protocol package it
  does not need, and it never imports the database.
- **Performance and scale (ADR 0041).** One exchange per call, cached for the
  life of the request; reads bounded to a page; idempotency storage bounded by
  key count per tenant and by age; `tools/list` static and cacheable
  (`ttlMs`); CIMD fetches bounded by size, time and per-host rate, cached; an
  agent budget is P5's.
- **Documentation owned** (CLAUDE.md's list): the guide "Protect an MCP server
  with Odudu"; the Claude and Cursor setup pages, each run against a real
  client; a transcript for each new route, re-run on a live stack; the
  reference for the CLI command and every new `ODUDU_*` setting; the
  `concepts/tokens` and `consent-and-audit` pages; the console's settings page and
  screenshot for the CIMD and MCP-registration control (§10);
  `CHANGELOG.md`; the landing page's "Planned" MCP item turned into a shipped
  one; `tests/docs/questions.md`'s "Planned (P5a)" line; the roadmap, section
  11 and `docs/NEXT.md` reconciled in both directions.

## 9. Order and exit

First a spike, because three claims are about libraries and about this
repository's exchange: (1) which protocol revisions the SDK v2 serves and
which the target clients speak; (2) the SDK on this Fastify and tenant
routing; (3) the P4a exchange doing 5.1 with no `may_act`. Then increments,
each mergeable and green: metadata and CIMD/DCR policy; idempotency; audit
attribution and service-account narrowing; `packages/mcp` read tools and the
coverage test; the write tools and prompt-injection tests; stdio; conformance
and the guides.

**Exit.** The authorization profile passes against a real client (the MCP
Inspector in CI, and Claude and Cursor by hand, recorded in a phase note);
the coverage test, the injection tests and the idempotency tests pass;
a client that sends the wrong audience, a foreign tenant's token or a read
token to a write tool is refused and audited; the documents and the closing
pass in CLAUDE.md are done.

## 10. Settled by the builder check, left to the builder, and open

Settled from the repository (each one grepped on 2026-11-05):

- **Audiences.** The token endpoint already honours RFC 8707 `resource`, but
  `parseResource` accepts only a value in the client's registered
  `audiences` (`packages/protocol-oidc/src/service/resource-indicator.ts`).
  So the MCP URL is a registered audience of each MCP client: written when a
  client is created through the MCP registration policy (5.3) or seeded, and
  added by hand for a pre-registered one. The tenant's canonical address
  (ADR 0049) is the one form accepted; a client sending another form is
  refused `invalid_target`.
- **Primitives that exist.** `private_key_jwt` client authentication
  (`private-key-jwt-authentication.ts`), a service account per confidential
  client (`serviceSubjectId`) and a tenant `client_registration_policy`
  column (default `disabled`) are in place. The service-account change narrows
  the existing mechanism; it adds no subject kind. A consent gate keyed on the
  client already exists (`decideConsentGate`); P5a extends it for 5.3, it does
  not add one.
- **Where the ceiling is enforced (my call).** In the admin token, not only in
  the MCP layer. The exchanged token carries the scope; `authenticate-admin`
  reads the scope and the agent client, and the principal admits a call only
  if the owner's capability holds **and** the scope admits the route (GET for
  `mcp:read`; the allowlisted writes for `mcp:write`). The MCP layer's own
  check is a second line, never the only one. This is the audit-attribution
  increment's work and the ADR 0040 amendment's subject.
- **Who requests the exchange (my call).** The MCP layer calls the token
  usecase in-process, with the MCP client as actor; it is not a request to the
  public `/token` endpoint. A test proves a public client presenting an MCP
  token at `/token` cannot mint an admin-audience token. For stdio there is no
  MCP endpoint in the path: `odudu mcp` is a public client registered for the
  tenant with the admin API as its audience and a scope of `mcp:read` or
  `mcp:write`; the token is issued directly, and attribution is the token's
  client and subject. So `act` is the agent marker on the HTTP path and the
  token's client is the marker on the stdio path; the principal reads either.
- **Idempotency scope.** Every admin POST and non-idempotent action, as
  section 11 states, whether or not a P5a tool calls it: the criterion is the
  admin API's, and an agent client is not the only caller that retries.
- **Loopback (my call).** Derived from the request's host being a loopback
  address, never a setting, and never in production (`NODE_ENV=production`
  already requires `ODUDU_TLS`); so no new `ODUDU_*` variable.
- **If the spike finds clients on the older revision.** Serve both revisions
  if the SDK does. If a target client speaks only a revision the SDK does not
  serve, the phase stops and the owner is asked; it does not reintroduce
  sessions by hand.
- **CI against a real client (assumption).** The MCP Inspector's command-line
  mode run headless against a started server in the `conformance` job's shape,
  with a pre-registered client and DCR, not CIMD (a CIMD fetch target on
  localhost is what the SSRF guard refuses). Claude and Cursor are run by
  hand and recorded in the phase note. If the Inspector cannot run headless
  the spike says so and the exit criterion names the hand run instead.

Left to the builder: tool names and descriptions; the `_meta` handling the SDK
does not do; the bounded lifetime and size of the idempotency table; the
credential-store library for stdio.

Client reach (research, 2026-11-05): claude.ai and Desktop connectors call from
Anthropic's servers and need a public HTTPS URL, so a downloaded instance on a
laptop is reached by them only through a tunnel; Claude Code and Cursor connect
to `http://localhost` directly; Claude Desktop's local route is `odudu mcp` as a
stdio server. No target client uses the client-credentials extension, so the
machine route serves custom clients, scripts and `odudu mcp`. Hosted Claude and
Cursor speak the `initialize` era, so the endpoint serves it statelessly beside
2026-07-28.

Decided by the owner (2026-11-05): the CIMD and MCP-registration settings get
one control on the existing settings screen, with its console page and
screenshot (`pnpm docs:screenshots`), not a new area.

## 11. Gap audit, 2026-11-05

Every placement of P5a was read in the roadmap, section 11's row, `docs/NEXT.md`,
`tests/docs/questions.md`, ADR 0042 and the roadmap-reasoning note, then
checked against sections 1 to 10. Each row is a gap that the first draft had
and what now closes it.

| Gap                                                                                                                          | Closed by                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 11 says a write needs a **short-lived** token; §5 only bounded the exchanged one                                     | An `mcp:write` access token lives at most 10 minutes (a tenant setting may only lower it), is never issued with a refresh token, and a client holding `mcp:write` must re-authorize; `mcp:read` follows the tenant's normal lifetime. Tested.                                                                                                                         |
| Section 11: every call recorded as an agent for its owner, but `/introspect` and `/userinfo` reads write no row (a decision) | A deliberate, documented exception for agents only: one row per tool call, a new `agent.tool_call` action under `admin_access` carrying tool, route, outcome, agent client and owner, and no argument text. Bounded by the audit retention window; its volume is stated in ADR 0041's terms. The decision list says why agents differ from a resource server's reads. |
| The stdio public client was "registered per tenant" with no owner                                                            | A built-in `odudu-mcp` client created with every tenant like `odudu-admin`, backfilled for existing tenants by migration, in the tenant export and import document (`tenant-document.ts`), with the two new settings. Round-trip tested.                                                                                                                              |
| The roadmap's "Later" line gives **client registration policies** to P13, which P5a's MCP policy overlaps                    | P5a adds only a narrow MCP policy (§5.3); P13 keeps general policies. The roadmap line and section 11's P5a row say so, and CIMD, the stdio sign-in and the built-in client are added to both, with their `roadmap-section-11.test.ts` mappings.                                                                                                                      |
| Open decision: scope is not coherent with audience (RFC 9068 §2.2.3), placed on P9                                           | `mcp:read` and `mcp:write` are meaningful only at the MCP and admin audiences and refused elsewhere; the row stays on P9 and the reading note records that P5a adds two scopes that are coherent by construction.                                                                                                                                                     |
| A revoked grant, a disabled tenant, a removed role or an owner's ended session                                               | Honoured on the next call, because every call re-validates the token and re-exchanges; one test each. An owner can revoke an agent client's grant through the existing grants route and the console.                                                                                                                                                                  |
| MCP spec: servers MUST rate limit tool calls                                                                                 | A per-principal, in-process limiter in the shape of the existing ones, its bound stated and its one-instance limit named against P11.                                                                                                                                                                                                                                 |
| Clause-level conformance for RFCs the repository implements                                                                  | Reading notes with clause tables under `docs/protocols/` for RFC 9728, RFC 8414, the CIMD draft and the MCP authorization sections, each clause mapped to a test, so the gap recorded for RFC 7523 is not repeated.                                                                                                                                                   |
| Every repository method probed with a foreign `tenant_id`; query plans                                                       | The idempotency table and any CIMD cache table get the foreign-tenant probe, row-level security, an index for each read and an entry in the `query-plans` job.                                                                                                                                                                                                        |
| New routes and the endpoint's documentation                                                                                  | The well-known routes and the MCP endpoint are in the endpoints reference (`tests/docs/endpoints.test.ts`) and each has a transcript re-run on a live stack, the MCP one as `server/discover` and `tools/list` calls; the OpenAPI document gains the `Idempotency-Key` header.                                                                                        |
| Documents the closing pass reads                                                                                             | `README.md`'s feature list, `tests/docs/questions.md` D22, the landing page's planned MCP item, `CHANGELOG.md`, the roadmap's three P5a placements, section 11, `docs/NEXT.md`'s next-phase order and a new ADR (token exchange for MCP, the ceiling in the admin token, CIMD) plus an ADR 0040 amendment.                                                            |
| Prompt-injection and boundary tests                                                                                          | Included in §7 and §9; the coverage test fails on a new admin route until it is a tool or named as not one.                                                                                                                                                                                                                                                           |

Left standing on purpose, each named against the phase that owns it: the
destructive tools and out-of-band approval (P5b), budgets, CIBA and `may_act`
minting (P5), enterprise-managed authorization (no phase; it needs an upstream
identity provider, recorded as a non-goal on the roadmap's "Decided against"),
and `/introspect` narrowing (P9).
