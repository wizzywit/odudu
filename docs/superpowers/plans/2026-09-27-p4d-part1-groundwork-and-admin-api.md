# P4d, Part 1 — Groundwork and the Completed Admin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land CI caching, the two ADRs and the spikes, then make the admin
API complete: tenant names constrained, `whoami` capabilities, server-side
search and filters with bound cursors, bounded counts, every configuration
gap in spec §4.5 rows 1–13, and tenant export and import.

**Architecture:** Every addition follows the shape P4c established: an
`ADMIN_ROUTES` entry (`packages/protocol-admin/src/service/capability.ts`),
a contract schema in `@odudu/contracts/admin`, a handler in
`packages/protocol-admin/src/view/routes/`, a usecase taking a
`TenantScopedDatabase`, a repository method in the owning domain package,
and an `admin_mutation` row written in the same transaction. OpenAPI and
the capability matrix are derived from `ADMIN_ROUTES`, so the table entry
is what registers a route with both.

**Tech Stack:** TypeScript 6, Fastify 5, Drizzle over PostgreSQL 17, Zod 4,
Vitest 5 with Testcontainers, pnpm 12 and Turborepo 2.

**Spec:** `docs/superpowers/specs/2026-09-26-p4d-admin-console-design.md`.
This is Part 1 of four. Part 2 (the console gateway), Part 3 (the console
foundation) and Part 4 (the console's features) are written when Task 3's
spikes have answered what they depend on, so that no library behaviour is
written into a plan as fact before it has been run.

## Global Constraints

- `CLAUDE.md` applies in full: no `any`; no `void` statements; comment
  blocks of eight lines or fewer; no development-process references in
  comments (no "Task 12", "Part 1", "the brief", "spec §4.5 row 6" — name
  the thing); `SET LOCAL` semantics only; no tool-attribution trailer in a
  commit message; subject ≤ 72 characters, body reading as ≤ 8 lines.
- Tests precede implementation, and each is run and seen failing first.
- Integration tests run against real PostgreSQL through
  `startAdminFixture()` (`packages/protocol-admin/src/testing/admin-fixture.ts`)
  or `startTestDatabase()` (`@odudu/testkit`). No database mocks.
- Every new repository method is probed with a foreign `tenant_id` through
  `expectCrossTenantMethodProbe` (`@odudu/db/testing`).
- A new migration is a hand-written `packages/db/drizzle/NNNN_<name>.sql`
  plus its `_journal.json` entry (`idx` +1, `when` +1 on the last). Take the
  next free number at the time (`ls packages/db/drizzle`); the numbers in
  this plan are the expected ones. A new `CHECK` is added verbatim to
  `EXPECTED_CHECKS` in `packages/db/tests/schema-drift.int.test.ts`; a new
  table gets `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy whose
  `USING` reads `app.tenant_id`, which `packages/db/tests/rls-policy.int.test.ts`
  enforces. Grants need nothing: `0001` sets default privileges.
- A new route's capability obeys the capability matrix's family rule
  (`packages/protocol-admin/tests/capability-matrix.int.test.ts`): every
  route under a family shares one capability, or a view/manage pair with
  `GET` on the view side; a route without `:tenant` admits only
  `manage-tenants`; a route with a required body needs a `SAMPLE_BODIES`
  entry.
- A new route needs two edits to `docs/admin-paths.md`, both checked by
  `tests/docs/`: a row in the `Method | Path | What it is` table
  (`endpoints.test.ts`) and a section whose heading backticks
  `` `METHOD /tail` `` and which backticks the route's capability
  (`admin-paths.test.ts`). The section carries a transcript executed
  against a running stack (`infra/docker`), never written by hand.
- Every `If-Match` a route makes mandatory answers `428` through
  `ifMatchRequired(resource)` and a stale one `412` through `ifMatchStale()`
  (`packages/protocol-admin/src/view/problem.ts`), computed with
  `requiredPrecondition` (`service/etag.ts`) under a row lock taken first.
- A secret the server generates — a registration token, a one-time
  password, an imported client's secret — appears in exactly one response
  body, is never logged, and never reaches an audit `detail`.
- Each increment ends pushed, with the draft PR open, CI green, and the
  review that push attracted answered (`CLAUDE.md`, "CI runs on the
  branch").

## Review Focus

1. **Joining a group grants that group's roles.** `PUT …/subjects/{id}/groups`
   must refuse a membership whose roles reach a capability the caller does
   not hold, exactly as `PUT …/subjects/{id}/roles` refuses one today
   (`usecase/subjects.ts`, the `refused` branch before `subject.roles_set`).
   Otherwise `manage-users` escalates itself to `tenant-admin` by joining a
   group. Task 14 pins it.
2. **A cursor carried from one search into another.** A `next` link minted
   under `?username=ad` replayed with `?username=zz`, or with the filter
   dropped, must answer `400` rather than page a different list from the
   wrong position. Task 7 pins it.
3. **Search text holding `%`, `_` or `\`.** `?username=a_b` must match only
   names beginning `a_b`, and `?username=%` must match only names beginning
   with a literal `%`. Task 8 pins it.
4. **An import naming a tenant that exists, or a name the constraint
   refuses.** Either must answer before any row is written, and leave no
   half-created tenant. Task 23 pins it.
5. **A username renamed to one that differs only by case, or to the
   subject's own current name.** Uniqueness is what the `users` unique
   index enforces, so a case-variant is a different name unless the index
   says otherwise, and a rename to the same value is a no-op writing no
   audit row. Task 21 pins both.

---

## File structure

| Path                                                                | Responsibility                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `turbo.json`, `package.json`, every tested package's `package.json` | `test` as a cached per-package Turbo task                         |
| `tests/package.json`, `pnpm-workspace.yaml`                         | the root checks as a workspace package so Turbo can cache them    |
| `tools/trace/src/index.ts`, `tools/trace/src/suite.ts`              | read every package's `trace-report.json`                          |
| `.github/workflows/verify.yml`                                      | restore and save Turbo's cache                                    |
| `docs/adr/0038-the-admin-console-and-its-gateway.md`                | stack and BFF decision                                            |
| `docs/adr/0039-names-relying-parties-match-on-are-identifiers.md`   | rename decision                                                   |
| `docs/phases/p4d.md`                                                | the phase's running notes, spike results first                    |
| `packages/domain-tenant/src/service/tenant-name.ts`                 | `isValidTenantName`, `TENANT_NAME_RULE`                           |
| `packages/protocol-admin/src/service/cursor.ts`                     | cursor payload with sort value and filter digest                  |
| `packages/protocol-admin/src/service/list-query.ts`                 | prefix escaping, field-scoped search, exact-filter parsing        |
| `packages/protocol-admin/src/usecase/counts.ts`                     | bounded counts over every countable collection                    |
| `packages/protocol-admin/src/usecase/registration-tokens.ts`        | mint, list, revoke                                                |
| `packages/protocol-admin/src/usecase/profile.ts`                    | a subject's profile claims                                        |
| `packages/protocol-admin/src/usecase/consents.ts`                   | a subject's consents                                              |
| `packages/protocol-admin/src/usecase/account-recovery.ts`           | one-time password, lockout clear                                  |
| `packages/protocol-admin/src/usecase/tenant-export.ts`              | export document assembly                                          |
| `packages/protocol-admin/src/usecase/tenant-import.ts`              | validation and creation                                           |
| `packages/contracts/src/admin/tenant-document.ts`                   | the versioned export document schema, shared by export and import |
| `packages/protocol-admin/src/view/routes/*.ts`                      | one handler file per resource family, as today                    |

---

## Increment A — Groundwork

### Task 1: `test` as a cached per-package Turbo task

**Files:**

- Modify: `turbo.json`, `package.json` (root scripts), `pnpm-workspace.yaml`,
  `.github/workflows/verify.yml`, `tools/trace/src/index.ts`,
  `tools/trace/src/suite.ts`, every `packages/*/package.json`,
  `apps/server/package.json`, `tools/*/package.json` that holds tests
- Create: `tests/package.json`
- Test: `tools/trace/src/suite.test.ts`

**Interfaces:**

- Produces: `readSuites(reportPaths: readonly string[]): Promise<TestResult[]>`
  in `tools/trace/src/suite.ts`, replacing single-file use of `readSuite`;
  `pnpm test` = `turbo run test`; each package writes
  `<package>/trace-report.json`.

- [ ] **Step 1: Record the baseline.** Run `pnpm verify` on `main`'s tip,
      and read the last three `verify` job durations from
      `gh run list --workflow verify.yml --limit 3 --json databaseId,updatedAt,startedAt`.
      Write both into a new `docs/phases/p4d.md` under "CI caching".

- [ ] **Step 2: Write the failing test** `readSuites merges several reports`
      in `tools/trace/src/suite.test.ts`: two report files written to a temp
      directory, one assertion result each, expect `readSuites([a, b])` to
      return both results in input order, and expect a missing file to reject
      naming its path.

- [ ] **Step 3: Run it.** `pnpm vitest run tools/trace/src/suite.test.ts` —
      FAIL, `readSuites` is not exported.

- [ ] **Step 4: Implement `readSuites`** over the existing `readSuite`, and
      change `tools/trace/src/index.ts` to take every path in `process.argv`
      after the script, defaulting to the result of globbing
      `{packages,apps,tools}/*/trace-report.json` and `tests/trace-report.json`
      with `node:fs/promises`' `glob`.

- [ ] **Step 5: Run it.** Same command — PASS.

- [ ] **Step 6: Make the root checks a package.** `tests/package.json`
      named `@odudu/repo-checks`, private, `"type": "module"`, with a `test`
      script; add `'tests'` to `pnpm-workspace.yaml`'s `packages`.

- [ ] **Step 7: Give every tested package a `test` script** that runs the
      root config over that package alone and writes its own report:
      `vitest run --config ../../vitest.config.ts --dir . --reporter=default --reporter=json --outputFile=trace-report.json`
      (`../vitest.config.ts` from `tests/`). `assumption:` Vitest 5's `--dir`
      narrows the root config's project globs to the package; verify by
      running the script in `packages/kernel` and confirming the reported file
      count equals `ls packages/kernel/src/**/*.test.ts | wc -l` plus its
      integration files. If `--dir` does not narrow them, give each package a
      three-line `vitest.config.ts` importing a shared factory from the root
      instead, and record which in `docs/phases/p4d.md`.

- [ ] **Step 8: Declare the task in `turbo.json`:**
      `"test": { "dependsOn": ["^typecheck"], "inputs": ["src/**", "tests/**", "drizzle/**", "package.json", "tsconfig.json"], "outputs": ["trace-report.json"] }`,
      and top-level `"globalDependencies": ["vitest.config.ts", "tsconfig.base.json", "pnpm-lock.yaml", "tests/setup/**", "eslint.config.js"]`.
      Root scripts: `"test": "turbo run test"`, `"trace"` without its argument.
      Add `trace-report.json` under packages to `.gitignore` (the root entry is
      already there).

- [ ] **Step 9: Verify the cache is correct, not just fast.** Run
      `pnpm test` twice; the second must report every task `cache hit`. Then
      touch a comment in `packages/kernel/src/clock.ts` and run
      `pnpm turbo run test --dry=json`: every package depending on
      `@odudu/kernel` must show `"cache": {"status": "MISS"}` and a package that
      does not (`tools/commit-message`) `HIT`. `assumption:` a `^typecheck`
      dependency carries an upstream package's source into the downstream
      hash; this step is what verifies it, and if it does not, add `"^test"`
      instead and record the cost.

- [ ] **Step 10: Bound concurrent databases.** Integration projects run one
      Testcontainers PostgreSQL per package process. Run `pnpm test` and
      record peak `docker ps | wc -l`; if more than four containers run at once
      or any integration file times out, set `--concurrency=4` on the root
      `test` script and record why.

- [ ] **Step 11: Cache in CI.** In `verify.yml`, before `pnpm verify`, an
      `actions/cache@v6` step on `.turbo/cache` keyed
      `turbo-${{ runner.os }}-${{ github.sha }}` with restore key
      `turbo-${{ runner.os }}-`, and `TURBO_CACHE_DIR=.turbo/cache` in the
      job's `env`. Replace the timeout comment with one naming what bounds the
      job now.

- [ ] **Step 12: Run `pnpm verify` and `pnpm trace`** — both green, and
      `pnpm trace` reporting the same MUST count as on `main` (it reads the
      same results from more files).

- [ ] **Step 13: Commit** `Cache the test suite per package with Turborepo`.
      After CI runs twice on the PR (push an empty-diff doc fix if needed),
      record the second run's `verify` duration in `docs/phases/p4d.md` and
      remove the CI-caching entry from `docs/NEXT.md`'s "Work owed".

### Task 2: ADR 0038 and ADR 0039

**Files:**

- Create: `docs/adr/0038-the-admin-console-and-its-gateway.md`,
  `docs/adr/0039-names-relying-parties-match-on-are-identifiers.md`
- Modify: `docs/adr/README.md` (the index), `docs/superpowers/specs/2026-09-10-odudu-design.md` §2's decisions table

- [ ] **Step 1: Write ADR 0038** in the existing ADR shape (`Status`,
      `Context`, `Decision`, `Consequences`), Accepted, 2026-09-27. Decision:
      React 19.3, Vite SPA served by `apps/server`, TanStack Router and Query,
      React Aria Components, CSS Modules over custom-property tokens, Zustand
      under the state table of spec §6.4; a backend-for-frontend holding every
      token server-side. Rejected, each with its reason from the spec: Tailwind
      v4, vanilla-extract, Next.js, React Router's framework mode, an
      in-browser OAuth client, a token-mediating backend. Cite RFC 10017.
      Consequence: the layer rule is by path segment, folder or single file
      (spec §6.2), and React naming holds inside `apps/admin-console` only.

- [ ] **Step 2: Write ADR 0039.** Role, scope, group and tenant names are
      identifiers relying parties match on and are immutable; usernames are
      not, because OIDC Core makes `iss` + `sub` the only stable identifier and
      Odudu's `sub` is the subject id (`packages/protocol-oidc/src/service/claims.ts:31`),
      so a username is renamable behind `username_editable`. Cite Keycloak's
      "Edit username", off by default, and the Entra app-role case for why
      role values are not.

- [ ] **Step 3: Index them** in `docs/adr/README.md` and the design spec's
      §2 table (rows for "Console" and "Names").

- [ ] **Step 4: Run** `pnpm vitest run --project unit tests/docs` — PASS
      (`references.test.ts` resolves the new links).

- [ ] **Step 5: Commit** `Record the console's stack and which names are identifiers`.

### Task 3: Spikes

Throwaway code under `.superpowers/spikes/` (gitignored); only the findings
are committed, to `docs/phases/p4d.md` under "Spikes", each with the exact
command run and its output, so Parts 2 and 3 cite `verified:` instead of
`assumption:`.

- [ ] **Step 1: `inject` and the client address.** In a scratch Fastify 5.12
      app with `trustProxy: false`, call `app.inject({ remoteAddress: '203.0.113.9', … })`
      on a route returning `request.ip`. Record whether it answers
      `203.0.113.9`. Repeat with `trustProxy: true` and an `x-forwarded-for`.

- [ ] **Step 2: Vite and inline script.** `pnpm create vite` a React-TS app at
      the Vite version Part 3 would pin; `vite build`; grep `dist/index.html`
      for `<script>` without `src` and for `style=`. Record both counts, and
      whether `build.modulePreload.polyfill: false` changes them.

- [ ] **Step 3: React Aria under a strict CSP.** In that app, render a
      React Aria `Dialog` and `ComboBox`, serve `dist/` with
      `style-src 'self'; script-src 'self'`, open it in the in-app browser and
      read the console for CSP violations while opening both.

- [ ] **Step 4: Prefix search as one range scan.** In a Testcontainers
      PostgreSQL, create a `users`-shaped table with RLS forced and a policy on
      `app.tenant_id`, 200 000 rows over 5 tenants, an index
      `(tenant_id, lower(username) text_pattern_ops, id)`; under
      `SET LOCAL app.tenant_id` run
      `EXPLAIN (ANALYZE, BUFFERS) SELECT … WHERE lower(username) LIKE 'ad%' AND (lower(username), id) > ('adz', '<uuid>') ORDER BY lower(username), id LIMIT 51`.
      Record the plan. Pass condition: an Index Scan on that index with no
      Sort node. If the row comparison defeats the index, record the
      expanded form `lower(username) > $1 OR (lower(username) = $1 AND id > $2)`
      and re-run.

- [ ] **Step 5: The admin audience on refresh.** Against the admin fixture,
      complete a code exchange for `odudu-admin` with
      `resource=urn:odudu:params:admin-api`, refresh with and without
      `resource`, decode each access token's `aud`, and record all three.

- [ ] **Step 6: Commit** `Record what the P4d spikes found` (findings only).

---

## Increment B — Names, `whoami` and the seed gap

### Task 4: Tenant names are DNS labels

**Files:**

- Create: `packages/domain-tenant/src/service/tenant-name.ts`,
  `packages/db/drizzle/0072_tenant_name_rule.sql`
- Modify: `packages/domain-tenant/src/index.ts`,
  `packages/protocol-admin/src/usecase/tenants.ts:111-167`,
  `packages/protocol-admin/src/view/routes/tenants.ts` (`createTenantHandler`),
  `apps/server/src/cli/seed.ts` (`runTenantCommand`, ~line 889),
  `packages/db/tests/schema-drift.int.test.ts` (`EXPECTED_CHECKS`),
  `packages/db/src/schema/tenants.ts`, `docs/admin-paths.md`, `README.md`
- Test: `packages/domain-tenant/src/service/tenant-name.test.ts`,
  `packages/domain-tenant/tests/tenant-name-check.int.test.ts`,
  `packages/protocol-admin/tests/tenants.int.test.ts`, the seed CLI's test

**Interfaces:**

- Produces: `isValidTenantName(name: string): boolean`;
  `TENANT_NAME_RULE: string` (the one sentence every refusal answers);
  `RESERVED_TENANT_NAMES = ['system', 'count']` with `isReservedTenantName`
  replacing `isSystemTenantName` at the two creation doors — `count`
  because `GET /admin/tenants/count` would otherwise shadow
  `GET /admin/tenants/count` the tenant; `CreateTenantOutcome` gains
  `{ kind: 'name_invalid' }`.

- [ ] **Step 1: Write the failing unit test** over a shared corpus exported
      from the test file's own `const CORPUS`: accepted `a`, `acme`, `a1`,
      `a-b`, `x` repeated 63; refused `''`, `-a`, `a-`, `A`, `a_b`, `a/b`,
      `a.b`, `a b`, `x` repeated 64, `ä`.

- [ ] **Step 2: Run it** — FAIL, module missing.

- [ ] **Step 3: Implement** with this pattern, which the migration's
      `CHECK` repeats exactly:

  ```
  ^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$
  ```

- [ ] **Step 4: Run it** — PASS.

- [ ] **Step 5: Write the failing integration test** that inserts each
      corpus name into `tenants` through the owner connection and expects the
      database to accept exactly those `isValidTenantName` accepts.

- [ ] **Step 6: Migration** `0072`: `ALTER TABLE tenants ADD CONSTRAINT tenants_name_dns_label CHECK (name ~ '<the pattern above>');`
      plus the `EXPECTED_CHECKS` entry verbatim as `pg_get_constraintdef`
      prints it (run the drift test once to read it). Run both tests — PASS.

- [ ] **Step 7: Write failing tests** `POST /admin/tenants` with `Acme`
      answers `400` with `TENANT_NAME_RULE` as its detail and creates nothing;
      `count` answers `409` as `system` does; `seed tenant --name Acme` exits
      non-zero naming the rule.

- [ ] **Step 8: Refuse through the predicate** before the `system` check in
      `createTenant` and `runTenantCommand`; map `name_invalid` to
      `problem(400, 'about:blank', 'Bad Request', TENANT_NAME_RULE)`. Run — PASS.

- [ ] **Step 9: Document** under `## POST /admin/tenants` with the refusal's
      transcript, and remove the tenant-name row from `docs/NEXT.md`'s
      "Argued elsewhere" table. Commit `Constrain tenant names to DNS labels`.

### Task 5: `seed tenant` provisions the admin client

**Files:**

- Modify: `apps/server/src/cli/seed.ts` (`runTenantCommand`),
  `README.md` (the `seed tenant` section)
- Test: the seed CLI's integration test file

- [ ] **Step 1: Write the failing test** `seed tenant creates the built-in admin client`:
      after `seed tenant --name acme`, `clientRepository(tx).byClientId('odudu-admin')`
      is non-null with `builtinAdmin: true`, and `tenant-admin` exists as a role
      on it. A second run leaves exactly one such client.

- [ ] **Step 2: Run it** — FAIL.

- [ ] **Step 3: Call `provisionAdminClient(tx, tenantId)`** in the
      newly-created branch, beside `provisionTenant`, with no `crossTenant`.

- [ ] **Step 4: Run it** — PASS. Commit `Provision the admin client when seeding a tenant`.

### Task 6: `whoami` reports capabilities

**Files:**

- Create: `packages/contracts/src/admin/whoami.ts`
- Modify: `packages/contracts/src/admin/index.ts`,
  `packages/protocol-admin/src/service/capability.ts:98-103`,
  `packages/protocol-admin/src/view/routes/whoami.ts`,
  `packages/protocol-admin/src/index.ts` (`callerCapabilities`, ~246-255;
  the handler map, ~337), `docs/admin-paths.md` (`## GET /whoami`)
- Test: `packages/protocol-admin/tests/whoami.int.test.ts`

**Interfaces:**

- Produces: `whoamiResponseSchema = z.object({ subjectId: z.string(), issuerTenantId: z.string(), capabilities: z.array(z.string()), crossTenant: z.boolean() })`;
  `whoamiHandler(deps: { callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>> })`.

- [ ] **Step 1: Write failing tests:** a tenant admin holding `view-users`
      sees `capabilities: ['view-users']`, `crossTenant: false`; a holder of
      `manage-users` sees both `manage-users` and `view-users` (the composite);
      a system admin with `manage-tenants` and `view-audit` calling
      `/admin/tenants/acme/whoami` sees `crossTenant: true` and exactly the
      capabilities the capability matrix proves it is allowed on acme;
      capabilities are sorted.

- [ ] **Step 2: Run** — FAIL on the missing members.

- [ ] **Step 3: Implement** by reusing `callerCapabilities` with the
      principal's `issuerTenantId`, and `crossTenant` as
      `principal.issuerTenantId !== targetTenantId`. `manage-tenants` is listed
      when held. Move the inline schema to the contract.

- [ ] **Step 4: Run** — PASS. Re-capture `## GET /whoami`'s transcript.
      Commit `Answer the caller's capabilities from whoami`.

---

## Increment C — Search, filters and cursors

### Task 7: Cursors carry their sort value and filters

**Files:**

- Modify: `packages/protocol-admin/src/service/cursor.ts`, every usecase
  calling `encodeCursor`/`decodeCursor` (tenants, subjects, clients, roles,
  groups, scopes, keys, sessions)
- Test: `packages/protocol-admin/src/service/cursor.test.ts`

**Interfaces:**

- Produces:
  `interface CursorPayload { readonly after: string; readonly sort?: string; readonly collection: string; readonly tenantId: string; readonly filters: string }`;
  `filterDigest(filters: Readonly<Record<string, string | undefined>>): string`
  (SHA-256 base64url over the sorted, defined entries);
  `decodeCursor(key, collection, tenantId, filters: string, raw)` answering
  `{ kind: 'ok'; after: string; sort?: string } | { kind: 'invalid' }`.

- [ ] **Step 1: Write failing tests:** a cursor decodes under the same
      filters; the same cursor under a different digest is `invalid`; under
      filters with the same entries in another order it is `ok`;
      `filterDigest({ a: undefined })` equals `filterDigest({})`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement,** and thread `filters: filterDigest(query)` from
      every list usecase's own validated query (no filters yet for most, so
      `filterDigest({})`). Audit keeps its own composite `after`.

