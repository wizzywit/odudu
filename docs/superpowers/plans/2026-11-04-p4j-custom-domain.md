# P4j: a custom domain for each tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant can move its sign-in to a verified domain of its own, served at the root, and return to the default path address at any time, with a tenant that does neither changing not at all.

**Architecture:** One address service decides a tenant's canonical address (path or domain); every place that writes an address reads it. A rewrite at the edge maps a verified domain's requests onto the existing `/tenants/:tenant/…` routes, so no route changes. A switch records a retired issuer with an expiry; the five issuer-comparison sites accept it until it expires. Passkeys record the RP ID they were made under.

**Tech Stack:** TypeScript, Fastify 5.12.7, Drizzle + hand-written SQL migrations, PostgreSQL (Testcontainers), Vitest, Zod, `node:dns/promises`.

**Spec:** `docs/superpowers/specs/2026-11-04-p4j-custom-domain-design.md`

## Global Constraints

- Phase branch `p4j/custom-domain`; **draft PR opened with the first push**; one PR per increment into it; CI green on each push and the review answered before the next increment (CLAUDE.md, "CI runs on the branch"). Only the merge into `main` is asked about.
- Every implementer and reviewer runs on **Sonnet 5.5**; Opus only with the user's approval.
- No `any`; tests first; integration tests on real PostgreSQL; every repository method probed with a foreign `tenant_id`; `SET LOCAL` only.
- Comments carry only what code cannot say, no block over 8 lines, never a plan/task/phase reference. No `void doThing()`.
- Commit messages: subject ≤ 72, body ≤ 8 lines, **no tool-attribution trailer**; no attribution line in PR bodies.
- Every user-facing string is a catalogue entry with Arabic (`tests/lint/arabic-catalogues.test.ts`); a new page kind has an entry in `page-kinds.ts` and passes `theme-reach.test.ts`.
- Layering: address rules, host validation, state transitions and window arithmetic are pure `service` functions; usecases take `now`; repositories hold no logic.
- Volume (ADR 0041): host lookup is one indexed read; list endpoints use a constant number of queries and are bounded under `MAX_LIMIT`; no unbounded in-process structure.
- A tenant with no domain row behaves byte-for-byte as today; the existing suites pass **unedited** except where a task names an edit.
- Heavy jobs (docker, e2e, int suites) go through the heavy-slot lock; quote the comment, layering and no-`.ts`-extension rules in every dispatch.

## Review Focus

- A `Host` that differs only in case, trailing dot, default port or punycode form of a verified domain → resolves to the tenant (Task 5).
- `X-Forwarded-Host` set by a client while `ODUDU_TRUST_PROXY` is off → never selects a tenant (Task 5).
- `GET /tenants/acme/…` on `login.acme.com`, and `/admin`, `/console`, `/docs`, `/internal` there → bare refusal (Task 5).
- A domain claimed by two tenants, an IP literal, `localhost`, the operator's own host → refused at registration (Task 4).
- Switch A→B→A inside the window → both issuers still accepted; after expiry only the canonical (Task 8).
- A passkey registered at the path address, tenant switched to a domain → not offered, not accepted; back again → works (Task 9).
- A recheck that throws, or a resolver that times out → logged, loop reschedules, and a later pass runs (Task 10).
- The sign-in throttle, the login budget and the input-hygiene hook still apply on a domain host, because they key on route patterns (Task 5).
- A disabled tenant and a deleted tenant → its domain refuses, and frees the host (Tasks 3, 5).
- Host `127.0.0.1` on `/health/ready`, an internal name on `/internal/domain-check`, an unregistered host on `/tenants/<name>/…`, and an unset `ODUDU_PUBLIC_BASE_URL` → served exactly as today (Task 5).
- A squatted host: tenant B registers `login.victim.com` first and never verifies → the real owner's tenant verifies it and wins; B's pending row is reaped (Task 3).
- A resolver outage during a recheck pass → nothing counts as a failure and no tenant falls back (Task 10).
- A password-reset or verification mail, a queued backchannel logout and a front-channel `iss` after a switch → the canonical address from the database, never from a request's `Host` (Task 2b).
- Registering a domain for the system tenant, for a tenant with no `ODUDU_PUBLIC_BASE_URL` configured, or past the per-tenant cap → refused with a stable error code (Tasks 4, 7).
- Tenant export and import → export omits domains and says so, import never carries one, so a host cannot be claimed by importing (Task 7).

## Facts about this repository (grep beside each, per CLAUDE.md)

