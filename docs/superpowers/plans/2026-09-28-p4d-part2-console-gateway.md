# P4d Part 2 — The Console Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backend-for-frontend under `/console` through which a browser
signs in to a tenant as an administrator and calls the admin API, with the
tokens held server-side. The browser holds nothing but a session cookie.

**Architecture:** A new package, `@odudu/console-gateway`, built in the five
layers and registered by `apps/server` when `ODUDU_CONSOLE` is on. It is an
ordinary public OAuth client (`odudu-admin`, PKCE, `resource` = the admin
audience). It reaches discovery, `/token`, `/revoke` and `/admin/**` through
Fastify's in-process `inject`, so every forwarded request still passes
through the admin API's own authentication, authorisation and audit.
Sessions and pending logins are two new RLS tables, whose tokens are wrapped
by the deployment KEK.

**Tech Stack:** Fastify 5 (`inject`), Drizzle + PostgreSQL 17 RLS,
`@odudu/crypto` (`wrapSecret`, JWKS verification over `jose`), Zod 4,
Vitest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-26-p4d-admin-console-design.md` §5
(gateway), §7 (edge cases the gateway answers) and §9 (testing). The
repository facts this plan relies on are verified at the point each one is
used, and each carries its command.

## Global Constraints

- **The gateway never imports a protocol package or `authn-flows`.** A
  dependency-cruiser rule enforces this, with a negative control. Allowed
  imports: `@odudu/kernel`, `@odudu/db`, `@odudu/crypto`, `@odudu/contracts`,
  and `@odudu/domain-tenant` for the tenant-name rule.
- **Session lifetimes:**
  - a session ends at 30 minutes idle, 12 hours absolute, or on a refused
    refresh, whichever comes first;
  - a pending login lives 10 minutes;
  - the access token is refreshed when it is within 30 s of expiry.
- **The session cookie:**
  - name and attributes: `__Host-odudu-console`,
    `HttpOnly; Secure; SameSite=Strict; Path=/`;
  - over plain HTTP, by ADR 0020's rule, it is `odudu-console` without
    `Secure`, and boot warns;
  - its value is `<tenant_id>.<secret>`, and only SHA-256(secret) is stored.
- **CSRF:** a state-changing request to `/console/api/**` carries
  `Origin` = the origin of `ODUDU_PUBLIC_BASE_URL` and `X-Odudu-Console: 1`,
  or it is refused `403`.
- **CSP of the SPA shell, verbatim:**
  `default-src 'self'; script-src 'self'; style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  plus `x-frame-options: DENY` and `referrer-policy: no-referrer`.
  `index.html` is `no-store`; hashed assets are
  `public, max-age=31536000, immutable`. The hash was measured in Part 1's
  spike (`docs/phases/p4d.md` "React Aria under a strict CSP"). The test
  that recomputes it from the pinned package lands in Part 3, with the
  dependency.
- **`ODUDU_CONSOLE`** is `true` or `false`, defaulting to `true` — the
  spelling every other switch in `config.ts` uses. With it on, boot
  refuses to start without `ODUDU_PUBLIC_BASE_URL`, naming both variables,
  and refuses an `https` base while `ODUDU_TRUST_PROXY` is off.
- **The redirect URI** is `${ODUDU_PUBLIC_BASE_URL}/console/auth/callback`
  and the post-logout URI is `${ODUDU_PUBLIC_BASE_URL}/console/`. Both are
  written by `provisionAdminClient` and never derived from `Host`.
- **Secrets never leave the gateway.** No token, cookie secret, code or
  PKCE verifier appears in a log line, an audit row, an error body, or any
  response to the browser.
- The comment and commit rules of `CLAUDE.md` apply:
  - a comment block is at most 8 lines;
  - no comment names a task, step, plan or finding;
  - a commit subject is at most 72 characters, with a body of at most 8
    lines and no attribution trailer.
- **Tests:**
  - test-driven, and each test is seen failing first;
  - integration runs against real PostgreSQL;
  - every repository method is probed with a foreign `tenant_id`;
  - `SET LOCAL` only, through `withTenant`.

## Review Focus

1. **Two tabs refreshing at once.** Both requests must succeed on one
   rotated refresh token. The loser must never replay the old token, which
   would trip reuse detection and revoke the whole grant.
2. **Callback forgery and replay.**
   - A callback whose `state` is not bound to this browser's login cookie is
     refused.
   - A second use of the same `state` is refused.
   - An `iss` naming another tenant is refused.
   - An ID token whose `nonce` differs is refused.
   - In every case no session is created.
3. **Open redirect through `return_to`.** `//evil`, `/\evil`,
   `https://evil`, `/console/../admin` and an encoded `%2F%2F` all fall back
   to `/console/`.
4. **An idle or absolute timeout reached mid-proxy, or a revoked grant,**
   answers `401` with a problem type the SPA recognises
   (`about:blank#console-session-ended`). It never answers `500`, and never
   forwards without a token.
5. **Upstream headers leaking or pointing at the wrong place.** A
   `Set-Cookie` from upstream is never passed to the browser. The browser's
   own `Cookie` and `Authorization` are never forwarded. `Link` and
   `Location` are rewritten into `/console/api/admin/`.

---

### Task 1: Spike the four load-bearing assumptions

**Files:**

- Create (throwaway, deleted before commit): `apps/server/tests/console-spike.int.test.ts`
- Modify: `docs/phases/p4d.md` (a "Part 2 spikes" section)

Four behaviours this plan builds on have never been exercised. Each spike
is a test that is run, recorded with `verified:` and the exact command, and
then deleted.

- [ ] **S1 — `inject` from inside an encapsulated plugin.** Register a plugin
      that, in its own route, calls `fastify.inject({ method: 'GET', url:
'/admin/tenants/:tenant/whoami', remoteAddress: request.ip, headers: { authorization } })`.
      Assert that it reaches the admin router registered by a sibling plugin,
      and that the admin audit row carries the forwarded ip.
  - `assumption:` a child instance's `inject` dispatches through the root
    router.
  - If it does not, the gateway takes the root instance as a dependency;
    record which.
- [ ] **S2 — refresh for `odudu-admin` without `offline_access`.** Following
      Part 1's audience spike, log in with `scope=openid` and
      `resource=urn:odudu:params:admin-api`, then refresh twice. Assert that a
      refresh token is issued, rotates, and keeps the admin audience.
  - Also assert what `/token` answers when the old refresh token is
    replayed after rotation (the reuse-detection behaviour that Review
    Focus 1 guards).
- [ ] **S3 — discovery through `inject`.** With `ODUDU_PUBLIC_BASE_URL` set,
      `GET /tenants/{t}/.well-known/openid-configuration` answers `issuer` =
      `${base}/tenants/{t}` whatever `Host` the inject sends.
  - Check: `grep -n "tenantIssuer" packages/protocol-oidc/src -r`.
- [ ] **S4 — logout with `id_token_hint` and a registered
      `post_logout_redirect_uri`.** The logout redirects there and ends the SSO
      session.
- [ ] Write the four results into `docs/phases/p4d.md` under "Part 2
      spikes", each with `verified: <command>`. Delete the spike file.
- [ ] Commit: `Record what the gateway's four spikes found`.

### Task 2: The package, its layer rules, and the import ban

**Files:**

- Create:
  - `packages/console-gateway/{package.json,tsconfig.json}`
  - `packages/console-gateway/src/index.ts`
  - `packages/console-gateway/src/service/return-to.ts` and its test
- Modify:
  - `.dependency-cruiser.cjs`
  - `tests/boundaries/` (the negative control)

**Interfaces:**

- Produces:
  - `@odudu/console-gateway`, following `packages/domain-audit/package.json`'s
    shape (the `#/*` imports and the `test` script with the trace
    reporter).
  - `safeReturnTo(value: string | undefined): string`, which returns a
    `/console/…` path or `/console/`.

- [ ] **Step 1: Failing tests.**
  - `safeReturnTo` passes `/console/tenants/acme/subjects?q=a`.
  - It refuses `//evil.example`, `/\evil`, `https://evil`,
    `/console/../admin`, `/console%2F..%2Fadmin`, `%2F%2Fevil`, an empty
    value and `undefined`.
  - A boundary fixture in which `console-gateway` imports
    `@odudu/protocol-oidc` fails the new rule.
- [ ] **Step 2: Implement.** Decode once, normalise with `path.posix`, then
      require the prefix `/console/` and no `\`.
  - Rule `console-gateway-imports-no-protocol`: from
    `^packages/console-gateway/`, the targets `^packages/(protocol-|authn-flows)`
    are forbidden.
  - The five-layer rules already match by path segment. Check:
    `grep -n "path" .dependency-cruiser.cjs | head`.
- [ ] **Step 3:** Run `pnpm exec vitest run --project unit tests/boundaries
packages/console-gateway` and `pnpm lint`. Both must pass.
- [ ] **Step 4:** Commit: `Add the console gateway package and its import ban`.

### Task 3: `console_sessions` and `console_logins`

**Files:**

- Create:
  - `packages/db/drizzle/<next>_console_sessions.sql` — take the number from
    `ls packages/db/drizzle | sort -V | tail -1`, then add one.
  - the journal entry
  - `packages/console-gateway/src/schema/console-sessions.ts`
  - `packages/console-gateway/src/repository/{console-sessions,console-logins}.ts`
  - `packages/console-gateway/tests/console-sessions.int.test.ts`
- Modify:
  - `apps/server/src/cli/reap.ts` (`TableName`, `RETENTION_RULES` and
    `REAP_ORDER`, which `assertReapOrder` holds to each other)
  - `apps/server/src/cli/reap.test.ts`

**Interfaces:**

- **Tables.** Both are tenant-scoped with `ENABLE` + `FORCE ROW LEVEL
SECURITY` and the `app.tenant_id` policy, as in `0066_tenant_smtp.sql`.
  - `console_sessions`:
    - `id uuid pk`
    - `tenant_id` → `tenants` (cascade)
    - `subject_id` → `subjects` (cascade)
    - `secret_hash bytea unique`
    - `access_token_wrapped`, `refresh_token_wrapped`, `id_token_wrapped`
      (all `text`)
    - `access_expires_at`, `created_at`, `last_seen_at`, `expires_at`
  - `console_logins`:
    - `id uuid pk`
    - `tenant_id`
    - `state_hash bytea unique`
    - `verifier_wrapped text`
    - `nonce text`
    - `return_to text`
    - `expires_at`
- **`consoleSessionRepository(tx)`:**
  - `create`
  - `bySecretHash(hash)`
  - `lockById(id)`, which takes `FOR UPDATE`
  - `touch(id, now)`
  - `replaceTokens(id, tokens)`
  - `delete(id)`
- **`consoleLoginRepository(tx)`:**
  - `create`
  - `takeByStateHash(hash, now)`, which does `DELETE … RETURNING` so a
    login is single-use and an expired one is not returned
- **Retention:**
  - `console_sessions`: delete where `expires_at < now` or
    `last_seen_at < now - 30 min`;
  - `console_logins`: delete where `expires_at < now`.

- [ ] **Step 1: Failing tests.**
  - Every repository method is probed with a foreign `tenant_id`.
  - `takeByStateHash` returns a row once and `null` the second time.
  - `rls-policy.int.test.ts` passes. It auto-discovers new tables: check
    with `grep -n "RLS_EXEMPT_TABLES" packages/db/tests/rls-policy.int.test.ts`.
  - `schema-drift.int.test.ts` passes with the new `pgTable` declarations.
  - A reap test deletes one expired session, one idle session and one
    expired login, and keeps a live one of each.
- [ ] **Step 2:** Implement, run, see it pass.
- [ ] **Step 3:** Commit: `Add console session and pending-login tables`.

### Task 4: Configuration, the redirect URI and `odudu console provision`

**Files:**

- Modify:
  - `packages/kernel/src/config.ts`: `ODUDU_CONSOLE`, and
    `ODUDU_CONSOLE_DIR` (the built SPA's directory, default
    `/app/console`)
  - `apps/server/src/config-guard.ts`: `assertConsoleConfigured`
  - `packages/protocol-oidc/src/usecase/provision-admin-client.ts`
  - `apps/server/src/main.ts`
- Create:
  - `apps/server/src/cli/console.ts` and its integration test

**Interfaces:**

- `provisionAdminClient(tx, tenantId, options)` gains
  `options.consoleBaseUrl?: string`. When it is set, the admin client's
  `redirect_uris` and `post_logout_redirect_uris` are updated as follows,
  whether the row was just created or already existed:
  - an entry whose path is `/console/auth/callback` (or `/console/`) is
    replaced by the current value;
  - every other entry, the loopback URI included, is kept.

  This closes a gap measured in Part 2's research:
  `provisionOidcConfig` (`provision-admin-client.ts:36-52`) returns early
  when the row exists, so a changed base URL was never corrected.

- Every caller passes `config.ODUDU_PUBLIC_BASE_URL` when the console is
  on:
  - `protocol-admin/src/usecase/tenants.ts`
  - `seed.ts` in `seed admin` and in `seed tenant` (`runTenantCommand`)
  - the bootstrap path

  Find them with `grep -rn "provisionAdminClient(" packages apps --include=*.ts | grep -v test`.

- `odudu console provision` runs `provisionAdminClient` over every tenant
  and prints `provisioned <n> tenants`.
- `assertConsoleConfigured(config)` also refuses an `https` base with
  `ODUDU_TRUST_PROXY` off: the issuer is built from the request's scheme
  and host (`packages/protocol-oidc/src/view/issuer.ts:50`), an injected
  request's socket is never encrypted, so only a trusted
  `x-forwarded-proto` can make an in-process call see the `https` issuer
  the browser sees (Part 2 spike S3).
- `assertConsoleConfigured(config)` throws
  `OduduError('config_invalid', …)`, naming `ODUDU_PUBLIC_BASE_URL` and
  `ODUDU_CONSOLE=false`, when the console is on and the base URL is unset.
- Spec §5.5's "`seed tenant` does not provision it" is stale: 43c24a9
  already made it provision (`sed -n '960,980p' apps/server/src/cli/seed.ts`).
  Amend the sentence in the spec in this task.

- [ ] **Step 1: Failing tests.**
  - The config guard refuses to start without the base URL and names both
    variables.
  - It passes with `ODUDU_CONSOLE=false`.
  - Provisioning a new tenant writes both URIs.
  - Re-running with a changed base URL replaces them and keeps the
    loopback.
  - `odudu console provision` corrects two tenants seeded under an old
    base URL.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Document:
  - README "Configuration" gets both variables and the command.
  - `docs/admin-paths.md` states the admin client's registered URIs.
- [ ] **Step 4:** Commit: `Register the console's redirect on every admin client`.

### Task 5: ID-token verification that returns its claims

**Files:**

- Modify: `packages/crypto/src/service/jwk-set-verify.ts` and its test,
  `packages/crypto/src/index.ts`

**Interfaces:**

- `verifyJwtClaims(token: string, jwks: unknown, opts: { issuer: string;
audience: string; now: Date; algorithms: readonly ('RS256'|'ES256')[] }):
Promise<Record<string, unknown> | null>`
  - It returns `null` on every failure.
- `verifyJwtAgainstJwkSet` becomes a one-line wrapper over it, and its
  existing tests stay green.
- Check the current shape with
  `sed -n '1,60p' packages/crypto/src/service/jwk-set-verify.ts`.

- [ ] **Step 1: Failing tests.** Each of these returns `null`:
  - a wrong issuer
  - a wrong audience
  - an expired token
  - an `alg: none` token
  - a token signed by a key absent from the set

  A good token returns its `nonce` and `sub`.

- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Return verified claims from a JWK-set check`.

### Task 6: Login and callback

**Files:**

- Create in `packages/console-gateway/src/`:
  - `adapter/odudu-client.ts`: discovery, token, revoke, certs and admin
    calls, all through `inject`
  - `service/pkce.ts`
  - `service/cookies.ts`
  - `usecase/begin-login.ts`
  - `usecase/complete-login.ts`
  - `view/routes/auth.ts`
  - `index.ts`, exporting `consoleGateway(deps): FastifyPluginAsync`
- Test:
  - unit tests beside each service
  - `apps/server/tests/console-login.int.test.ts`

  Integration tests live in `apps/server`, because a full app is only
  buildable there through `#/app`. `@odudu/testkit` has no app builder:
  `grep -n export packages/testkit/src/index.ts`.

- Modify: `apps/server/src/app.ts` registers `consoleGateway` when
  `ODUDU_CONSOLE` is on.

**Interfaces:**

- `consoleGateway({ database, kek, publicBaseUrl, tls, consoleDir, now })`
- **Every inject carries the base's authority, never the browser's:**
  `host` and `x-forwarded-host` = the base URL's host,
  `x-forwarded-proto` = its scheme, `remoteAddress` = `request.ip`. The
  issuer is derived from `Host` server-wide (spike S3), so this is what
  keeps the callback `iss`, the ID token's `iss` and the admin API's
  issuer check on one string; a test injects the browser request with
  `Host: evil.example` and asserts the flow still completes against the
  base's issuer.
- The code exchange's `id_token` is kept for the session's life: a
  refresh response carries none (spike S2), and logout needs it as the
  hint.
- **`GET /console/auth/login?tenant=&return_to=`:**
  - it validates `tenant` against `isValidTenantName`
    (`@odudu/domain-tenant`; grep that the export exists — it is a domain
    package, allowed);
  - it stores a `console_logins` row;
  - it sets a login cookie (`__Host-odudu-console-login`, or
    `odudu-console-login` over plain HTTP; `Path=/console/auth`,
    `Max-Age=600`, `SameSite=Lax`) whose value is the state;
  - it answers `302` to `/tenants/{t}/protocol/openid-connect/auth` with
    `response_type=code`, `client_id=odudu-admin`, `redirect_uri`,
    `scope=openid`, `resource=urn:odudu:params:admin-api`, `state`,
    `nonce`, `code_challenge` and `code_challenge_method=S256`.
- **The state** is `<tenant_id>.<random>`, so the callback can set tenant
  context before reading the login row. Only the state's hash is stored.
- **`GET /console/auth/callback?code&state&iss`:**
  - the state must equal the login cookie;
  - `takeByStateHash` succeeds;
  - `iss` equals the discovered issuer;
  - the code is exchanged with the verifier and `resource`;
  - the ID token's issuer, `aud=odudu-admin`, expiry and `nonce` are
    verified against the tenant's JWKS;
  - the session row is written and the cookie is set;
  - the login cookie is cleared;
  - the response is `302` to `safeReturnTo(return_to)`;
  - an `error=` callback from the OP answers `302` to
    `/console/?login_error=<error>`, where only the OP's error code
    survives.
- **Every refusal** is `400` with a plain page carrying no detail beyond
  "sign-in could not be completed". It creates no session and leaks no
  token.

- [ ] **Step 1: Failing integration tests**, run through `inject` with a
      seeded tenant and administrator:
  - the full happy path yields a session row and cookie, and
    `/console/api/session` answers the subject;
  - each of these is refused with no row: a missing or mismatched login
    cookie, a replayed state, an expired login (`now` + 11 min), `iss` of
    another tenant, and a tampered nonce;
  - an OP `error=access_denied` is handled as above.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Sign an administrator in to the console`.

### Task 7: The session, its cookie and CSRF

**Files:**

- Create in `packages/console-gateway/src/`:
  - `usecase/resolve-session.ts`
  - `service/csrf.ts`
  - `view/routes/session.ts`
- Test: unit tests, and `apps/server/tests/console-session.int.test.ts`

**Interfaces:**

- `resolveSession(cookieHeader, now)` returns one of:
  - `{ kind: 'ok', session }`, touching `last_seen_at` at most once a
    minute;
  - `{ kind: 'ended' }`, for a missing, unknown, idle or absolute session;
    an ended row is deleted.
- **`GET /console/api/session`** answers
  `{ tenant, subject_id, username }`; `401` is the `console-session-ended`
  problem.
- **`csrfRefusal(request, origin)`** returns `null` or a reason. It applies
  to any method other than GET, HEAD or OPTIONS.

- [ ] **Step 1: Failing tests.**
  - An idle session at 30 min + 1 s has ended and its row is gone.
  - An absolute session at 12 h has ended.
  - A foreign-tenant cookie prefix finds nothing.
  - A POST without `Origin`, with another origin, or without
    `X-Odudu-Console: 1` is `403` and nothing is forwarded.
  - The cookie attributes under TLS and under plain HTTP match Global
    Constraints.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Resolve console sessions and refuse cross-site writes`.

### Task 8: The proxy, and refresh under contention

**Files:**

- Create in `packages/console-gateway/src/`:
  - `usecase/forward.ts`
  - `usecase/fresh-access-token.ts`
  - `service/rewrite.ts`
  - `view/routes/proxy.ts`
- Test: unit tests for `rewrite`, and
  `apps/server/tests/console-proxy.int.test.ts`

**Interfaces:**

- **`* /console/api/admin/*`** forwards to `/admin/*` with the query string
  and body.
  - It sends `Authorization: Bearer <access>` and
    `remoteAddress = request.ip`, plus only these request headers:
    `content-type`, `if-match`, `if-none-match`, `accept`.
  - It passes back the status, the body, and only these response headers:
    `content-type`, `etag`, `location`, `link`, `cache-control`.
  - `location` and `link` are rewritten from `/admin/` to
    `/console/api/admin/`.
  - The route's `bodyLimit` equals the admin import's. Check with
    `grep -rn "bodyLimit" packages/protocol-admin/src`.
- **`freshAccessToken(session, now)`:**
  - Outside the 30 s window, it returns the stored token.
  - Inside it, the usecase opens `withTenant`, takes `lockById`, re-reads,
    and refreshes only if the token is still stale. Otherwise another
    request already refreshed it, and it uses that token.
  - A refused refresh deletes the session and ends in `401` with
    `console-session-ended`.

- [ ] **Step 1: Failing tests.**
  - GET, POST, PATCH with `If-Match`, and DELETE round-trip, keeping status,
    ETag and problem+json.
  - A `Link` `next` is rewritten.
  - The browser's `Cookie` and `Authorization` are not forwarded: assert
    what upstream saw through an audit row or a spy route.
  - An upstream `Set-Cookie` is dropped.
  - **The refresh race:** two concurrent forwards at `access_expires_at -
10 s` both succeed, `/token` is called once, and the grant is not
    revoked (Review Focus 1).
  - A revoked grant ends the session with `401`.
  - A 16 MiB import body is accepted and one byte over is `413`.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Forward the console's admin calls and refresh once per session`.

### Task 9: Logout

**Files:**

- Create in `packages/console-gateway/src/`: `usecase/logout.ts`,
  `view/routes/logout.ts`
- Test: `apps/server/tests/console-logout.int.test.ts`
- Modify: spec §5.1

**Interfaces:**

- **`POST /console/auth/logout`** (CSRF-checked):
  - revokes the refresh token through `/revoke`;
  - deletes the session;
  - clears the cookie;
  - answers `200 { "redirect": "<issuer>/protocol/openid-connect/logout?id_token_hint=…&post_logout_redirect_uri=<base>/console/&client_id=odudu-admin" }`.
- **Ruling (amends §5.1): a JSON body carrying the redirect, not a `302`.**
  The CSRF rule needs a custom header, so logout is a `fetch`. A `fetch`
  that follows a cross-path redirect cannot navigate the page, so the SPA
  navigates itself. Record this in the spec in this task.

- [ ] **Step 1: Failing tests.**
  - After logout, the refresh token answers `invalid_grant` and the session
    row is gone.
  - Following the returned URL **with the tenant's SSO cookie** ends the
    SSO session and redirects to `/console/`; the same URL without the
    cookie also answers 302 but ends nothing (spike S4), so the test
    asserts the session row is expired and the old cookie meets the login
    form.
  - A logout without CSRF headers is `403` and the session survives.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Sign an administrator out of the console and the tenant`.

### Task 10: Serving the SPA shell

**Files:**

- Create in `packages/console-gateway/src/view/`:
  - `spa.ts`, the one function that sets this shell's headers
  - `spa.test.ts`
- Test fixture: `packages/console-gateway/tests/fixtures/dist/{index.html,assets/app-3f2a.js}`
- Modify: `packages/protocol-oidc/src/view/html-response.test.ts`, adding
  `spa.ts` to `EXEMPT_FILES`. This is the spec's third authorised header
  site. Check the list with
  `grep -n EXEMPT_FILES packages/protocol-oidc/src/view/html-response.test.ts`.

**Interfaces:**

- `spaRoutes(consoleDir)` reads the directory once at registration.
  - Anything under `assets/` is served from the manifest with its
    content-type and `immutable`. An unknown asset is `404`.
  - Every other `GET /console/*` serves `index.html` with the CSP set,
    except `/console/api/*` and `/console/auth/*`.
  - A missing directory: boot logs one `warn` naming `ODUDU_CONSOLE_DIR`,
    and `/console/*` answers `503` with a plain note. The auth and API
    routes still work, which the Vite dev proxy needs.
- No new dependency. `@fastify/static` is absent
  (`grep -rn "@fastify/static" --include=package.json . | grep -v node_modules`),
  and a directory of hashed files read at boot needs one map.

- [ ] **Step 1: Failing tests.**
  - `/console/tenants/x` serves index.html with the exact CSP and
    `no-store`.
  - An asset has the right content-type and `immutable`.
  - Path traversal (`/console/assets/../../etc/passwd`, including encoded
    forms) is `404`.
  - The walk in `html-response.test.ts` still passes.
- [ ] **Step 2:** Implement and run.
- [ ] **Step 3:** Commit: `Serve the console shell under its own CSP`.

### Task 11: Document the gateway

**Files:**

- Create: `docs/console-paths.md`, the gateway transcripts
- Modify: `README.md`, `docs/request-paths.md` (one pointer),
  `docs/phases/p4d.md`, `docs/NEXT.md`

- [ ] **Transcripts.** Capture them against `docker-odudu-1`, rebuilding
      only the `odudu` service:
  - login redirect → OP login → callback → `/console/api/session` → a
    proxied `GET /console/api/admin/tenants/{t}/subjects` → a refused
    cross-origin POST → logout;
  - each response block carries no language tag;
  - cookies and tokens are shown only for a throwaway tenant.
- [ ] **A `tests/docs` check** that every route in `docs/console-paths.md`
      exists on the server, following `tests/docs/admin-paths.test.ts`'s
      pattern.
- [ ] **Phase note:** what building the gateway found.
- [ ] **NEXT.md:** Part 2 landed, and what Part 3 inherits.
- [ ] Commit: `Document the console gateway`.

---

## Closing Part 2

- [ ] `pnpm verify` and `pnpm trace` are both green; CI and CodeRabbit are
      answered on every pushed increment.
- [ ] The final whole-branch review of Part 2's range runs on the most
      capable model, followed by its fix round.
- [ ] Write Part 3's plan (the console foundation) before starting it.

**Increments (push points):**

| Increment | Tasks | Covers                          |
| --------- | ----- | ------------------------------- |
| F         | 1–3   | spikes, package, tables         |
| G         | 4–5   | config and provisioning, claims |
| H         | 6–7   | login and session               |
| I         | 8–9   | proxy and logout                |
| J         | 10–11 | SPA shell and docs              |
