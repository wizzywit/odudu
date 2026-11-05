# P5a — the MCP server, first release: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant is a complete MCP authorization server and serves the admin API as read-only-by-default tools to an agent, over Streamable HTTP on the instance and over stdio, with every call held to its owner's capabilities and audited.

**Architecture:** `packages/mcp` holds one tool catalogue over an `AdminCaller` interface with two adapters (in-process for the HTTP endpoint, `fetch` for stdio). The HTTP endpoint validates an MCP-audience token, then exchanges it in-process for an admin-audience token carrying `act`; the admin API enforces scope and capability itself and records the agent.

**Tech Stack:** TypeScript on Node 24, Fastify 5, Drizzle, Zod 4, Vitest, Testcontainers PostgreSQL, the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), React console.

**Spec:** [2026-11-05-p5a-mcp-server-design.md](../specs/2026-11-05-p5a-mcp-server-design.md). Read it and `CLAUDE.md` first; section numbers below (§) are the spec's.

## Global Constraints

Copied from `CLAUDE.md` and the spec; every task includes them.

- Target MCP revision **2026-07-28** (stateless: no `Mcp-Session-Id`, no `initialize`, `server/discover` mandatory, `Mcp-Method`/`Mcp-Name` headers, `Origin` validated). The server never reintroduces sessions by hand (§10).
- A token not issued for the MCP endpoint is refused; no token is ever forwarded (§2, §3 anti-goals).
- `mcp:write` access token: at most 10 minutes, no refresh token (§11). `mcp:read` follows the tenant's lifetime.
- Scopes `mcp:read` and `mcp:write` exist only at the MCP and admin audiences (§11).
- No `any`, no `void doThing()`, no inline `eslint-disable` (`tests/lint/no-any.test.ts`). Tests precede implementation; integration tests use real PostgreSQL; every repository method is probed with a foreign `tenant_id`; `SET LOCAL` for tenant context.
- Comments carry only what code cannot say, blocks of at most eight lines, **no reference to this plan, a task, a step or a phase slot** (`tests/lint/comment-block-length.test.ts`). Quote this in every dispatch.
- Console imports carry no `.ts`/`.tsx`; console use cases and repositories hold no logic (rules, wording, mapping and formatting are pure `services`); reuse scan reported per task (CLAUDE.md "Reuse before writing").
- Every user-facing string on a server page is a catalogue entry (`tests/lint/server-page-literals.test.ts`); a tenant's address comes from `TenantAddress` (`tests/lint/tenant-address.test.ts`).
- Performance and scale (ADR 0041): 1,000,000 subjects, 10,000 clients, 10,000 tenants, 100,000,000 audit events. Each increment states its bound.
- Implementers and reviewers run on Sonnet 5.5; Opus only with the owner's approval. No `git stash`. Heavy jobs (docker, e2e, integration suites) go through the heavy-slot lock. Commit messages: subject ≤72, body ≤8 lines, no attribution trailer; the PR description carries none either.
- Work on branch `p5a/mcp-server`; one PR per increment into it; draft PR opened with the first push; CI green and the review answered before the next increment (CLAUDE.md "CI runs on the branch").
- The next free migration number is taken at execution time: `ls packages/db/drizzle | tail -1` (0112 on 2026-11-05).

## Review Focus

Inputs the spec implies and no single task's happy path exercises; each has a test in the owning task.

1. A token for another tenant, another audience, another issuer form (path versus verified domain) or another resource URL spelling (trailing slash, uppercase host): refused, audited, never accepted (I1, I5, I8).
2. A read token whose arguments name a write, or whose tool is called by name though absent from `tools/list` (I8, I9).
3. Audit text and names that contain instructions: no write the token lacks follows from them, and a write the token does hold needs the caller's own decision, which the guide says plainly (I9).
4. A retried POST with the same key and a changed body, the same key in flight twice, and a key from another tenant (I6).
5. A CIMD document whose URL redirects, resolves to a private address, is oversized, slow, or whose `client_id` differs from its URL (I3).
6. The owner's role removed, grant revoked, session ended or tenant disabled between two calls: the next call fails (I8).
7. `tools/list` for a token lacking a capability: the tool is absent, not present-and-failing (I8).
8. stdio with a missing, expired or foreign-issuer credential: a clear refusal on stderr and nothing on stdout but JSON-RPC (I10).

## File Structure