- Migrations are hand-written SQL, numbered; next free is **0111**. `ls packages/db/drizzle | tail -3` → `0110_theme_version_unique.sql`. Policies are SQL, not `pgPolicy()`; the pattern is `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)` (`packages/db/drizzle/0057_rename_realm_to_tenant.sql`). `tenants` itself has `tenants_isolation` (`id = current_setting(...)`), so **a pre-context host lookup cannot read it** on the serving role.
- The tenant name reaches the route as `request.params.tenant` (`packages/protocol-oidc/src/view/routes/discovery.ts:14`). `assumption:` how a name becomes a tenant id before tenant context is not found by `git grep -n 'tenants' packages/*/src/repository`; Task 3 step 1 finds it and the host lookup uses the same seam.
- Issuer: `tenantIssuer(issuerBase, name)` in `packages/protocol-oidc/src/service/issuer.ts`, called through `issuerBaseFor`/`tenantIssuerFor` in `view/issuer.ts`; `configureIssuerBase` decorates `request.configuredIssuerBase` from `ODUDU_PUBLIC_BASE_URL` (`apps/server/src/app.ts`, `configureIssuerBase(app, deps.publicBaseUrl)`).
- Hand-built tenant paths in production code (`git grep -n -E 'tenants/' -- 'packages/*/src' | grep -v '\.test\.' | grep -v admin/tenants`): `authn-flows/view` (`passkey-enrolment-html`, `recovery-codes-html`, `totp-enrolment-html`, `update-password-html`: their required-action form targets), `protocol-oidc` view (`authorize-html`, `consent-html`, `logout-html`, `select-account-html`, `routes/cors`), `service/restart-request`, `service/login-ways`, `repository/client-keys`; `account` (`reset-html`, `registration-html`, `service/action-link`); `domain-theme/service/branding-urls`; `console-gateway/usecase/begin-login`; `apps/server/src/cli/console.ts:89`, `brand-routes.ts`, `app.ts` (route patterns, throttle sets, `Path=/tenants/…` in `authn-flows/service/sign-in-handle.ts`).
- Cookie names: `sessionCookieName(tenant, tls)` → `__Host-<tenant>-session` (`authn-flows/service/session-cookie.ts:12`).
- WebAuthn: `relyingPartyId(publicBaseUrl)` / `relyingPartyOrigin` in `authn-flows/service/webauthn.ts:46,59`, used at lines 87, 167–168, 212, 279–280. Credential rows live in `packages/domain-identity/src/schema/user-credentials.ts`; `git grep -n -i 'rp_id\|rpid' -- 'packages/*/src/schema' 'packages/db'` finds **no** RP ID column.
- Scheduled-pass pattern: `apps/server/src/cli/reap.ts` (command), `apps/server/src/modules/reap.ts` (`reapSchedule`, `reapModule`), `apps/server/src/scheduler.ts` (`startScheduler`), config `ODUDU_REAP_ENABLED`, `ODUDU_REAP_INTERVAL_SECONDS` in `packages/kernel/src/config.ts:245`.
- Audit vocabulary: `AUDIT_ACTIONS` in `packages/domain-audit/src/index.ts`, held by `packages/domain-audit/src/service/vocabulary-docs.test.ts` and `tests/lint/audit-vocabulary-coverage.test.ts`.
- Admin capabilities live in `packages/protocol-admin/src/service/capability.ts` and `packages/domain-tenant/src/service/admin-capabilities.ts`; admin routes in `packages/protocol-admin/src/view/routes/`.
- `reap` refuses to run unless every table with a rule is in `REAP_ORDER` (`apps/server/src/cli/reap.ts`, `assertReapOrder`, `RETENTION_RULES`); expired `tenant_issuer_retirements` rows need a rule and a place there. `query-plans` is a required job in `.github/workflows/verify.yml`; Task 3 step 1 finds its harness (`git grep -n -i 'query-plans\|queryPlan' -- tests .github package.json`).
- Mail and logout code reads the base from config, not from the request: `git grep -n -l 'issuerBase\|publicBaseUrl' -- packages/email/src packages/account/src packages/protocol-admin/src` → `account/service/action-link.ts`, `usecase/{register,verify-email,reset-password,execute-actions}.ts`, `protocol-admin/usecase/{authenticate-admin,mail-preview}.ts`; `logout-token.ts` and `frontchannel-logout.ts` take an `issuer` argument; `token-exchange-subject.ts`, `revocation.ts`, `introspection.ts`, `userinfo.ts` compare or emit `deps.issuer`.
- CORS matches the URL: `packages/protocol-oidc/src/view/routes/cors.ts:9` (`/^\/tenants\/([^/]+)\/protocol\/openid-connect\/(?:token|userinfo)$/`).
- The system tenant is `SYSTEM_TENANT_NAME` / `SYSTEM_TENANT_ID` in `@odudu/domain-tenant`; the console's client lives there (`apps/server/src/cli/init.ts`).
- Tenant export and import: `packages/protocol-admin/src/usecase/tenant-export.ts`, `tenant-import*.ts`.
- Server pages have page kinds and a screenshot drift check: `apps/docs/scripts/page-shots/drift.test.ts`, `packages/protocol-oidc/src/view/theme-reach.test.ts`.
- `verified: node -e` with Fastify 5.12.7 — `rewriteUrl` set on the constructor rewrites `/x` to `/tenants/acme/x` before routing, the route sees `request.url` rewritten; it receives the **raw** `IncomingMessage`, so `trustProxy` is not applied to it. With `trustProxy: true`, `request.host` returns the `X-Forwarded-Host` value; with it off it returns `Host`. `node:dns/promises` exports `resolveTxt`.

---

## Increment 1 — The address service, adopted without a behaviour change

### Task 1: The address service

**Files:** Create `packages/kernel/src/address.ts`, `packages/kernel/src/address.test.ts`; modify `packages/kernel/src/index.ts`.

**Interfaces — Produces:**

```ts
export interface TenantAddress {
  readonly origin: string;
  readonly prefix: string;
}
export function pathAddress(issuerBase: string, tenant: string): TenantAddress; // prefix `/tenants/<name>`
export function domainAddress(host: string, tls: boolean): TenantAddress; // prefix ''
export function addressIssuer(a: TenantAddress): string; // origin + prefix
export function addressPath(a: TenantAddress, rest: string): string; // prefix + rest ('/login-actions/x')
export function addressUrl(a: TenantAddress, rest: string): string; // origin + addressPath
export function addressRelyingParty(a: TenantAddress): { id: string; origin: string };
```