- [ ] **Step 4: Run** the unit test and every `*.int.test.ts` under
      `packages/protocol-admin/tests` — PASS. Commit
      `Bind a list cursor to the filters it was minted under`.

### Task 8: Subjects: field-scoped search and exact filters

**Files:**

- Create: `packages/protocol-admin/src/service/list-query.ts`,
  `packages/db/drizzle/0073_list_indexes_subjects.sql`
- Modify: `packages/contracts/src/admin/subjects.ts:4`,
  `packages/protocol-admin/src/usecase/subjects.ts:98-130`,
  `packages/protocol-admin/src/view/routes/subjects.ts`,
  `docs/admin-paths.md` (`## GET /subjects`)
- Test: `packages/protocol-admin/src/service/list-query.test.ts`,
  `packages/protocol-admin/tests/subjects.int.test.ts`

**Interfaces:**

- Produces: `prefixRange(text: string): { lower: string; upper: string | null }`
  — `lower` is `text.toLowerCase()`, `upper` the smallest string greater
  than every string starting with `lower` in code-point order (the last
  code point incremented, trailing U+10FFFF dropped first; `null` when
  nothing remains). No `LIKE` anywhere, so `%`, `_` and `\` are literal by
  construction. `listSubjectsQuerySchema = cursorQuerySchema.extend({ username, email, enabled, role, group })`
  with `.strict()` so an unknown parameter is a `400`, and a refinement
  refusing `username` and `email` together ("search one field at a time");
  `enabled: z.enum(['true','false'])`, `role`/`group`: `z.uuid()`.

- [ ] **Step 1: Write failing unit tests** for `prefixRange`: `ADA` →
      `{ lower: 'ada', upper: 'adb' }`; `a_b` → `upper: 'a_c'`; `%` →
      `upper: '&'`; `az` → `upper: 'a{'`; a string ending in U+10FFFF drops
      it before incrementing; `\u{10FFFF}` alone → `upper: null`.

- [ ] **Step 2: Implement; run** — PASS.

- [ ] **Step 3: Write failing integration tests:** `?username=ADA` finds
      `ada.lovelace`; results are ordered by `lower(username)` then `id`;
      paging with `limit=1` across three matches returns each once in order;
      `?username=a_b` does not find `axb`; `?email=grace@` finds by email;
      `?enabled=false` returns only disabled subjects; `?role=<id>` returns
      subjects directly assigned it; `?group=<id>` its direct members;
      `?search=ada` answers `400` naming `search`; `?username=a&email=b` answers
      `400`; a `next` from `?username=a` replayed with `?username=b` answers
      `400 cursor is invalid or expired`; a foreign tenant's role id finds
      nothing.

- [ ] **Step 4: Run** — FAIL.

- [ ] **Step 5: Migration `0073`.** Under RLS an expression index cannot
      serve this search (`docs/phases/p4d.md`, "Prefix search as one range
      scan": `lower` is not leakproof). Each searched field gets a stored
      generated column in the `C` collation and a plain index on it:
      `users.username_search text COLLATE "C" GENERATED ALWAYS AS (lower(username)) STORED`
      with `(tenant_id, username_search, subject_id)`;
      `users.email_search` the same over `email`, its index
      `WHERE email_search IS NOT NULL`; plus
      `subjects (tenant_id, id) WHERE disabled_at IS NOT NULL`,
      `subject_roles (role_id, subject_id)`, `subject_groups (group_id, subject_id)`.
      Declare both columns in the Drizzle schema with `generatedAlwaysAs`
      so `schema-drift.int.test.ts` accepts them.

- [ ] **Step 6: Implement** in `listSubjects`: with a search field,
      `<field>_search >= lower AND <field>_search < upper` (no upper bound
      when `upper` is `null`), the keyset as the row comparison
      `(<field>_search, subject_id) > (sort, after)`, and
      `ORDER BY <field>_search, subject_id` — the exact shape the spike
      verified; key the cursor's `sort` on the last row's `<field>_search`.
      Without one, keep `id` order. Exact filters are `AND`ed predicates.
      Replace the existing `like(users.username, …)`.

- [ ] **Step 7: Run** — PASS. Add
      `verified: EXPLAIN (ANALYZE) <query> → Index Scan using <index>` for each
      search to `docs/phases/p4d.md`.

- [ ] **Step 8: Document** the parameters and re-capture the search
      transcript. Commit `Search subjects by one field, case-insensitively`.

### Task 9: Tenants and clients

**Files:**

- Create: `packages/db/drizzle/0074_list_indexes_tenants_clients.sql`
- Modify: `packages/contracts/src/admin/tenants.ts`,
  `packages/contracts/src/admin/clients.ts`,
  `packages/protocol-admin/src/usecase/tenants.ts:188`,
  `packages/protocol-admin/src/usecase/clients.ts:204`,
  `packages/protocol-admin/src/service/capability.ts` (querystring schemas),
  `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/tenants.int.test.ts`,
  `packages/protocol-admin/tests/clients.int.test.ts`

**Interfaces:**

- Produces: `listTenantsQuerySchema = cursorQuerySchema.extend({ name, display_name, enabled }).strict()`;
  `listClientsQuerySchema = cursorQuerySchema.extend({ client_id, name, type, enabled }).strict()`,
  `type: z.enum(['public','confidential'])`; both refusing two search
  fields together.

- [ ] **Step 1: Write failing tests** mirroring Task 8 Step 3 for each
      field: case-insensitivity, ordering, paging, escaping, the exact filters,
      unknown parameter `400`, filter-bound cursor.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Migration** adding `C`-collation generated `_search`
      columns, as Task 8 did, for `tenants.name`, `tenants.display_name`
      (indexed `(<col>_search, id)`; `tenants` is read through the owner
      connection), `clients.client_id` and `clients.name` (indexed
      `(tenant_id, <col>_search, id)`); implement both usecases with
      `prefixRange` the way Task 8 did.

- [ ] **Step 4: Run** — PASS; record the `EXPLAIN`s. Document; commit
      `Search and filter tenants and clients on the server`.

### Task 10: Roles, groups, scopes and keys

**Files:**

- Create: `packages/db/drizzle/0075_list_indexes_roles_groups_scopes.sql`
- Modify: `packages/contracts/src/admin/{roles,groups,scopes,keys}.ts`,
  `packages/protocol-admin/src/usecase/{roles,groups,scopes,keys}.ts`,
  `capability.ts`, `docs/admin-paths.md`
- Test: the four matching `*.int.test.ts`

**Interfaces:**

- Produces: `listRolesQuerySchema = cursorQuerySchema.extend({ name, client }).strict()`
  where `client` is a client id or the literal `tenant`;
  `listGroupsQuerySchema` and `listScopesQuerySchema` gain `name`;
  `listKeysQuerySchema` gains `status: z.enum(['pending','active','retired'])`
  and `alg`.

- [ ] **Step 1: Write failing tests** per list as in Task 9, plus
      `?client=tenant` returning only tenant roles and `?client=<id>` only that
      client's.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Migration and implementation** as before — a `C`-collation
      generated `name_search` column and `(tenant_id, name_search, id)` index
      on `roles`, `groups` and `client_scopes`. Keys are few per
      tenant, so their filters need no index; say so in the phase note.

- [ ] **Step 4: Run** — PASS. Document; commit
      `Search and filter roles, groups, scopes and keys`.

### Task 11: Audit by resource

**Files:**

- Modify: `packages/contracts/src/admin/audit.ts:16`,
  `packages/protocol-admin/src/usecase/audit.ts:56`,
  `packages/domain-audit/src/repository/audit.ts:86` (`AuditEventFilter`),
  `docs/admin-paths.md` (`## GET /audit`)