| Path                                                                                                                                                               | Responsibility                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mcp/` (new)                                                                                                                                              | tools, `AdminCaller`, coverage test, HTTP handler, stdio entry; layers `view usecase repository adapter service` as the server packages; no database import |
| `packages/protocol-oidc/src/view/routes/{as-metadata,resource-metadata}.ts`                                                                                        | RFC 8414 and RFC 9728 routes                                                                                                                                |
| `packages/protocol-oidc/src/service/{client-id-metadata,mcp-scopes}.ts`, `…/adapter/client-metadata-fetch.ts`                                                      | CIMD validation and the bounded fetch; the two scope definitions                                                                                            |
| `packages/protocol-admin/src/usecase/authenticate-admin.ts`, `…/service/{agent-scope,idempotency}.ts`, `…/view/routes/router.ts`                                   | principal reads scope and agent; route admission; idempotency                                                                                               |
| `packages/domain-tenant/src/usecase/provision-mcp-client.ts`                                                                                                       | the built-in `odudu-mcp` client, beside `provision-admin-client.ts`                                                                                         |
| `packages/db/drizzle/NNNN_*.sql`, `packages/db/src/schema/*`                                                                                                       | settings columns, idempotency table, CIMD cache, backfill                                                                                                   |
| `apps/server/src/cli/mcp.ts` + registry entry                                                                                                                      | `odudu mcp`                                                                                                                                                 |
| `apps/admin-console/src/pages/settings/…`                                                                                                                          | the one control                                                                                                                                             |
| reading notes for RFC 8414, RFC 9728, the CIMD draft and the MCP authorization sections under `docs/protocols/`, a new ADR under `docs/adr/`, `docs/phases/p5a.md` | notes, decisions, record                                                                                                                                    |

---

## Increment 0 — Spike (code discarded; the record `docs/phases/p5a.md` is merged)

Tasks 0.1 and 0.2 are done and recorded there: SDK 2.4.0 serves 2026-07-28 and a stateless 2025-11-25 era and mounts on Fastify 5; the exchange works in-process but needs Task 5.4. Task 0.3's client questions are answered below.

Settles every `assumption:` on a load-bearing path. Throwaway code lives in the scratchpad; the result is `docs/phases/p5a.md`'s first section, merged alone.

### Task 0.1: SDK and revisions

**Interfaces:** Produces: a recorded answer to "which protocol revisions does SDK v2 serve, and does it mount on Fastify 5 under `/tenants/:tenant/mcp` with this server's tenant routing".

- [ ] **Step 1:** `npm view @modelcontextprotocol/server version time` and `npm view @modelcontextprotocol/fastify version`; record the exact versions. (assumption: both exist and are older than the 1440-minute release-age floor in `pnpm-workspace.yaml`.)
- [ ] **Step 2:** In the scratchpad, mount `McpServer` with one `echo` tool on a bare Fastify route; call it with `curl` using the 2026-07-28 headers, then with a 2025-11-25 `initialize`; record which succeed.
- [ ] **Step 3:** Record whether the SDK's Host/Origin validation can be given the tenant's accepted hosts (verified: `git grep -n "hostRules\|host-rules" apps/server/src | head`).

### Task 0.2: The exchange without `may_act`

**Interfaces:** Produces: yes/no for "the token usecase can mint an admin-audience token for owner `S` with `act = {sub: <mcp client>}` and a narrowed scope, called in-process, with no `may_act` anywhere".

- [ ] **Step 1:** Write an integration test in the scratchpad against `apps/server`'s harness that calls the token usecase through `TOKEN_EXCHANGE_GRANT` (verified: `packages/protocol-oidc/src/usecase/token-issuance.ts:280`) from a client holding `odudu-admin` as an audience; assert `act.sub`, `aud`, `scope`.
- [ ] **Step 2:** Record whether `mayActPermits` permits (verified read: `packages/protocol-oidc/src/service/token-exchange.ts`; the comment says it permits an absent claim) and whether a public client can reach the same path through `/token` (it must not, §10).

### Task 0.3: A real client

**Interfaces:** Produces: which of DCR, CIMD, pre-registration Claude Desktop and Cursor use; which MCP revision each speaks; whether `@modelcontextprotocol/inspector` CLI runs headless against a local server.

- [ ] **Step 1:** Run `npx @modelcontextprotocol/inspector --cli` against the scratch server; record the invocation that lists tools.
- [ ] **Step 2 (done by research, 2026-11-05; recorded in `docs/phases/p5a.md`):** hosted Claude and Cursor use the `initialize` era, Claude Code v2 can speak 2026-07-28; Claude prefers CIMD, Cursor uses DCR or a static id and has no CIMD; no target client uses the client-credentials extension. A hand test against a scratch server could show nothing more without the real authorization server, so what stays unknown (the DCR request bodies, any `iss` validation, Cursor's revision) is captured by the transcripts of Increment 4 and the hand run in Task 11.1.
- [ ] **Step 3: Gate (passed).** No target client needs a revision the SDK does not serve. Commit `docs/phases/p5a.md` and open the draft PR.

---

## Increment 1 — Metadata and challenges

Exit: a stranger's MCP client can discover the tenant as an authorization server and the MCP endpoint as a protected resource.

### Task 1.1: RFC 8414 authorization-server metadata

**Files:** Create `packages/protocol-oidc/src/view/routes/as-metadata.ts`, `…/usecase/as-metadata.ts`; modify `packages/protocol-oidc/src/index.ts` (registration beside `registerDiscoveryRoute`, verified: line 90). Test `…/usecase/as-metadata.test.ts`, `apps/server/tests/as-metadata.int.test.ts`.

**Interfaces:** Produces `resolveAsMetadata(deps, tenantName, address): Promise<AsMetadata | null>` reusing the discovery usecase's inputs; route `GET /.well-known/oauth-authorization-server/tenants/:tenant` and, for a tenant at a verified domain, `GET /.well-known/oauth-authorization-server` on that host (ADR 0049).

- [ ] **Step 1: Failing tests:** the document's `issuer` equals the tenant's canonical issuer; includes `code_challenge_methods_supported: ["S256"]`, `authorization_response_iss_parameter_supported: true`, `token_endpoint_auth_methods_supported` containing `none` and `private_key_jwt` (Claude uses CIMD only when `none` is listed beside `client_id_metadata_document_supported: true`), `scopes_supported` containing `mcp:read` and `mcp:write`; `registration_endpoint` present only while the policy allows it; `client_id_metadata_document_supported` absent until I3; a disabled or unknown tenant is 404 with no body difference between the two; the path-form and the domain-form answer with their own issuer.
- [ ] **Step 2:** Run `pnpm --filter @odudu/protocol-oidc test -- as-metadata`; expect FAIL.
- [ ] **Step 3:** Implement by projecting the existing discovery document, so the two cannot drift; a test asserts the shared fields equal.
- [ ] **Step 4:** Run the same command and the int test; expect PASS.
- [ ] **Step 5:** Reading note for RFC 8414 under `docs/protocols/` with a clause table, each clause mapped to a test (as `rfc8707.md`); transcript under `reference/transcripts/` re-run on a live stack; `tests/docs/endpoints.test.ts` green. Commit.

### Task 1.2: RFC 9728 protected-resource metadata and the challenge

**Files:** Create `packages/protocol-oidc/src/view/routes/resource-metadata.ts`, `packages/mcp/src/service/challenge.ts` (the package skeleton arrives here: `package.json`, `tsconfig.json`, `index.ts`, copied from `protocol-admin`'s shape, verified: `cat packages/protocol-admin/tsconfig.json`). Test beside each.

**Interfaces:** Produces `GET /.well-known/oauth-protected-resource/tenants/:tenant/mcp` (and, on a verified-domain host, `GET /.well-known/oauth-protected-resource/mcp`) returning `{resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ["header"]}`; `challengeFor(address, scope): string` returning `Bearer resource_metadata="…", scope="…"` and `insufficientScope(address, scopes): string`.

- [ ] **Step 1: Failing tests:** `resource` is the canonical MCP URL without a trailing slash; the metadata's `authorization_servers` entry equals the issuer in I1.1; `challengeFor` for `mcp:read` matches the spec's example form; `insufficientScope` carries `error="insufficient_scope"`.
- [ ] **Step 2:** Run to fail; **Step 3:** implement; **Step 4:** run to pass.
- [ ] **Step 5:** the reading note for RFC 9728 under `docs/protocols/`, transcript, endpoints reference. Commit; push; open the increment's PR; CI green; answer the review.

---

## Increment 2 — Scopes, the built-in client, short-lived write tokens

### Task 2.1: The two scopes and their audiences

**Files:** Create `packages/protocol-oidc/src/service/mcp-scopes.ts`; modify the scope seeding for new tenants and a migration that backfills existing tenants (verified: how the built-in scopes are created: `git grep -n "restore-scopes\|BUILT_IN_SCOPES" -- apps/server/src packages | head`). Tests `mcp-scopes.test.ts`, `packages/db/tests/mcp-scopes-backfill.int.test.ts`.

**Interfaces:** Produces `MCP_READ_SCOPE = 'mcp:read'`, `MCP_WRITE_SCOPE = 'mcp:write'`, `scopeAllowedAt(scope, audience, mcpAudience, adminAudience): boolean`.

- [ ] **Step 1: Failing tests:** both scopes are refused at any audience other than the MCP URL and `ADMIN_API_AUDIENCE`; `restore-scopes` recreates them; the backfill is idempotent; a foreign tenant's scope rows are untouched.
- [ ] **Steps 2–5:** run to fail, implement, run to pass, commit. Add the note to `docs/protocols/rfc9068.md` that these two are coherent with `aud` by construction (the open row stays on P9).

### Task 2.2: `odudu-mcp` built-in client

**Files:** Create `packages/domain-tenant/src/usecase/provision-mcp-client.ts` (shape of `provision-admin-client.ts`, verified: `sed -n 60,100p` of it), `…/service/mcp-client.ts` (`MCP_CLIENT_ID = 'odudu-mcp'`); modify tenant creation and `packages/contracts/src/admin/tenant-document.ts`; migration backfilling existing tenants. Tests beside, plus a tenant export/import round-trip in `apps/server/tests/`.

**Interfaces:** Produces `provisionMcpClient(tx, tenantId): Promise<ClientRecord>`; the client is public, loopback redirect URIs `http://127.0.0.1` and `http://[::1]` any port, PKCE required, audience `ADMIN_API_AUDIENCE`, scopes `mcp:read` (default) and `mcp:write` (optional).

- [ ] **Step 1: Failing tests:** created with a new tenant; a second call is a no-op; a client already named `odudu-mcp` that is not this one is refused (as the admin client's does); export then import reproduces it; the foreign-tenant probe.
- [ ] **Steps 2–5:** run to fail, implement, run to pass, commit.

### Task 2.3: Write tokens are short-lived and unrefreshable

**Files:** modify `packages/protocol-oidc/src/usecase/token-issuance.ts` at the lifetime and refresh decisions (verified: `git grep -n "access_token_ttl\|refreshToken" -- packages/protocol-oidc/src/usecase/token-issuance.ts | head`). Test beside.

**Interfaces:** Produces `capLifetimeForScope(ttlSeconds, scope): number` in `service/`, returning `min(ttl, 600)` when `mcp:write` is present, and a rule that no refresh token is issued then.

- [ ] **Step 1: Failing tests:** a grant with `mcp:write` gets `expires_in ≤ 600` and no `refresh_token`; with `mcp:read` only it follows the tenant; a refresh that would widen to `mcp:write` is refused; `offline_access` alongside `mcp:write` is ignored (the token is issued with no refresh token and no error), because Claude appends `offline_access` whenever the server lists it.
- [ ] **Steps 2–5**; push the increment's PR; CI green; review answered.

---

## Increment 3 — Client ID Metadata Documents

### Task 3.1: Validation as pure functions

**Files:** Create `packages/protocol-oidc/src/service/client-id-metadata.ts`, test beside.

**Interfaces:** Produces `isCimdClientId(raw: string): boolean` (HTTPS URL with a non-root path, no fragment, no credentials); `parseCimdDocument(clientIdUrl: string, body: unknown): { kind: 'ok'; client: CimdClient } | { kind: 'invalid'; reason: CimdRefusal }` requiring `client_id` equal to the URL exactly, `client_name`, `redirect_uris` (HTTPS or loopback only; a loopback `http://localhost/…` or `http://127.0.0.1/…` entry matches any port, RFC 8252 §7.3, which Claude Code's document relies on), refusing `client_secret*`, symmetric auth methods and `jwks` that are not public.

- [ ] **Step 1: Failing tests:** each refusal; accepted minimal document; a localhost redirect is flagged `loopback: true`; a loopback redirect on a different port than the document's still matches, a different path does not; the consent page shows the `client_id` URL's host, not only `client_name`.
- [ ] **Steps 2–5.** Commit.

### Task 3.2: The bounded fetch

**Files:** Create `packages/protocol-oidc/src/adapter/client-metadata-fetch.ts`; a cache table via migration with RLS and the foreign-tenant probe; tests `client-metadata-fetch.test.ts` (against a local test server) and an int test for the cache. Consumes the existing address guard (verified: `git grep -n "isPrivateAddress\|remote-address" -- packages/protocol-oidc/src/service | head -3`, reuse it; do not write a second one).

**Interfaces:** Produces `fetchCimdDocument(url, deps): Promise<{ kind: 'ok'; body: unknown; expiresAt: Date } | { kind: 'refused'; reason: 'private_address' | 'redirect' | 'too_large' | 'timeout' | 'not_json' | 'status' }>`: HTTPS only, no redirects followed, 5 KiB cap, 3 s deadline, DNS pinned between check and connect, cached per `Cache-Control`: a `no-store` or `max-age=0` response is never stored, a response with no freshness directive is cached for one hour, and no entry lives longer than 24 hours, at most N cached rows per tenant (state N; reaped by `odudu reap`).

- [ ] **Step 1: Failing tests** for each refusal in Review Focus 5, including a hostname that resolves to `169.254.169.254` and an IPv4-mapped IPv6 address.
- [ ] **Steps 2–5.** Reuse scan reported: the existing outbound transports (`client-key-transport.ts`, `logout-delivery-transport.ts`) are candidates; say what was reused or why not, and note their DNS-deadline gap is P11's, not copied.

### Task 3.3: Wire into `/authorize`, `/token` and the metadata

**Files:** resolve a CIMD `client_id` at `/authorize` into a persistent public client row (`registration_origin = 'cimd'`, upserted on each resolution, removed by `odudu reap` after thirty days unused, at most 1,000 per tenant (at the ceiling the least recently used client with no consent, usable refresh token or live code is evicted, else the new one is refused), a no-store response never cached) when the tenant setting `cimd_enabled` is on (migration 0116 adds the column, default false), and have `/token` treat such a client as unknown while the setting is off; modify I1.1 to emit `client_id_metadata_document_supported`. Tests: int tests through the real endpoints.

- [ ] **Step 1: Failing tests:** off → a URL `client_id` is `invalid_client` exactly as an unknown client, and a refresh for an existing CIMD grant is refused; a CIMD row is created once under two concurrent first authorizations; its redirect list follows a changed document; a disabled row is refused; the reaper removes an unused row with no live grant and keeps one with a live grant; the foreign-tenant probe on the upsert; on → authorize reaches consent showing the client name and every redirect URI; a redirect URI not in the document is refused; the issued token's audience still needs the MCP URL registered, so a CIMD client gets it by the MCP policy (I4), not by the document.
- [ ] **Steps 2–5.** the reading note for the CIMD draft under `docs/protocols/`. Push; CI; review.

---

## Increment 4 — The MCP registration policy and the console control

### Task 4.1: Policy and consent

**Files:** modify `client_registration_policy` handling (verified: column in `packages/db/src/schema/tenants.ts:65`; values read in `packages/protocol-oidc/src/repository/tenant-lookup.ts:41`) to add the value `mcp`: open registration restricted per §5.3 (public clients, PKCE, loopback/HTTPS redirects, `mcp:read` at most, MCP URL as the only audience, rate-limited, ceiling `max_clients`); extend `decideConsentGate` so a dynamically registered or CIMD client is always shown consent for each sign-in until the person approves that exact client id, never satisfied by another client's approval. Tests: unit for the gate, int for registration.

**Interfaces:** Produces the policy value `'mcp'`; `registerMcpClient(deps, tenant, metadata)` in `usecase/`.

- [ ] **Step 1: Failing tests:** `mcp` policy refuses a confidential client, a non-loopback `http` redirect, `mcp:write`, an audience other than the MCP URL, and the 201st client; approving client A grants nothing to client B with the same name and a different id.
- [ ] **Steps 2–5.**

### Task 4.2: Admin API fields

**Files:** the tenant settings schema in `packages/contracts/src/admin/` and the `amendSettings` path; `audit-detail.ts` allowlist entries for the two fields (verified allowlist shape: `packages/protocol-admin/src/service/audit-detail.ts`); `odudu seed tenant --set` keys (verified: `seed.ts`); transcripts and the OpenAPI document regenerate. Tests: `admin-paths.test.ts`, `seed.int.test.ts`, the ETag round-trip.

- [ ] **Step 1: Failing tests:** `PATCH` settings with `cimd_enabled` and `client_registration_policy: "mcp"` round-trips with `If-Match`; an invalid value is a 422 problem; the audit row names both fields as values.
- [ ] **Steps 2–5.**

### Task 4.3: One control on the Settings screen

**Files:** `apps/admin-console/src/pages/settings/` (five layers, wording constants in `services`, no logic in the use case); `apps/docs/content/en/admin-console/settings.md`, `tour.mdx`; `pnpm docs:screenshots`. Tests: component test, `console-areas.test.ts`, `console-labels.test.ts`, the screenshot job.

- [ ] **Step 1: Failing tests:** the control shows the two values, saves with `If-Match`, rebases on a 412, and joins the unsaved-changes guard; its wording comes from the page's wording constants.
- [ ] **Steps 2–5.** Reuse scan against the existing registration-policy control on this page. Push the increment's PR; CI; review.

---

## Increment 5 — The ceiling and the agent, in the admin token

### Task 5.1: The principal reads scope and agent

**Files:** modify `packages/protocol-admin/src/usecase/authenticate-admin.ts` (the verified read: it checks signature, issuer, `ADMIN_API_AUDIENCE`, `typ`, grant liveness; it ignores `scope` and `act`) and `AdminPrincipal`. Tests: extend `authenticate-admin.test.ts` first.

**Interfaces:** Produces `AdminPrincipal.agent?: { clientId: string; ownerSubjectId: string }` and `AdminPrincipal.scopes: readonly string[]`; agent is set when the token carries `act.sub` or when `client_id` is the tenant's `odudu-mcp` client or any client holding an MCP scope. An agent token that carries no MCP scope is refused at the admin API, so an `act` token minted with a non-MCP scope can never keep the owner's full capabilities.

- [ ] **Step 1: Failing tests:** a token with `act` yields `agent`; an `mcp:*` token from `odudu-mcp` yields `agent` with no `act`; an ordinary console token yields none; a token with `mcp:read` for the wrong tenant is refused as today.
- [ ] **Steps 2–5.**

### Task 5.2: Route admission by scope

**Files:** create `packages/protocol-admin/src/service/agent-scope.ts`; modify the router's authorize step (`router.ts`, `authorize-admin.ts`). Tests: `agent-scope.test.ts` and a table test over every entry of `ADMIN_ROUTES` (verified count: `grep -c "pattern:" capability.ts` = 145).

**Interfaces:** Produces `scopeAdmits(scopes: readonly string[], route: AdminRoute): boolean` (read scope: `method === 'GET'` only; write scope: GET plus `AGENT_WRITE_ROUTES`, an exported allowlist of the descriptive-metadata PATCH routes for a scope and a client) and `agentWritableFields(route): readonly string[]` (the body fields an agent write may carry: names, descriptions and localized text only; the PATCH of a client also accepts `enabled`, `redirect_uris` and more for an ordinary caller, so admission is by field, not by route: any other field in an agent's body is refused 403 `insufficient_scope`); requests that carry neither an MCP scope nor an agent marker are unaffected.

- [ ] **Step 1: Failing tests:** for every route, `mcp:read` admits exactly the GETs; `mcp:write` admits exactly GETs plus the allowlist; a console token (no MCP scope, no agent) admits as before; an agent token with no MCP scope is refused; an `mcp:write` PATCH of a client carrying `enabled` or `redirect_uris` is refused and one carrying only descriptive fields succeeds (and the same for a scope); the owner's missing capability still refuses (both gates must pass); a refusal records `capability.refused` with the agent.
- [ ] **Steps 2–5.**

### Task 5.3: Audit attribution and the decision records

**Files:** `packages/domain-audit/src/service/vocabulary.ts` (new action `agent.tool_call` under `admin_access`, verified shape lines 9–15), `vocabulary-docs.ts`, `audit-detail.ts`; a new ADR ("the MCP server acts through an exchanged token", next free number under `docs/adr/`) and an ADR 0040 amendment; `docs/NEXT.md`'s decision list entry for agent reads being audited. Tests: `audit-vocabulary-coverage.test.ts`, `vocabulary-docs.test.ts`, int test that an admin mutation by an agent writes `detail` with `agent_client` and `owner`, and no argument text.

- [ ] **Step 1: Failing tests** as above; **Steps 2–5.** Push the increment's PR; CI; review.

### Task 5.4: The exchange is not open to a public client, and the server can mint for an agent in-process

Found by the spike (`docs/phases/p5a.md`): a public client granted the exchange reaches it at `/token` with any valid actor token, and `issueTokens` is not exported.

**Files:** modify `packages/protocol-oidc/src/usecase/token-issuance.ts` (the exchange branch, verified: `issueExchangedTokens` near line 950, grant gate near 1301), add `packages/protocol-oidc/src/usecase/mint-agent-token.ts`, export it from `packages/protocol-oidc/src/index.ts`; migration for two client columns; contracts, audit allowlist, `seed client` flags, console client page. Tests beside, plus an int test through `/token`.

**Interfaces:** Produces `mintAgentToken(tx, deps, input: { subjectGrantId: string; agentClientId: string; audience: string; scope: readonly string[]; notAfter: Date; now: Date }): Promise<{ accessToken: string; expiresAt: Date }>`: takes an already-validated owner grant and the presented MCP token's `exp` as `notAfter`, sets `act = { sub: agentClientId }`, requires `scope ⊆` the grant's scope, `exp ≤ min(notAfter, now + a few minutes)` (a grant stores no per-token expiry, so the cap must be passed in), refuses a revoked grant, ended session, disabled client or tenant. It is not a `/token` request and performs no client authentication, because its only caller is the MCP layer after it has validated the MCP-audience token.

- [ ] **Step 1: Failing tests:** `mintAgentToken` returns `act.sub` = the agent client and a narrowed scope; a widened scope, a revoked grant, an ended session, a disabled client are refused; a public client with the exchange grant is refused at `/token` with `unauthorized_client` unless a new per-client setting `tokenExchangeAllowedForPublic` is on (default off); an `actor_token` whose grant belongs to another client is `invalid_grant` unless the new per-client setting `tokenExchangeActorFromOtherClient` is on (default off, and on for no built-in client); both settings round-trip through the admin API and appear in the audit allowlist.
- [ ] **Steps 2–5:** run to fail, implement, run to pass, commit. Reuse scan: `issueExchangedTokens`'s claim-building is extracted and shared, not copied.

---

## Increment 6 — Idempotency-Key

### Task 6.1: Storage and the usecase

**Files:** migration creating `idempotency_keys(tenant_id, key, route, fingerprint, status, response_status, response_body, created_at, expires_at)` with RLS, a unique index `(tenant_id, key, route)` and an index on `expires_at`; `packages/protocol-admin/src/repository/idempotency.ts`, `…/service/idempotency.ts`, `…/usecase/idempotent.ts`; `reap` gains a pass (command first, timer second: ADR 0024; verified pair to copy: `apps/server/src/cli/reap.ts` and `scheduler.ts`). Tests: unit, int with the foreign-tenant probe, `query-plans` entry.

**Interfaces:** Produces `withIdempotency(tx, input: { tenantId; key; route; fingerprint; now }, run): Promise<Stored | Fresh>`; `fingerprintOf(method, path, body): string` (SHA-256 of canonical JSON); window 24 hours; at most 10,000 live keys per tenant (then 429 `idempotency_capacity`); response body cap 64 KiB: the row is written in the same transaction as the mutation, and a response larger than the cap rolls that transaction back and answers 422 `idempotency_response_too_large`, so nothing ran, no row exists and a retry without a key behaves as before; a replay can never lie.

- [ ] **Step 1: Failing tests:** first call runs; replay answers the stored status and body; same key different fingerprint → 422; in-flight duplicate → 409 (two concurrent calls in one test); another tenant's identical key is independent; expired key runs again; a failed (5xx) first call stores nothing; a replayed successful `If-Match` write is answered by design.
- [ ] **Steps 2–5.**

### Task 6.2: The routes and the docs

**Files:** the router applies `Idempotency-Key` to every admin POST and non-idempotent action (list derived from `ADMIN_ROUTES` method, not hand-kept); OpenAPI parameter; transcript re-run showing a replay; the API guide's retry section; `roadmap-section-11` mapping unchanged (already placed). Test: a table test that every POST route accepts the header and a test that a PUT/PATCH/DELETE ignores it. Push; CI; review.

---

## Increment 7 — Service accounts only where `client_credentials` is on

### Task 7.1

**Files:** find where a confidential client's service account is created (verified entry: `git grep -n "serviceSubjectId" -- packages/db/src apps/server/src | head`); change creation to happen when the grant is switched on and its removal behaviour when it is switched off; a migration deciding existing clients (keep accounts for clients with the grant; mark the rest for the reaper only if no token or role references them, else keep); docs (`admin-console/clients`, `concepts/tokens`, CHANGELOG _Changed_). Tests: unit and int (including the foreign-tenant probe).

**Interfaces:** Produces `ensureServiceAccount(tx, client)` / `retireServiceAccount(tx, client)` in `usecase/`.

- [ ] **Step 1: Failing tests:** a confidential client without `client_credentials` has none; adding the grant creates one exactly once; removing the grant stops `client_credentials` from issuing and leaves no bearer path; no existing token path changes for clients that use it; the migration is idempotent.
- [ ] **Steps 2–5.** Push the increment's PR; CI; review.

---

## Increment 8 — `packages/mcp`: caller, catalogue, read tools, endpoint

### Task 8.1: The tool model and the coverage test

**Files:** `packages/mcp/src/service/tool.ts`, `…/service/catalogue.ts`, `tests/lint/mcp-tool-coverage.test.ts` (beside `console-covers-admin-routes.test.ts`).

**Interfaces:** Produces

```ts
interface McpTool<I, O> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string; // "<METHOD> <pattern>", an ADMIN_ROUTES entry
  readonly capability: AdminCapability; // from @odudu/contracts/admin
  readonly access: 'read' | 'write';
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly run: (caller: AdminCaller, input: I) => Promise<O>;
}
interface AdminCaller {
  call(req: AdminRequestSpec): Promise<AdminResult>;
}
```

and `NOT_TOOLS: Record<routeKey, reason>`.

- [ ] **Step 1: Failing tests:** every `ADMIN_ROUTES` entry is exactly one of a tool's `routeKey` or a `NOT_TOOLS` key; each tool's `capability` equals the route's required capability; every `access: 'write'` tool's route is in `AGENT_WRITE_ROUTES` (the reverse, that every `AGENT_WRITE_ROUTES` entry has a write tool, is asserted in Task 9.1 when the write tools exist); tool names are unique, match `[A-Za-z0-9_.-]{1,128}`, and sorted deterministically.
- [ ] **Steps 2–5.** The destructive routes (tenant delete, end-all sessions, lockout clear, signing-key change) go in `NOT_TOOLS` with "P5b".

### Task 8.2: Read tools

**Files:** `packages/mcp/src/service/tools/*.ts` for clients, scopes, roles, groups, subjects, settings, sessions, consents, grants, domains, key metadata, mail and logout-delivery status, lockout state, audit list and count, `whoami`.

- [ ] **Step 1: Failing tests** per tool family against a fake `AdminCaller`: arguments validated and bounded (`limit ≤ MAX_LIMIT`, verified `git grep -n "MAX_LIMIT" -- packages/protocol-admin/src | head -2`), a page returned with its cursor, output validates against `output`, problem responses become `isError` results carrying the problem type and no stack, free text is returned inside a field the tool description marks as data.
- [ ] **Steps 2–5.**

### Task 8.3: The in-process caller and the exchange

**Files:** `packages/mcp/src/adapter/in-process-caller.ts`, `…/usecase/exchange.ts`; the server module in `apps/server/src/modules/` that supplies the token usecase and `fastify.inject` (the console gateway's shape: `packages/console-gateway/src/adapter/odudu-client.ts:85`).

**Interfaces:** Consumes `mintAgentToken` (Task 5.4). Produces `createInProcessCaller(deps, mcpToken: ValidatedMcpToken): AdminCaller`; `exchangeForAdmin(deps, token, scope): Promise<{ bearer: string; expiresAt: Date }>` (a call to `mintAgentToken`, not a `/token` request) cached for one request only.

- [ ] **Step 1: Failing int tests:** the admin API sees `act`, owner subject, narrowed scope; an MCP token presented at `/token` by a public client cannot mint an admin token (Review Focus, §10); the owner losing a role between two calls fails the second; a revoked grant, ended session or disabled tenant fails the next call.
- [ ] **Steps 2–5.**

### Task 8.4: The endpoint

**Files:** `packages/mcp/src/view/routes/mcp.ts` (mounted in `apps/server` at `/tenants/:tenant/mcp` and on a verified domain), `…/usecase/validate-mcp-token.ts`, `…/service/rate-limit.ts`. Uses `@modelcontextprotocol/server` 2.4.0 with `@modelcontextprotocol/node` 2.1.2: `createMcpHandler(factory, { legacy: 'stateless' })` mounted with `reply.hijack()` and `toNodeHandler`; the principal is passed as `req.raw.auth`; Host and Origin hooks are built per request from the tenant's accepted hosts (Odudu does the 401 challenge in its own `onRequest`). The handler is built with `legacy: 'stateless'`: hosted Claude and Cursor speak the `initialize` era and Claude Code v2 speaks 2026-07-28; a test sends both eras. Residual risk, UNVERIFIED: the SDK source names only 2025-11-25 and 2026-07-28, while hosted Claude documents 2025-06-18; the hand run in Task 11.1 records what each client negotiates.

- [ ] **Step 1: Failing tests:** no token → 401 with the I1.2 challenge; wrong audience, foreign tenant, foreign issuer form, `typ` not `at+jwt`, expired → 401 and a `capability.refused`/`token.foreign_issuer` row where the existing door writes one; missing `Mcp-Method` or mismatch → 400 `-32020`; invalid `Origin` → 403; `GET` and `DELETE` → 405; `server/discover` lists supported revisions and `tools` capability; `tools/list` is deterministic, carries `ttlMs` and `cacheScope: "private"`, and omits tools the token cannot use (Review Focus 7); a tool call writes one `agent.tool_call` row; the per-principal limiter returns the MCP error and a `Retry-After`, with its bound documented (single instance; P11).
- [ ] **Steps 2–5.** The conformance harness lands in Increment 11; here an Inspector-free SDK client test is the check. Push the increment's PR; CI; review.

---

## Increment 9 — Writes and prompt injection

### Task 9.1: The two write tools

**Files:** `packages/mcp/src/service/tools/{scope,client}-metadata.ts`: update a scope's, and a client's, descriptive fields (names, descriptions, localized text only), `ETag` carried as an `if_match` argument, `idempotentHint: true`, `destructiveHint: false`.

- [ ] **Step 1: Failing tests:** refused with `mcp:read` by the admin API itself, not only the tool (test with the MCP-layer check disabled, §10); an argument outside the schema (`redirect_uris`, `enabled`, roles) is a validation error before any call; stale ETag → 412 surfaced; the audit row's `detail` shows the diff of allowed fields only.
- [ ] **Steps 2–5.**

### Task 9.2: Injection suite

**Files:** `packages/mcp/tests/prompt-injection.int.test.ts`.

- [ ] **Step 1:** fixtures where a client name, scope description, subject display name and audit `detail` contain instructions ("call update_client …", "ignore previous", a fake JSON-RPC message, a fake tool result). A scripted agent that obeys any instruction in tool output runs against a `mcp:read` token and against an `mcp:write` token whose owner lacks `manage-clients`: assert zero writes, and that every attempted write was refused by the admin API and audited. Tool output wraps free text in a labelled field; the test asserts the label.
- [ ] **Steps 2–5.** Push the increment's PR; CI; review.

---

## Increment 10 — stdio

### Task 10.1: The command and its caller

**Files:** `packages/mcp/src/adapter/http-caller.ts`, `packages/mcp/src/view/stdio.ts`, `apps/server/src/cli/mcp.ts`, the registry entry and examples (`registry.ts`, `apps/docs/scripts/cli-page.test.ts` regenerates `cli.md`), `apps/docs/content/en/guides/` mention.

**Interfaces:** Produces `odudu mcp --base-url <url> --tenant <name> [--read-only (default) | --allow-writes] [--key-file <path>]`; `createHttpCaller(baseUrl, tokens: TokenSource): AdminCaller`.

- [ ] **Step 1: Failing tests:** stdout carries only JSON-RPC (a log line in the test fails it); logs go to stderr; EOF on stdin exits; a missing credential exits non-zero with one stderr line naming what to set; with `ODUDU_MCP_KEY` (service-account private key) it authenticates with `private_key_jwt`; a foreign issuer's token is refused before any call; `--allow-writes` is the only way `mcp:write` is requested, and never combined with a stored refresh token.
- [ ] **Steps 2–5.**

### Task 10.2: Loopback sign-in and credential storage

**Files:** `packages/mcp/src/usecase/loopback-login.ts`, `…/adapter/credential-store.ts`.

**Interfaces:** Produces `loopbackLogin(deps): Promise<TokenSet>` (authorization code with PKCE S256 as `odudu-mcp`, `resource` and `state` set, `iss` validated per the spec's table before the code is redeemed, a listener on `127.0.0.1` or `[::1]` that accepts one request and closes); `CredentialStore { get; put; clear }` with an OS-keychain adapter and a user-only-readable file fallback (mode 0600, refused if wider).

- [ ] **Step 1: Failing tests:** a response with a wrong `iss` is never redeemed and its `error` text is not printed; `state` mismatch refused; the listener rejects a second request; the stored file mode is checked; clear removes both.
- [ ] **Step 2:** choose the keychain library (builder's call, §10); record its licence against `LICENSING.md` and its release age against `minimumReleaseAge`.
- [ ] **Steps 3–5.** Push the increment's PR; CI; review.

---

## Increment 11 — Conformance, guides and the closing pass

### Task 11.1: The real-client run in CI

**Files:** `infra/conformance/run-mcp.sh`, a job beside `conformance` in `.github/workflows/verify.yml`, `gate` updated (ADR 0044; verified layout: `grep -n "conformance" -A8 .github/workflows/verify.yml`), `tests/lint/` workflow-shape tests updated.

- [ ] **Step 1:** the script starts the stack, pre-registers a client, runs the Inspector CLI through discovery, DCR under the `mcp` policy, PKCE, the `resource` parameter, a 401 challenge, a `tools/list`, a read call, a refused write; non-zero on any miss. If the spike found the Inspector cannot run headless, the script is the SDK client and the hand run in `docs/phases/p5a.md` carries the exit criterion, said plainly.
- [ ] **Steps 2–3:** run locally through the heavy-slot lock; run in CI; make `gate` wait for it.

### Task 11.2: Guides, pages and transcripts

**Files:** `apps/docs/content/en/guides/protect-an-mcp-server.md` (runnable blocks, run by `tools/docs-run`), `guides/connect-claude.md` (Claude Code against an instance on `http://localhost`; Claude Desktop through `odudu mcp` in `claude_desktop_config.json`; claude.ai and Desktop connectors need a public HTTPS URL reachable from Anthropic's servers, so a downloaded instance needs a tunnel, said plainly), `guides/connect-cursor.md` (DCR under the `mcp` policy, or a static client id in `mcp.json`), each written from the hand runs with exact versions; a page saying no target client uses the client-credentials extension yet, so the machine route is for custom clients, scripts and `odudu mcp`, `concepts/{tokens,consent-and-audit}.md`, transcripts for the well-known routes and the endpoint, `reference` pages regenerate.

- [ ] **Step 1:** every fenced command block runs or is tagged `text`; a transcript block carries no language tag (CLAUDE.md); transcripts are re-run on a live stack and name the stack; `guides-runnable`, `transcripts`, `concepts`, `links`, `endpoints` tests green.

### Task 11.3: The closing pass (CLAUDE.md, six items)

- [ ] **Step 1:** roadmap's "What is not implemented" markers re-read for truth; `git grep -n -E '\bP5a\b|planned|MCP' -- apps/docs README.md tests/docs docs/NEXT.md` and every hit made true: landing page's planned MCP item turned into a shipped one (`plannedClaims.ts`, its tests), `README.md`'s feature list, `tests/docs/questions.md` D22, `roadmap.md` (three P5a placements move to "built"; the P13 "client registration policies" line says P5a took only the MCP policy), section 11's row gains CIMD, the stdio sign-in and the built-in client, `roadmap-section-11.test.ts` mappings added both ways, `docs/NEXT.md` (headings against closed phases, next-phase order, the new decision row).
- [ ] **Step 2:** `CHANGELOG.md` under `## [Unreleased]`: _Added_ (MCP endpoint, `odudu mcp`, CIMD, `Idempotency-Key`, the two scopes), _Changed_ (service accounts only with `client_credentials`; agent calls audited), _Security_ (write tokens ten minutes, per-client consent for dynamic clients).
- [ ] **Step 3:** whole-branch review (spec compliance and quality, Sonnet), fix loop to clean; `docs/phases/p5a.md` completed with what building found; `git mv` the spec and plan to `docs/archive/`; `pnpm verify` green; finish via `superpowers:finishing-a-development-branch` (the merge into `main` is the owner's approval).

---

## Self-Review

- **Spec coverage:** §5.1 → I2, I5, I8.3; §5.2 → I7 and the service-account path tested in I8.4/I11.1; §5.3 → I3, I4; §5.4 → I10; §5.5 → I8.4; §6 catalogue and coverage test → I8.1–8.2, writes → I9.1; §7 → I9.2; §8 idempotency → I6, audit → I5.3, service accounts → I7, metadata → I1, transport → I0, I8.4, performance → each task's stated bound (idempotency caps, CIMD cache cap and size, limiter), documents → I11; §10 answers → I0, I5, I8.3; §11 rows → short-lived tokens I2.3, per-call audit I5.3 and I8.4, built-in client I2.2, P13 overlap I11.3, scope/audience I2.1, revocation I8.3, rate limit I8.4, reading notes I1, I3, probes and plans I3.2 and I6.1, route docs I1 and I11.2.
- **Step scan:** steps name tests and signatures; bodies are the implementer's.
- **Type consistency:** `AdminCaller`, `McpTool`, `AdminPrincipal.agent`, `scopeAdmits`, `AGENT_WRITE_ROUTES`, `MCP_CLIENT_ID`, `ADMIN_API_AUDIENCE` are each defined once and consumed under the same names.
- **Unverified by a command and settled by I0:** SDK package names and versions (the SDK README, read 2026-11-05, names `@modelcontextprotocol/server`; Fastify package name is unconfirmed), client revisions and registration modes, the in-process exchange without `may_act`, headless Inspector.