- [ ] **Step 1: Write failing tests** in `address.test.ts`: `pathAddress('https://idp.example','acme')` → issuer `https://idp.example/tenants/acme`, `addressPath(…,'/login-actions/authenticate')` → `/tenants/acme/login-actions/authenticate`; `domainAddress('login.acme.com', true)` → issuer `https://login.acme.com`, path `/login-actions/authenticate`; relying-party id is the host without port for both (`idp.example`, `login.acme.com`), origin keeps the port; `tls=false` gives `http`.
- [ ] **Step 2:** Run `pnpm --filter @odudu/kernel test address` — expect FAIL (module missing).
- [ ] **Step 3:** Implement the signatures above in `address.ts`; the relying-party id reuses the existing rule in `relyingPartyId` (read it first and move, not copy, its host-extraction so one rule remains).
- [ ] **Step 4:** Re-run — expect PASS. Run `pnpm --filter @odudu/kernel typecheck`.
- [ ] **Step 5: Commit** `feat(kernel): add the tenant address service`.

### Task 2: Every emission site reads the address; a lint holds it

**Files:** modify the production files listed under "Hand-built tenant paths" **and** every caller of `tenantIssuer(`, `tenantIssuerFor(` and `issuerBaseFor(` (`git grep -n -E 'tenantIssuer(For)?\(|issuerBaseFor\(' -- 'packages/*/src' 'apps/server/src' | grep -v '\.test\.'`), the discovery document's endpoint URLs, and the CORS path pattern in `routes/cors.ts` (it must match the URL the router sees on a domain host as well) (view renderers take an `address: TenantAddress` in their input instead of building `/tenants/${name}`; routes read `request.tenantAddress`); create `tests/lint/tenant-address.test.ts`; modify `apps/server/src/app.ts` to decorate `request.tenantAddress` (path address, from `issuerBaseFor(request)` and `params.tenant`) in an `onRequest` hook registered **before** the host-resolution hook of Task 5, so a domain-host request's address is set last by host resolution and never overwritten; a test in Task 5 asserts a domain-host request never reads `configuredIssuerBase`.

**Interfaces — Consumes:** Task 1. **Produces:** `request.tenantAddress: TenantAddress | undefined` (undefined off tenant routes); renderers' inputs gain `address`.

- [ ] **Step 1: Write the lint test** `tests/lint/tenant-address.test.ts`: walk production `.ts` under `packages/*/src` and `apps/server/src` (not tests, not `testing/`), fail naming file and line on a template literal or string containing `/tenants/`, or a call of `tenantIssuer(`, that is not in an allowlist of _route-pattern_ files (`app.ts`, `brand-routes.ts`, `endpoint-docs.ts`, route registrations under `view/routes`, `protocol-admin`, `console-gateway`, `cli/console.ts`) and not `kernel/src/address.ts`. Its header lists what it cannot see (a path built by concatenating a variable). Run — expect FAIL listing today's sites.
- [ ] **Step 2:** Convert each listed site, one commit per package. Renderer snapshot tests and view tests keep their expected output: the path address yields the same bytes, so **no existing snapshot changes**.
- [ ] **Step 3:** Run `pnpm verify` — expect green with no snapshot or test edit. Run the lint — PASS.
- [ ] **Step 4: Commit** per package, `refactor(<pkg>): write tenant addresses through the address service`.
- [ ] **Step 5:** Push, open the draft PR for the phase, `gh pr checks --watch`, answer review.

### Task 2b: The canonical address where there is no request

**Files:** Create `packages/domain-tenant/src/usecase/canonical-address.ts` (+ test); modify `account/service/action-link.ts`, `account/usecase/{register,verify-email,reset-password,execute-actions}.ts`, `protocol-admin/usecase/{authenticate-admin,mail-preview}.ts`, `protocol-oidc` logout-token and front-channel call sites, `apps/server/src/email.ts`, `apps/server/src/cli/seed.ts` (`--issuer-base` default).

**Interfaces — Produces:** `canonicalAddressFor(tx: TenantScopedDatabase, tenant: { id: string; name: string }, base: string, tls: boolean): Promise<TenantAddress>` — the tenant's canonical domain row if any, else `pathAddress(base, name)`; the base is `ODUDU_PUBLIC_BASE_URL`, never a request header. (Before Task 3 lands this returns the path address; Task 3 gives it the table.)

- [ ] **Step 1: Write failing tests**: a verification mail, a reset mail and an admin "send actions email" built for a tenant whose canonical is a domain carry `https://login.acme.com/…` links and brand asset URLs; the same request made with a spoofed `Host`/`X-Forwarded-Host` still yields the configured address (the mail link never reads the request); a queued backchannel logout delivery signs `iss` with the canonical address at delivery time, and a delivery retried after a switch uses the new one; front-channel logout's `iss` parameter is the canonical issuer.
- [ ] **Step 2–4:** Run (FAIL); implement; run `pnpm verify` — existing mail snapshots unchanged for path tenants. **Step 5: Commit** `refactor(account): write mail and logout addresses from the canonical address`.

---

## Increment 2 — The table, the lookup, the domain rules

### Task 3: Schema, RLS and the host lookup seam