- Test: `packages/protocol-admin/tests/audit.int.test.ts`

- [ ] **Step 1: Write the failing test:** after amending two clients,
      `?resource_type=client&resource_id=<first>` returns only the first's rows;
      `resource_id` without `resource_type` answers `400` naming both.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Add `resource_id: z.uuid().optional()`** and the predicate;
      the existing `audit_events_resource` index (`0067`) serves it.

- [ ] **Step 4: Run** — PASS. Document; commit `Filter the audit trail by resource`.

### Task 12: Bounded counts

**Files:**

- Create: `packages/protocol-admin/src/usecase/counts.ts`,
  `packages/contracts/src/admin/counts.ts`,
  `packages/protocol-admin/src/view/routes/counts.ts`
- Modify: `capability.ts`, `packages/protocol-admin/src/index.ts` (handler map),
  `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/counts.int.test.ts`

**Interfaces:**

- Produces: `COUNT_CAP = 10_000`;
  `countResponseSchema = z.object({ count: z.number().int(), capped: z.boolean() })`;
  routes `GET /admin/tenants/count`, `GET /admin/tenants/:tenant/{subjects,clients,roles,groups,scopes}/count`,
  each with its list's query schema minus `cursor` and `limit`, and its
  list's capability.

- [ ] **Step 1: Write failing tests:** three subjects count `3, false`;
      `?username=a` counts the matches; with `COUNT_CAP` injected as `2`,
      three subjects count `2, true`; a foreign tenant's rows are never
      counted; each route refuses the capability its list refuses.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** each count as
      `select count(*) from (<the list's own WHERE> limit cap + 1)`, sharing
      the predicate builder each list usecase already exports from Tasks 8–10
      (export it if private), and answering `min(n, cap)`, `n > cap`.