**Files:** Create `packages/db/drizzle/0111_tenant_domains.sql` (with `ENABLE` and `FORCE ROW LEVEL SECURITY` for both tables, as `0003_signing_keys.sql` does), `packages/domain-tenant/src/schema/tenant-domains.ts` (beside the other tenant-scoped tables there; the `tenants` table alone sits in `packages/db/src/schema`), `packages/domain-tenant/src/repository/tenant-domains.ts`, tests `packages/domain-tenant/src/repository/tenant-domains.int.test.ts`; modify `packages/db/src/schema/index.ts`, the domain-identity credentials schema (new `rp_id`).

**Interfaces — Produces:**

```ts
// tenant_domains(id uuid pk, tenant_id uuid fk, host text, state text check in ('pending','verified','failed'),
//   challenge text, verified_at, last_checked_at, failed_checks int default 0, canonical bool default false,
//   created_at)  -- partial unique indexes: (tenant_id) where canonical; (host) where state = 'verified'; plain index on host
// tenant_issuer_retirements(tenant_id, issuer text, expires_at timestamptz, pk (tenant_id, issuer))
// user_credentials.rp_id text not null, back-filled with the base host
export interface DomainRow {
  id;
  tenantId;
  host;
  state;
  challenge;
  verifiedAt;
  lastCheckedAt;
  failedChecks;
  canonical;
}
// tenant-scoped (uses the tenant's transaction):
insert / list / get / delete /setCanonical/Cacdeehkkmr / retireIssuer / listRetired;
// deployment-wide, owner-or-definer seam, returns only what routing needs:
export function lookupHost(
  db,
  host: string,
  now: Date,
): Promise<{ tenantId; tenantName; canonical: boolean; retiredUntil: Date | null } | null>;
```