- [ ] **Step 4: Run** — PASS. Document each; commit `Count lists up to a fixed ceiling`.

---

## Increment D — Configuration the API did not reach

### Task 13: Initial access tokens

**Files:**

- Create: `packages/protocol-admin/src/usecase/registration-tokens.ts`,
  `packages/contracts/src/admin/registration-tokens.ts`,
  `packages/protocol-admin/src/view/routes/registration-tokens.ts`
- Modify: `packages/domain-tenant/src/repository/client-registration-tokens.ts:30`,
  `capability.ts`, `packages/protocol-admin/src/index.ts`,
  `packages/protocol-admin/src/service/audit-detail.ts` (`ALLOWLISTS`),
  `docs/admin-paths.md`
- Test: `packages/domain-tenant/tests/client-registration-tokens.int.test.ts`,
  `packages/protocol-admin/tests/registration-tokens.int.test.ts`

**Interfaces:**

- Produces: repository `list(): Promise<RegistrationTokenRecord[]>`
  (`id, remainingUses, createdAt, expiresAt`, never the hash) and
  `revoke(id: string): Promise<boolean>`; routes
  `GET|POST /admin/tenants/:tenant/registration-tokens`,
  `DELETE /admin/tenants/:tenant/registration-tokens/:id`, all
  `manage-clients`; `POST` body `{ uses: int ≥ 1, ttl_seconds: int ≥ 60 }`,
  `201` answering `{ id, token, remaining_uses, expires_at }` — the only
  response ever carrying `token`; audit actions `registration_token.mint`
  and `registration_token.revoke`.

- [ ] **Step 1: Write failing repository tests** for `list` and `revoke`,
      each with a foreign-`tenant_id` probe; `list` never returns a spent or
      expired token.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS.

- [ ] **Step 3: Write failing route tests:** mint answers the token once
      and a following `GET` lists it without `token`; the minted token
      registers a client at `/tenants/{t}/register` under
      `client_registration_policy=token`; after `DELETE`, registration with it
      is refused; the audit row's `detail` holds `uses` and `ttl_seconds` and
      no token.

- [ ] **Step 4: Run** — FAIL; implement; run — PASS. Add `SAMPLE_BODIES`.
      Document; commit `Mint, list and revoke initial access tokens`.

### Task 14: A subject's groups

**Files:**

- Modify: `packages/domain-authz/src/repository/groups.ts:206`,
  `packages/protocol-admin/src/usecase/subjects.ts`,
  `packages/contracts/src/admin/subjects.ts`, `capability.ts`,
  `packages/protocol-admin/src/view/routes/subjects.ts`, `index.ts`,
  `audit-detail.ts`, `docs/admin-paths.md`
- Test: `packages/domain-authz/tests/groups.int.test.ts`,
  `packages/protocol-admin/tests/subjects.int.test.ts`

**Interfaces:**

- Produces: repository `groupsOfSubject(subjectId): Promise<GroupRecord[]>`
  and `setSubjectGroups(subjectId, groupIds: readonly string[]): Promise<void>`;
  `GET|PUT /admin/tenants/:tenant/subjects/:id/groups` (`view-users` /
  `manage-users`), `PUT` body `{ group_ids: uuid[] }`, `If-Match` mandatory;
  audit `subject.groups_set`.