- [ ] **Step 0:** add `tenant_issuer_retirements` (delete rows past `expires_at`) and `tenant_domains` (delete `pending` rows older than the retention window, default 7 days, through the policy `retentionPolicyFromConfig` already reads; document the setting) to `RETENTION_RULES` and `REAP_ORDER` (no `after`); because `tests/docs/retention-schedule.test.ts` asserts every captured `odudu reap` transcript carries `REAP_ORDER`'s keys in order, edit the retention page under `operating/` and re-run the reap transcripts under `reference/transcripts/` in the same increment (the commit lists each); and and register the new host lookup, the domain list and the retirement read in the `query-plans` harness found by `git grep -n -i 'query-plans\|queryPlan' -- tests .github package.json`; a plan that seq-scans `tenant_domains` fails.
- [ ] **Step 1 (spike, no commit):** find how `:tenant` becomes a tenant id before context exists: `git grep -n -E "tenants\b" -- 'packages/*/src/repository' 'packages/*/src/usecase' | head -30`; write the finding as a two-line comment-free note in the PR. The host lookup and the name resolution use that one seam; if it is a `SECURITY DEFINER` function, `lookupHost` is another beside it; if it is an owner-role read, so is this.
- [ ] **Step 2: Write failing tests**: foreign-tenant probe for every tenant-scoped method (tenant B cannot list, read, delete or canonicalise tenant A's domain); `lookupHost` returns only the four fields, returns `null` for `pending`/`failed`, for a verified non-canonical host with no retirement, and a verified non-canonical host with `retiredUntil > now`; two tenants may hold `pending` rows for one host, the first to verify wins and the second's verification raises the repository's conflict, and a `failed` row blocks nobody; one canonical per tenant at the database; `host` is stored in the canonical form and a CHECK refuses anything that is not (as `0072_tenant_name_rule.sql` does for names); `ON DELETE CASCADE` from the tenant, so deleting a tenant frees its hosts (test: delete, then another tenant registers the same host); `lookupHost` returns `null` for a disabled tenant (`tenants.enabled = false`); at most `MAX_DOMAINS_PER_TENANT = 20` rows per tenant, enforced in the repository (the 21st raises the conflict the usecase maps to a stable error code); the reap rules delete only expired retirements and stale `pending` rows, never a `verified` one; `rls-policy.int.test.ts` and `schema-drift.int.test.ts` pass with the new tables.
- [ ] **Step 3:** Run — expect FAIL. **Step 4:** Write the migration (policy `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)` on both tables; index on `host`; back-fill `rp_id` from a migration-time parameter is impossible, so the column is added nullable, back-filled by `scripts`-free SQL using `current_setting('odudu.base_rp_id', true)` — **assumption:** if that setting is not available at migrate time, back-fill in a one-shot `odudu migrate` step instead; decide in this step by reading `packages/db/src/migrate.ts`, and record which). Implement the repository and schema.
- [ ] **Step 5:** Run `pnpm --filter @odudu/domain-tenant test:int` — expect PASS; `pnpm verify`. **Commit** `feat(db): add tenant domains and issuer retirements`.

### Task 4: Domain rules and the DNS challenge

**Files:** Create `packages/domain-tenant/src/service/tenant-domain.ts`, `tenant-domain.test.ts`, `packages/domain-tenant/src/usecase/verify-domain.ts`, `verify-domain.test.ts`, `packages/domain-tenant/src/adapter/dns-challenge.ts`.

**Interfaces — Produces:**

```ts
export function canonicalHost(raw: string): string | null; // lowercase, no trailing dot, no default port, punycode; null if not a DNS name
export function refuseHost(host: string, operatorHost: string): DomainRefusal | null; // 'ip_literal'|'localhost'|'operator_host'|'reserved_name'|'invalid'
export function challengeName(host: string): string; // `_odudu-challenge.<host>`
export function newChallenge(random: () => Buffer): string;
export type ResolveTxt = (name: string) => Promise<readonly (readonly string[])[]>;
export function verifyDomain(
  deps: { resolveTxt: ResolveTxt; domains },
  tenantId,
  id,
  now,
): Promise<'verified' | 'pending' | 'failed'>;
```

- [ ] **Step 1: Write failing tests**: `canonicalHost('LOGIN.Acme.COM.:443')` → `login.acme.com`; `xn--` and unicode forms of the same name equal; `refuseHost('192.0.2.1')`, `'[::1]'`, `'localhost'`, `'x.localhost'`, `'a.test'`, the operator host, any host carrying a non-default port, and a single-label name → refusals; `registerDomain` refuses the system tenant (`SYSTEM_TENANT_ID`) with code `domain_system_tenant` and refuses every registration when `ODUDU_PUBLIC_BASE_URL` is unset with `domain_no_base_url`; `verifyDomain` marks `verified` only when a TXT value equals the challenge, `pending` on `ENOTFOUND`/no match, and treats a resolver timeout as `pending`, never `verified`.
- [ ] **Step 2–4:** Run (FAIL); implement; run (PASS). `resolveTxt` is `node:dns/promises`'s, injected, never imported by the usecase. **Step 5: Commit** `feat(domain-tenant): domain rules and ownership check`.

Push; PR; CI green; answer review.

---

## Increment 3 — Resolving a host

### Task 5: Host resolution at the edge

**Files:** Create `apps/server/src/host-resolution.ts`, `host-resolution.test.ts`, `host-resolution.int.test.ts`; modify `apps/server/src/app.ts` (`buildApp`: `rewriteUrl` option; `request.tenantAddress` for domain hosts), `apps/server/src/app-deps.ts`.

**Interfaces — Consumes:** Task 1 `domainAddress`; Task 3 `lookupHost`. **Produces:**

```ts
export function requestHost(raw: IncomingMessage, trustProxy: boolean): string | null; // canonicalHost of Host, or leftmost X-Forwarded-Host only when trustProxy
export const DOMAIN_ALLOWED: readonly RegExp[]; // paths a domain host may serve (protocol, login-actions, account pages, brand, discovery)
export function rewriteForDomain(url: string, tenantName: string): string | null; // null = refuse
```

The host-to-tenant lookup is asynchronous and `rewriteUrl` is not, so a request on a non-base host cannot be rewritten in one step. The contract is the behavioural tests below; the mechanism is chosen in step 1 between two candidates: (a) `rewriteUrl` sends every non-base-host path to a reserved prefix, and a handler there resolves the host and serves the tenant's routes registered a second time under that prefix with the tenant taken from the host; (b) a hook that runs before routing resolves the host and sets the URL the router sees. `assumption:` Fastify 5.12.7 allows (b); step 1 proves or disproves it.

- [ ] **Step 1: Spike** (script under the scratchpad, not committed): establish which of (a)/(b) works on Fastify 5.12.7 with an async DB lookup; record the verified command and output in the PR description.
- [ ] **Step 2: Write failing tests** (integration, real PostgreSQL, `fastify.inject` with `Host`): a verified canonical domain serves `/protocol/openid-connect/auth` as its tenant and `/.well-known/openid-configuration` returns issuer `https://login.acme.com` with endpoints under that origin; `Host: LOGIN.acme.com.:443` equals the same; a `pending`, `failed`, unknown, or idle host → bare 404 with an empty body, identical bytes for each; `X-Forwarded-Host: login.acme.com` with `Host: evil.test` and trust **off** → 404; trust **on** → resolves; `/tenants/acme/…`, `/admin/…`, `/console/…`, `/docs…`, `/internal/…`, `/health` on a domain host → the same bare 404; the base host does no domain lookup (assert zero queries to the lookup with a spy) and every existing test is untouched. Also: the sign-in POST throttle, the composite login budget (`loginBudgetKey`) and `neutraliseRequestInput` apply to `/login-actions/authenticate`, `/login-actions/registration` and `/login-actions/reset-password` on a domain host exactly as on the path address (drive past the budget on a domain host and expect the same 429 page); CORS on token and userinfo answers on a domain host as on the path, including an `OPTIONS` preflight (`routes/cors.ts` matches `request.raw.url` against a `/tenants/…` regex, so the rewrite must run before it or the pattern must also accept the routed URL); a domain-host request reaches the account routes (`registration`, `reset-password`, `action-token`) with the domain address, not a path address rebuilt from `Host` (account's `ensureTenantAddress` skips when `request.tenantAddress` is already set); a disabled tenant's domain answers the bare 404; **a required-action step on a domain host** (TOTP enrolment and update-password submit to the domain's own path and complete, which catches a form target still pointing at `/tenants/…`); a host with no row serves `/tenants/<name>/…` as today and `Host: 127.0.0.1` answers `/health/ready` with no lookup (spy); a registered-but-not-live host refuses every path including `/tenants/…`; an unset `ODUDU_PUBLIC_BASE_URL` turns host resolution off; **a full authorization-code-with-PKCE flow on a domain host** (discovery → authorize → login → consent → token → userinfo → end-session) has `iss` in the ID token, the discovery `issuer` and the authorization response equal to `https://login.acme.com`, and the `__Host-<tenant>-session` and sign-in-handle cookies carry `Path=/` (the handle's `Path` from the address prefix).
- [ ] **Step 3–4:** Run (FAIL); implement per step 1; run (PASS) plus `pnpm --filter @odudu/server test:int`. **Step 5: Commit** `feat(server): serve a verified domain at its root`.

### Task 6: The proxy's question

**Files:** Create `apps/server/src/domain-check.ts`, `domain-check.test.ts`; modify `app.ts`, `endpoint-docs.ts`.

**Interfaces — Produces:** `GET /internal/domain-check?domain=<host>` → `200` or `404`, both with an empty body and the same headers; answered whatever the `Host` (the proxy calls it by an internal name such as `odudu:3000`) and exempt from host resolution; throttled per origin by its own `onRequest` hook (the existing hook in `app.ts` reads `THROTTLED_POSTS` for POST only; `assumption:` `throttle.check(throttleOrigin(request.ip))` can be called from a GET hook — read `throttle.ts` first and record what it does).

- [ ] **Step 1: Write failing tests**: 200 for a verified canonical host; 200 for a retired one inside its window; 404 for pending/failed/idle/unknown/invalid (`domain=` empty, repeated, IP literal); body empty and header set identical across 200 and 404 except the status; the same answer with `Host: odudu:3000` and with a domain host; 429 past the budget; `tests/docs/endpoints.test.ts` passes with the route documented.
- [ ] **Step 2–4:** Run; implement via `lookupHost`; run. **Step 5: Commit** `feat(server): answer the proxy's domain question`.

Push; PR; CI; review.

---

## Increment 4 — Switching, and the issuer in the window

### Task 7: Admin API, capability, audit

**Files:** Create `packages/protocol-admin/src/usecase/domains.ts`, `view/routes/domains.ts`, contracts in `packages/contracts/src/admin/domains.ts` (+ docs entries), tests beside; modify `capability.ts`, `admin-capabilities.ts`, `AUDIT_ACTIONS`.

**Interfaces — Produces:** under `/admin/tenants/{tenant}/domains`: `POST` (register → returns challenge and its DNS name), `GET` list, `GET /{id}`, `POST /{id}/verify`, `POST /{id}/activate`, `POST /{id}/deactivate`, `DELETE /{id}`, and `GET /passkey-impact` returning how many subjects hold passkeys that a switch would hide (contract, docs entry, `admin-paths.test.ts`, used by the console in Task 11). Capability pair `domains.read` / `domains.manage` named as branding's pair is (read it first). Audit actions `domain.registered`, `domain.verified`, `domain.activated`, `domain.deactivated`, `domain.removed`, `domain.failed`. Activate and deactivate run in one transaction: set canonical, write a retirement for the old canonical's issuer with `expires_at = now + ACCESS_TOKEN_CEILING`, delete a retirement equal to the new canonical issuer. `ACCESS_TOKEN_CEILING` is the maximum the token endpoint accepts for `access_token_ttl_seconds`: **step 1 greps it** (`git grep -n -E 'access_token_ttl|accessTokenTtl' -- packages/contracts packages/domain-tenant/src/service`) and names the constant.

- [ ] **Step 1: Write failing tests**: foreign-tenant probe on every route; `POST /verify` is throttled per tenant and per host with a cooldown (a resolver is never called twice for one host inside the cooldown; the response is `429` with `Retry-After`), because it makes the server perform a DNS lookup for a name the caller chose; two admins activating two domains at once → one `409`, never two canonicals; an activate or deactivate carries the tenant's ETag like the other admin writes (`412` on a stale one); `GET /export` omits domains and its documented shape says so, and `PUT /import` with a `domains` key is refused as unknown; activating an unverified domain → 409; deactivate needs no resolver call (resolver stub throws if invoked); the second switch inside the window leaves both retirements; every action writes its audit row; `admin-paths.test.ts`, `error-codes.test.ts`, `vocabulary-docs.test.ts`, `audit-vocabulary-coverage.test.ts` pass; a list of 10,000 domains is paged under `MAX_LIMIT` with a constant query count.
- [ ] **Step 2–4:** Run; implement; run. **Step 5: Commit** `feat(admin): register, verify, activate and remove domains`.

### Task 8: The issuer in the window, and the previous address

**Files:** modify the five sites named in the spec (find each by `git grep -n -E "issuer" -- packages/protocol-oidc/src/usecase/userinfo.ts introspection.ts authorization-request.ts end-session.ts client-authentication.ts private-key-jwt-authentication.ts`), `apps/server/src/host-resolution.ts`; tests beside each.

**Interfaces — Consumes:** `listRetired`. **Produces:** `acceptedIssuers(canonical: string, retired: readonly {issuer; expiresAt}[], now: Date): readonly string[]` (pure, in `packages/protocol-oidc/src/service/issuer.ts`).

Sites: enumerate every comparison and every emission with `git grep -n -E "\\biss\\b|issuer" -- packages/protocol-oidc/src | grep -v '\.test\.'` and classify each in the PR as _compare_ (accepts the canonical and live retired issuers through `acceptedIssuers`) or _emit_ (uses the address the request arrived at, or the canonical one where there is no request): userinfo, introspection, revocation, token-exchange subject validation (`token-exchange-subject.ts`), `id_token_hint` at authorize and logout, client-assertion `aud`, logout-token, front-channel logout, discovery. The previous-address refusal is a new server page: add its renderer `*-html.ts` with a `messages.ts` entry and Arabic text, its kind in `page-kinds.ts`, make `theme-reach.test.ts`, `arabic-catalogues.test.ts` and the `server-pages-arabic.spec.ts` axe run pass, and regenerate the landing screenshots with `pnpm --filter @odudu/instrument build && pnpm --filter @odudu/docs page-shots` in the same commit (`drift.test.ts` fails otherwise).

- [ ] **Step 1: Write failing tests**: `acceptedIssuers` drops an expired retirement and keeps a live one; for each site (userinfo, introspection, `id_token_hint` at authorize and at logout, client-assertion `aud`) a token minted under the retired issuer is accepted inside the window and refused at `expires_at`; at the previous address, `/authorize`, registration and reset pages refuse with a catalogue page naming the canonical address, while token, userinfo, introspection, revocation, jwks and logout answer inside the window and everything answers the bare 404 after it; a token minted at the previous address in the window carries that address's issuer; a token-exchange `subject_token` and a revocation request presenting a retired-issuer token are accepted inside the window and refused after; a client whose `redirect_uri` and `post_logout_redirect_uri` were registered before the switch completes authorize and logout unchanged at the canonical address (client URIs do not move on a switch).
- [ ] **Step 2–4:** Run; implement; run `pnpm verify`. **Step 5: Commit** `feat(protocol-oidc): accept a retired issuer until its window ends`.

Push; PR; CI; review.

---

## Increment 5 — Passkeys follow the domain

### Task 9: RP ID per canonical address

**Files:** modify `packages/authn-flows/src/service/webauthn.ts` (lines 87, 167–168, 212, 279–280 take an `address`), `usecase/passkey-enrolment.ts`, `passkey-authentication.ts`, the credentials repository (write and filter `rp_id`), `apps/server/src/config-guard.ts` (`assertProductionPasskeyRelyingParty` still requires the base URL: the path address needs it); tests beside.

- [ ] **Step 1: Write failing tests**: enrolment records `rp_id` of the canonical address; authentication options list only credentials whose `rp_id` equals the canonical RP ID; verification uses the canonical origin and RP ID alone; **a passkey registered at the path address does not authenticate at the domain, and authenticates again after switching back** (`verified:` run the library's own registration/authentication fixtures used in `webauthn.test.ts`, extended with a second RP ID); the console count endpoint returns how many subjects hold credentials a switch would hide.
- [ ] **Step 2–4:** Run; implement; run `pnpm --filter @odudu/authn-flows test` and `test:int`. **Step 5: Commit** `feat(authn-flows): bind passkeys to the canonical address`.

Push; PR; CI; review.

---

## Increment 6 — The lost domain closes by itself

### Task 10: Recheck pass, command, loop

**Files:** Create `packages/domain-tenant/src/usecase/recheck-domains.ts` (+ test), `apps/server/src/cli/domains.ts` (`odudu domains recheck`), `apps/server/src/modules/domain-recheck.ts` (+ test); modify `packages/kernel/src/config.ts` (`ODUDU_DOMAIN_RECHECK_ENABLED` default true, `ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS` default 3600 min 60, `ODUDU_DOMAIN_RECHECK_FAILURES` default 3), the CLI help registry, `modules` wiring in `main.ts`.

**Interfaces — Produces:** `type TxtOutcome = 'match' | 'absent' | 'indeterminate'` (`ENOTFOUND`/`ENODATA`/no matching value → `absent`; `ESERVFAIL`, timeout and any other resolver error → `indeterminate`); `recheckDomains(deps: { resolveTxt; domains; timeoutMs; concurrency; pageSize }, now): Promise<{checked; failed; indeterminate; fellBack}>` — pure of timers; a verified domain whose TXT is `absent` increments `failed_checks` (an `indeterminate` one changes nothing, and a pass with more than half `indeterminate` changes nothing at all), a match resets it; at the threshold the row is `failed`, and if canonical the tenant's canonical returns to the path address with a retirement and a `domain.failed` audit row. The module mirrors `reapModule`: `domainRecheckSchedule(config)` → `{scheduled:false, why:'switched-off'}` or interval and jitter.

- [ ] **Step 1: Write failing tests**: counts, threshold, a resolver outage (every lookup `ESERVFAIL`) leaves every `failed_checks` unchanged and no tenant falls back, concurrency never exceeds the limit and each lookup is cut at `timeoutMs`, a 25,000-row fixture is walked in pages with a constant query count per page, fall-back writes the retirement; a resolver that throws on one domain does not stop the pass or the rest; with `vi.useFakeTimers()` a pass that throws is logged and `await vi.advanceTimersByTimeAsync(interval + jitter)` shows a **later** run; switched off → not scheduled; `tests/docs/env-reads.test.ts`, `config-defaults.test.ts`, `apps/docs/scripts/config-page.test.ts`, `cli-page.test.ts` pass with the three variables and the command documented; the `recheck` pass takes its advisory lock like `reap` (`REAP_LOCK_KEY` pattern, own key).
- [ ] **Step 2–4:** Run; implement; run. **Step 5: Commit** `feat(server): recheck domain ownership on a schedule`.

Push; PR; CI; review.

### Task 10b: `odudu seed domain`

**Files:** Create/modify `apps/server/src/cli/seed.ts`, `seed-options.ts`, the help registry, `seed.test.ts`.

**Interfaces — Produces:** `odudu seed domain --tenant <name> --host <host> [--canonical] [--assume-verified]`; `--assume-verified` marks the row verified without a DNS lookup and **refuses when `NODE_ENV=production`** (`domain_assume_verified_production`), so end-to-end specs, transcripts and runnable guide blocks can create a served domain on a stack that has no real DNS, and no production deployment can skip ownership.

- [ ] **Step 1: Write failing tests**: creates the row with the same host rules as the admin API; `--assume-verified` works outside production and is refused in it; idempotent on a repeat; `apps/docs/scripts/cli-page.test.ts` passes with the entry. **Step 2–4:** Run; implement; run. **Step 5: Commit** `feat(cli): seed a domain for a tenant`.

---

## Increment 7 — The console

### Task 11: A Domains area

**Files:** a page slice `apps/admin-console/src/pages/domains/` (layers `ui`, `use-cases`, `repository`, `services`, `adapter`, one `index.ts`) and an entity `entities/domain/` if two slices use it; `shared/ui` components only; docs `apps/docs/content/en/admin-console/domains.md` and `tour.mdx`.

- [ ] **Step 1: Write failing tests** (the e2e fixture creates its served domain with `odudu seed domain --assume-verified`; service tests for wording and the passkey-warning rule as pure functions; hook test for activate with a rebase on `412`; e2e spec `apps/admin-console/e2e/domains.spec.ts`: register, copy the TXT record, verify, activate with the passkey warning shown, switch back, under axe in both colour schemes).
- [ ] **Step 2–4:** Run (FAIL); implement honouring `console-usecase-integration-only`, no `.ts` extensions, wording constants in a service; run `pnpm --filter @odudu/admin-console test`, `pnpm docs:screenshots`, `console-areas.test.ts`, `console-labels.test.ts`. The report carries a **Reuse scan**. **Step 5: Commit** `feat(admin-console): manage a tenant's domains`.

Push; PR; CI; review.

---

## Increment 8 — Documentation and the closing pass

### Task 12: What an operator and a reader need

**Files:** `docs/protocols/web-security.md` (a reading note: why a host selects a tenant only through a verified row, and why mail links never read `Host`), `tests/docs/questions.md` (the P4j line), the `README.md` feature list, `apps/docs/content/en/operating/custom-domains.md` (proxy `on_demand_tls { ask }`, why `/internal` is not public, DNS record, the switch and its costs: sessions end, passkeys hidden, resource servers accept two issuers for the window), transcripts under `reference/transcripts/` for the domain routes and the check endpoint **re-run on a live stack**, concept page edits in `concepts/tokens.md` and `sessions.md`, ADR ADR 0049, "a tenant has one canonical address", under `docs/adr/` (+ `docs/adr/README.md` row), the P4j note under `docs/phases/`, `CHANGELOG.md` `## [Unreleased]`.

- [ ] **Step 0:** `seed client` and the guide say a client's redirect URIs, web origins and logout URIs do not change on a switch; the guide says to keep `/internal/domain-check` off the public network; a Caddy `on_demand_tls { ask }` example in the guide, tagged `text` and stated as illustrative, since no CI job runs a real Caddy against real DNS; the guide's Odudu commands use `odudu seed domain --assume-verified` in runnable blocks; state in the phase note that `container`, `conformance` and `quickstart` exercise only the path address and what proves the domain path instead (Task 5's full-flow test, Task 11's e2e).
- [ ] **Step 1:** Write the pages; `pnpm --filter @odudu/docs test` — expect `guides-runnable`, `transcripts`, `links`, `operating` tests PASS.
- [ ] **Step 2:** Re-run each affected transcript against a live compose stack; commit the real output.
- [ ] **Step 3: The six closing checks** from CLAUDE.md: (1) read "What is not implemented" in `roadmap.md` and confirm each marker is still true; (2) `git grep -n '\bP4j\b' -- ':!docs/archive'` and fix every hit; (3) read `docs/NEXT.md` headings against closed phases and drop the P4j inheritance; (4) reconcile the roadmap, section 11's row (add "As built") and `docs/NEXT.md` both ways, run `tests/docs/roadmap-section-11.test.ts`; (5) `git grep -n -i -E 'planned|\bP4j\b|custom domain' -- apps/docs README.md tests/docs/questions.md` and fix the landing page, README and `questions.md` lines; (6) `CHANGELOG.md` entries under Added, Changed, Fixed, Security.
- [ ] **Step 4:** `pnpm verify`; whole-branch review on Sonnet 5.5; push; `gh pr checks --watch` until `gate` is green; answer review threads.
- [ ] **Step 5:** `git mv` the spec and plan to `docs/archive/specs/` and `docs/archive/plans/`; commit; ask before the merge into `main`.

---

## Self-review

- **Spec coverage:** 3.1 address → T1–T2; 3.2 table, refusals → T3–T4; 3.3 ownership and recheck → T4, T10; 3.4 host resolution and allowlist → T5; 3.5 switching, window, previous address, passkeys → T7–T9; 3.6 proxy question → T6; 3.7 calls (header, seam, issuer sites, off switch, capability, mail links via address service in T2, no cache) → T3, T5, T7–T8, T10; documentation owed → T12; volume → T3, T5, T7.
- **Type consistency:** `TenantAddress` and its five functions are defined in T1 and used unchanged in T2, T5, T9; `lookupHost` in T3 is the one deployment-wide read used by T5 and T6; `acceptedIssuers` (T8) reads `listRetired` (T3) written by T7 and T10.
- **Honest gaps:** two points are unresolved until a spike inside their task, and each says so — the pre-context tenant lookup seam (T3 step 1) and how an async host lookup meets Fastify's synchronous `rewriteUrl` (T5 step 1); the `rp_id` back-fill mechanism is decided in T3 step 4. The spec's 20–35 h row will be exceeded; the phase note records the actual figure.
- **Proportion:** the plan holds signatures, test names, assertions and values; bodies are left to the implementer.