- [ ] **Step 1: Write failing repository tests** with foreign-tenant probes.

- [ ] **Step 2: Implement; run** — PASS.

- [ ] **Step 3: Write failing route tests:** replace and read back with an
      `ETag`; `428` without `If-Match`, `412` stale; an unknown group id `400`;
      **a caller holding `manage-users` alone joining a group whose roles
      include `tenant-admin` is refused `403`, writes a `refused` row, and the
      membership is unchanged**; the `groups` claim of the subject's next token
      reflects the new membership.

- [ ] **Step 4: Run** — FAIL. **Step 5: Implement** mirroring
      `setSubjectRoles`: row lock, precondition, unknown ids, then the ceiling
      over every role the groups reach (`capabilitiesReachableFrom` over the
      groups' effective roles) and `overreach` against `callerCapabilities`.

- [ ] **Step 6: Run** — PASS. Document; commit `Read and replace a subject's group memberships`.

### Task 15: Role composites, and a role's default

**Files:**

- Modify: `packages/domain-authz/src/repository/roles.ts:149`,
  `packages/protocol-admin/src/usecase/roles.ts`,
  `packages/protocol-admin/src/service/role-patch.ts:15-16`,
  `packages/contracts/src/admin/roles.ts`, `capability.ts`,
  `packages/protocol-admin/src/view/routes/roles.ts`, `index.ts`,
  `audit-detail.ts`, `docs/admin-paths.md`
- Test: `packages/domain-authz/tests/roles.int.test.ts`,
  `packages/protocol-admin/tests/roles.int.test.ts`

**Interfaces:**

- Produces: repository `directComposites(parentId): Promise<RoleRecord[]>`,
  `removeComposite(parentId, childId): Promise<boolean>`,
  `setDefaultForNewSubjects(roleId, value: boolean): Promise<void>`;
  `GET /admin/tenants/:tenant/roles/:id/composites`,
  `DELETE /admin/tenants/:tenant/roles/:id/composites/:childId`,
  `PUT /admin/tenants/:tenant/roles/:id/default` body `{ default: boolean }`,
  all `manage-tenant`; audit `role.composite_remove`, `role.default_set`.

- [ ] **Step 1: Write failing tests:** composites list the direct children
      only; removal answers `204` then `404` on repeat; a subject granted the
      parent loses the child's claim on its next token; the default is set and
      unset, and a subject registered afterwards receives or does not receive
      the role; `role-patch.ts` still refuses the field on `PATCH`, now naming
      `PUT …/default` as the operation.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Document; commit
      `List and remove role composites, and set a role's default`.

### Task 16: Unassigning a scope from a client

**Files:**

- Modify: `packages/domain-tenant/src/repository/client-scopes.ts`,
  `packages/protocol-admin/src/usecase/scopes.ts:513`, `capability.ts`,
  `packages/protocol-admin/src/view/routes/scopes.ts`, `index.ts`,
  `docs/admin-paths.md`
- Test: `packages/domain-tenant/tests/client-scopes.int.test.ts`,
  `packages/protocol-admin/tests/scopes.int.test.ts`

**Interfaces:**

- Produces: repository `unassign(clientId, clientScopeId): Promise<boolean>`;
  `DELETE /admin/tenants/:tenant/scopes/:id/clients/:clientId`,
  `manage-tenant` (the family's capability, `capability.ts:466`); audit
  `scope.unassign_from_client`.

- [ ] **Step 1: Write failing tests:** after unassigning, `GET /clients/:id`
      no longer lists the scope and `/authorize` refuses it for that client;
      repeat answers `404`; foreign-tenant probe.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Document; commit
      `Unassign a scope from a client`.

### Task 17: A subject's profile

**Files:**

- Create: `packages/protocol-admin/src/usecase/profile.ts`,
  `packages/contracts/src/admin/profile.ts`
- Modify: `packages/domain-identity/src/repository/users.ts:164`,
  `capability.ts`, `packages/protocol-admin/src/view/routes/subjects.ts`,
  `index.ts`, `audit-detail.ts`, `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/profile.int.test.ts`

**Interfaces:**

- Produces: `profileSchema` — every OIDC claim column on `users` in
  snake_case (`name` … `address_country`), plus `email_verified` and
  `phone_number_verified`, both writable, and `profile_updated_at`,
  read-only; `GET|PATCH /admin/tenants/:tenant/subjects/:id/profile`
  (`view-users` / `manage-users`), `PATCH` a partial of every writable
  member — the claim columns through `updateProfile`, the two verification
  flags through a new `setVerification(subjectId, { emailVerified?, phoneNumberVerified? })`
  on `userRepository`, both in one transaction — with `If-Match` optional;
  audit `subject.profile_amend` with a redacted diff.

- [ ] **Step 1: Write failing tests:** read shows every claim; amending
      `given_name` changes the next ID token's `given_name` and stamps
      `profile_updated_at`; setting `email_verified: true` makes the next token
      carry it; an unknown member `400`; `email` and `username` are refused
      here, naming the route that owns each; a service subject answers `404`.

- [ ] **Step 2: Run** — FAIL; implement over `updateProfile` and the new
      `setVerification`; run — PASS. Document; commit `Read and amend a subject's profile claims`.

### Task 18: A subject's consents

**Files:**

- Create: `packages/protocol-admin/src/usecase/consents.ts`,
  `packages/contracts/src/admin/consents.ts`
- Modify: `packages/domain-tenant/src/repository/consents.ts`,
  `capability.ts`, routes, `index.ts`, `docs/admin-paths.md`
- Test: `packages/domain-tenant/tests/consents.int.test.ts`,
  `packages/protocol-admin/tests/consents.int.test.ts`

**Interfaces:**

- Produces: repository `forSubject(subjectId): Promise<{ clientId: string; clientKey: string; scopeNames: string[]; grantedAt: Date }[]>`
  and `revoke(subjectId, clientId): Promise<boolean>`;
  `GET /admin/tenants/:tenant/subjects/:id/consents` (`view-users`),
  `DELETE /admin/tenants/:tenant/subjects/:id/consents/:clientId`
  (`manage-users`); audit `consent.revoke`.

- [ ] **Step 1: Write failing tests** with foreign-tenant probes: a consent
      recorded through the consent screen is listed; after revoking, the next
      `/authorize` for a `consent_required` client shows the consent page
      again.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Document; commit
      `List and revoke a subject's consents`.

### Task 19: One-time password, lockout clear, end every session

**Files:**

- Create: `packages/protocol-admin/src/usecase/account-recovery.ts`
- Modify: `packages/protocol-admin/src/usecase/sessions.ts`,
  `packages/authn-flows/src/repository/sessions.ts:131-150`, `capability.ts`,
  routes, `index.ts`, `audit-detail.ts`, `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/account-recovery.int.test.ts`,
  `packages/protocol-admin/tests/sessions.int.test.ts`

**Interfaces:**

- Produces:
  `POST /admin/tenants/:tenant/subjects/:id/password` (`manage-users`, no
  body) answering `201 { password }` from
  `generateOneTimePassword(): string` — `seed admin`'s private
  `generatedPassword` (`apps/server/src/cli/seed.ts:533`,
  `randomBytes(24).toString('base64url')`) moved to
  `packages/domain-identity/src/service/one-time-password.ts` and used by
  both — replacing any password credential, owing
  `update-password`; audit `subject.password_issue` with empty `detail`.
  `DELETE /admin/tenants/:tenant/subjects/:id/lockout` (`manage-users`)
  over `loginFailureRepository(tx).clear`; audit `subject.lockout_clear`.
  `DELETE /admin/tenants/:tenant/subjects/:id/sessions` (`manage-sessions`)
  composing `liveBySubject` and `endMany`, answering `{ ended: number }`;
  audit `session.end_all`.

- [ ] **Step 1: Write failing tests:** the issued password signs the
      subject in and the next step is the forced change; the response is the
      only place the password appears (grep the captured log output and the
      audit rows for it); a locked subject can sign in immediately after the
      clear; ending all sessions makes each session's refresh token fail and
      answers the count; foreign-tenant subject `404` on each.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Document; commit
      `Issue a one-time password, clear a lockout, end every session`.

### Task 20: Read-only client facts and the registration policy

**Files:**

- Modify: `packages/contracts/src/admin/clients.ts:8-39`,
  `packages/protocol-admin/src/usecase/clients.ts` (`toClientView`, ~297;
  `clientWireShape`, ~496), `packages/protocol-admin/src/service/client-patch.ts:28-31`,
  `packages/domain-tenant/src/service/tenant-settings.ts` (`SETTINGS`,
  `coerceTenantSetting`), `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/clients.int.test.ts`,
  `packages/domain-tenant/src/service/tenant-settings.test.ts`,
  `packages/protocol-admin/tests/settings.int.test.ts`

**Interfaces:**

- Produces: `clientSchema` gains `builtin_admin: z.boolean()` and
  `service_subject_id: z.uuid().nullable()`, still refused on `PATCH`;
  `SETTINGS.client_registration_policy` gains
  `values: ['disabled', 'open', 'token']` (confirm the three against
  `0045`'s CHECK before writing them) and `coerceTenantSetting` answers
  `invalid_value` for anything else.

- [ ] **Step 1: Write failing tests:** the built-in admin client reads
      `builtin_admin: true`; a service-account client reads its subject id;
      `PATCH …/settings { client_registration_policy: "sometimes" }` answers
      `400` naming the three values, not `500`.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Re-capture the
      affected client transcripts. Commit
      `Show built-in and service-account facts, validate registration policy`.

### Task 21: Renaming a username

**Files:**

- Create: `packages/db/drizzle/0076_username_editable.sql`
- Modify: `packages/db/src/schema/tenants.ts`,
  `packages/domain-tenant/src/service/tenant-settings.ts`,
  `packages/protocol-admin/src/service/subjects-patch.ts:13`,
  `packages/protocol-admin/src/usecase/subjects.ts` (`amendSubject`, ~387),
  `packages/contracts/src/admin/subjects.ts:41-44`, `docs/admin-paths.md`,
  `README.md` (the settings list)
- Test: `packages/protocol-admin/tests/subjects.int.test.ts`,
  `packages/protocol-admin/src/service/subjects-patch.test.ts`

**Interfaces:**

- Produces: `tenants.username_editable boolean NOT NULL DEFAULT false`,
  setting `username_editable` (`boolean`); `amendSubjectRequestSchema`
  gains `username`; `subjects-patch.ts` refuses `username` only when the
  setting is off, with the reason "this tenant has not enabled username
  editing (username_editable)".

- [ ] **Step 1: Write failing tests:** with the setting off, `400` with that
      reason; on, without `If-Match`, `428`; on, with a matching `ETag`, the
      rename succeeds, `preferred_username` on the next token carries it,
      existing sessions and refresh tokens still work, and a login-failure row
      for the subject survives; renaming to a name another subject holds
      answers `409` and leaves the email change in the same body unapplied;
      renaming to the subject's current name writes no audit row; renaming to a
      case-variant of another subject's name behaves as `users_username_unique`
      decides, and the test asserts whichever it is.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement:** the migration and
      setting; in `amendSubject`, take the row lock, require `If-Match` when
      `username` is present, validate as creation does, map the unique
      violation to `409`. **Step 4: Run** — PASS.

- [ ] **Step 5: Document** under `## PATCH /subjects/:id` and the settings
      list. Commit `Let a tenant allow usernames to be renamed`.

---

## Increment E — Export and import

### Task 22: Tenant export

**Files:**

- Create: `packages/contracts/src/admin/tenant-document.ts`,
  `packages/protocol-admin/src/usecase/tenant-export.ts`,
  `packages/protocol-admin/src/view/routes/tenant-export.ts`
- Modify: `capability.ts`, `index.ts`, `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/tenant-export.int.test.ts`,
  `packages/contracts/src/admin/tenant-document.test.ts`

**Interfaces:**

- Produces: `tenantDocumentSchema` (Zod, `version: z.literal(1)`, then
  `settings`, `flow`, `clients`, `roles`, `groups`, `scopes`,
  `registration_policy`, `smtp`, optional `subjects`, and
  `omitted: z.array(z.string())` of JSON paths); references inside the
  document are by name (`client_id`, role name with its client, group
  path, scope name), never by row id; `EXPORT_SUBJECT_CAP = 10_000`;
  `GET /admin/tenants/:tenant/export` (`manage-tenant`; `?include=subjects`
  additionally requires `view-users`, refused `403` otherwise), content
  type `application/vnd.odudu.tenant+json`; audit `tenant.export` with
  `detail: { include_subjects }`.

- [ ] **Step 1: Write failing tests:** an exported tenant validates against
      `tenantDocumentSchema`; it contains no value matching any client secret
      hash, SMTP password, private JWK member (`PRIVATE_JWK_MEMBERS` from
      `@odudu/crypto`), password hash or TOTP seed seeded into the fixture —
      asserted by searching the serialised document for each seeded secret;
      `omitted` lists `clients[<i>].secret` for each confidential client and
      `smtp.password` when one is set; `?include=subjects` without `view-users`
      is `403`; with 10,001 subjects (inserted directly) it is refused `413`
      naming P7.

- [ ] **Step 2: Run** — FAIL; implement; run — PASS. Document; commit
      `Export a tenant's configuration without its secrets`.

### Task 23: Tenant import

**Files:**

- Create: `packages/protocol-admin/src/usecase/tenant-import.ts`,
  `packages/protocol-admin/src/view/routes/tenant-import.ts`
- Modify: `capability.ts`, `index.ts`, `packages/protocol-admin/src/usecase/tenants.ts`
  (reuse `createTenant`'s provisioning inside one transaction),
  `docs/admin-paths.md`
- Test: `packages/protocol-admin/tests/tenant-import.int.test.ts`

**Interfaces:**

- Consumes: `tenantDocumentSchema`, `isValidTenantName`, `createTenant`'s
  provisioning steps.
- Produces: `POST /admin/tenant-imports` (`manage-tenants` only, no
  `:tenant`), body `{ name, display_name?, document }`, answering `201`
  `{ tenant, client_secrets: { client_id, secret }[] }`; `400` carrying
  `errors: { path: string; message: string }[]` for every problem at once;
  audit `tenant.import` in the new tenant's trail with
  `detail: { source_version, counts }`.

- [ ] **Step 1: Write failing tests:** export then import under a new name
      yields a tenant whose re-export equals the original apart from `name`,
      `display_name` and `omitted`; each confidential client's returned secret
      authenticates at the new tenant's `/token`; signing keys are fresh (no
      `kid` shared); imported subjects owe `update-password` and hold no
      credential; a document with a scope mapping naming an unknown role and a
      client with an invalid redirect answers `400` listing both paths and
      creates no tenant; an existing name answers `409` and a refused name
      `400`, both before any write; the body limit refuses a document above
      the configured size with `413`.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement:** validate everything
      first (schema, then cross-references, then every client through
      `parseClientMetadata`), collecting errors; then one `withTenant`
      transaction creating the tenant and each record in dependency order
      (roles, composites, groups, scopes, clients, assignments, subjects).
      **Step 4: Run** — PASS.

- [ ] **Step 5: Document** with the round-trip transcript. Commit
      `Import a tenant document into a new tenant`.

---

## Closing Part 1

- [ ] Run `pnpm verify` and `pnpm trace` — both green.
- [ ] Add the Part 1 section to `docs/phases/p4d.md`: what was found wrong
      while building it, and every `verified:` the spikes and `EXPLAIN`s
      produced.
- [ ] Write Part 2's plan (the gateway) against the spike results, before
      starting it.
