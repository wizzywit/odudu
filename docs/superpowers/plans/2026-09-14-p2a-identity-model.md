# P2a Identity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An identity model underneath the P1 protocol core — roles, groups, client scopes, a user profile and per-client web origins — emitted into tokens as IANA-registered claims, plus the email delivery that makes address verification, self-registration and password reset possible.

**Architecture:** Three new packages join the six P1 established. `domain-authz` owns roles, groups and effective-role resolution and depends on nothing; `email` owns an `EmailSender` port with an SMTP adapter and a capturing adapter; `account` owns the registration, verification and reset journeys. Client scopes, scope mappings and web origins are client configuration and join `domain-tenant` and `protocol-oidc`. The frozen `SUPPORTED_SCOPES` constant is replaced by tenant data, and the `ClaimMapperRegistry` — which has only ever fed the ID token and `/userinfo` — is extended to the access token, which is the surface RFC 9068 section 2.2.3.1 is actually about.

**Tech Stack:** Node 24, TypeScript 6.0.3, Fastify 5.12.3, PostgreSQL 17, Drizzle ORM 0.45.2, Zod 4.6.1, Vitest 5.0.0, Testcontainers 12.1.0, jose 6.2.12, @node-rs/argon2 2.2.1. Two candidate additions, each gated by a spike: a CORS mechanism (Task 1) and an SMTP client (Task 14).

**Spec:** `docs/superpowers/specs/2026-09-14-p2a-identity-model-design.md`

**Umbrella spec:** `docs/superpowers/specs/2026-09-10-odudu-design.md`

## Global Constraints

Everything in P0's and P1's plans still binds. Repeated here because an implementer sees only their own task:

- Node `>=24.0.0`. TypeScript pinned to **6.0.3**, not 7.x (ADR 0012).
- ESM only. `"type": "module"`, `verbatimModuleSyntax` on.
- **Intra-package imports use Node subpath imports, never relative paths.** Each package declares `"imports": { "#/*": "./src/*.ts" }`; code imports as `#/service/roles`. Cross-package imports use the package name (`@odudu/kernel`) and resolve only through that package's `index.ts` (ADR 0013).
- Every dependency version is exact, no ranges.
- **`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`.** A version published in the last 24 hours will not install. If one in this plan is blocked, wait or add an entry to `minimumReleaseAgeExclude` **with a comment giving the reason** — never lower the global setting.
- **No `any`.** Not as an annotation, not as a cast, not leaked in from an untyped boundary. `tests/lint/no-any.test.ts` also fails the build on an inline `eslint-disable` of `no-explicit-any` or `no-unsafe-*`.
- **Call a function as `doThing()`, never `void doThing()`.** If a call trips `no-floating-promises`, `await` it, return it, or add it to `allowForKnownSafeCalls` in `eslint.config.js` with a comment saying why it is safe.
- **No comment block runs longer than eight lines.** `tests/lint/comment-block-length.test.ts` fails the build on one. Blank lines do not split a block; over-long lines are weighed by width. No allowlist, no inline waiver. An essay goes to an ADR or a `docs/protocols/` reading note with a one-line pointer back.
- **Never reference the development process from a comment** — no "Task 12", no "Step 3", no plan slot numbers. Name the thing instead.
- **Commit messages contain no `Co-Authored-By` or tool-attribution trailers.** A repository hook rejects them.
- Test-driven: the failing test is written and observed failing before implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a mock. They live in a package's `tests/` directory as `*.int.test.ts`. Unit tests sit beside the code as `*.test.ts`.
- Domain packages never import protocol packages. Protocol packages never import each other.
- Layer imports follow ADR 0010: `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing.
- **`SET LOCAL`, never `SET`, for tenant context.** Use `withTenant(db, tenantId, fn)` from `@odudu/db`.
- **Every new tenant table needs `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy.** `packages/db/tests/rls-policy.int.test.ts` sweeps every table in the `public` schema and fails if one is missing, so this is caught mechanically — but **the foreign-`tenant_id` probe on every repository method is not**, and is written per task.
- Migrations are hand-authored SQL in `packages/db/drizzle/`, and each needs an entry appended to `packages/db/drizzle/meta/_journal.json` with the next `idx` and a `when` greater than the previous entry's.
- **`pnpm trace` runs strict.** A new MUST that is not `covered` fails the build. A new `deferred:` or `n/a:` row must move the count in `tools/trace/silenced-musts.json` in the same diff.
- **`README.md` and `docs/request-paths.md` are updated in the same commit as the code** that changes a request, response, branch, error code, endpoint, command or default. `tests/docs/` fails the build on drift.
- Every task ends with **CI green on a pushed commit with the draft pull request open**, and `docs/NEXT.md` updated.

### P2a-specific constraints

- **Claim names are `roles` and `groups`** — IANA-registered to RFC 7643 section 4.1.2 and RFC 9068 section 2.2.3.1. Never `realm_access`, never `resource_access`.
- **Both claims are sorted, de-duplicated arrays of strings.** Sorted so a token is reproducible and its tests are not order-flaky.
- **A tenant role appears bare (`admin`); a client role appears as `clientId:roleName`.** A CHECK constraint refuses `:` in any role name, so the qualified form can never be ambiguous.
- **`entitlements` is not emitted.** Recorded as a deliberate omission, never silently absent.
- **`clients.full_scope_allowed` defaults to `false`.** A new client's tokens carry no roles until an operator maps them.
- **A CORS preflight carries no client identity.** Preflight is answered against the tenant's union of origins; the real request is enforced against the identified client's own list.
- **No `Access-Control-Allow-Credentials`, ever.** And every allowed origin is echoed explicitly, never reflected unchecked, with `Vary: Origin` set.
- **Nothing is deleted.** `action_tokens` rows persist after consumption (ADR 0021); reaping is P2b's.
- **Verification ships before registration.** An unverified self-registered address is an account-takeover primitive.
- **Provisioning is seed-CLI-only.** An increment that adds an admin-shaped surface is out of scope by definition.

## File structure

New packages, each with the standard `src/{schema,repository,service,usecase,view}` layout and a single `index.ts` export surface:

| Path                     | Responsibility                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/domain-authz/` | roles, composites, groups, assignments, effective-role resolution. Imports `@odudu/db` and `@odudu/kernel` only. |
| `packages/email/`        | the `EmailSender` port, SMTP and capturing adapters, templates.                                                  |
| `packages/account/`      | registration, verification and reset usecases and views.                                                         |

Modified packages:

| Path                        | Change                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/db/drizzle/`      | migrations 0015–0022 and their journal entries                                                                       |
| `packages/domain-tenant/`   | client scopes, scope assignments, scope-to-role mappings, `full_scope_allowed`                                       |
| `packages/domain-identity/` | profile columns on `users`, profile repository methods                                                               |
| `packages/protocol-oidc/`   | `web_origins` on `client_oidc_config`, CORS at the edge, tenant-sourced scopes, claim mappers, access-token assembly |
| `packages/contracts/`       | `SUPPORTED_SCOPES` removed; discovery takes scopes as an argument                                                    |
| `apps/server/`              | CORS registration, seed CLI subcommands, account routes                                                              |
| `docs/protocols/`           | `rfc9068.md` reading note and rows, `oidc-core.md` rows                                                              |

## Task budget

| Task | Deliverable                                                             | Hours |
| ---- | ----------------------------------------------------------------------- | ----- |
| 1    | **Spike:** CORS decision taken per request                              | 2–3   |
| 2    | Web origins: migration 0015, origin grammar, `+` expansion              | 4–5   |
| 3    | CORS at the edge: preflight union, per-client enforcement               | 5–6   |
| 4    | Client scopes: migration 0016, repository, tenant seeds                 | 5–6   |
| 5    | Scopes sourced from the tenant: discovery, `/authorize`, `resolveScope` | 5–6   |
| 6    | **Spike:** recursive CTE termination on a cyclic graph                  | 2     |
| 7    | Roles: migration 0017, repository, cycle refusal                        | 5–6   |
| 8    | Effective-role resolution: the composite closure                        | 4–5   |
| 9    | Groups: migration 0018, path maintenance, inherited roles               | 5–6   |
| 10   | The `roles` and `groups` claim mappers; `ClaimContext` widened          | 4–5   |
| 11   | The access token runs the registry; scope mappings narrow               | 5–6   |
| 12   | User profile: migration 0019, constrained columns, repository           | 5–6   |
| 13   | `profile`, `address` and `phone` mappers; `claims_supported` honesty    | 4–5   |
| 14   | **Spike:** SMTP client through a real container build                   | 2–3   |
| 15   | `@odudu/email`: port, adapters, templates                               | 5–6   |
| 16   | Action tokens: migration 0020, hashed single-use redemption             | 4–5   |
| 17   | Address verification; migration 0021 tenant settings                    | 5–6   |
| 18   | Self-registration; migration 0022 email uniqueness                      | 5–6   |
| 19   | Password reset, enumeration-safe                                        | 4–5   |
| 20   | Seed CLI: roles, groups, scopes, mappings, profile                      | 4–5   |
| 21   | Traceability: clause rows, reading notes, census                        | 4–5   |
| 22   | Phase close: whole-phase documentation pass                             | 4–5   |

Total: 94–121 hours, against the spec's 90–130.

**The spec says "roughly 16 increments" and this plan has 22.** The difference is not new scope: the three spikes, the seed CLI, the traceability pass and the documentation close were counted inside neighbouring items in the spec's estimate and are separate tasks here, because each is independently reviewable and a reviewer could reject one while approving its neighbour. The hours are unchanged.

**Task 1 must complete before Task 3, Task 6 before Task 8, and Task 14 before Task 15.** Those are the spike gates.

---

### Task 1: Spike — can a CORS decision be taken per request?

A spike's output is an answer, not code you keep. Anything built here is throwaway and is deleted in Step 5; the deliverable is a recorded finding.

**The assumption under test:** that `@fastify/cors` can take an allow/deny decision from the database per request — for the **preflight** as well as for the real request. Its documented model is static per-server or per-route configuration. If it cannot do this cleanly, the fallback is an `onRequest` hook of roughly 60 lines, which is small enough that the dependency has to earn itself.

**Files:**

- Create: `docs/superpowers/p2a-spike-log.md`
- Create (throwaway): `/tmp/cors-spike/` — outside the repository

**Interfaces:**

- Consumes: nothing
- Produces: a decision recorded in `docs/superpowers/p2a-spike-log.md` under the heading `## CORS: per-request origin decisions`, stating either `verified: @fastify/cors <version> delegator resolves preflight asynchronously` or `verified: it does not; Task 3 uses an onRequest hook`. Task 3 reads this and branches on it.

- [ ] **Step 1: Build the probe outside the repository**

```bash
mkdir -p /tmp/cors-spike && cd /tmp/cors-spike
npm init -y >/dev/null
npm i fastify@5.12.3 @fastify/cors@11.2.0
```

- [ ] **Step 2: Write the probe**

The question is narrow: does the delegator run for an `OPTIONS` preflight, can it be `async`, and can it return a _different_ origin decision per request?

```js
// /tmp/cors-spike/probe.mjs
import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify();
const seen = [];

await app.register(cors, (instance) => async (req, cb) => {
  seen.push({ method: req.method, origin: req.headers.origin });
  // Simulates the database read: only this origin is allowed, and only
  // for requests whose path names tenant "alpha".
  const allowed =
    req.url.includes('/tenants/alpha/') && req.headers.origin === 'https://app.example';
  cb(null, { origin: allowed ? req.headers.origin : false, credentials: false });
});

app.post('/tenants/:tenant/protocol/openid-connect/token', async () => ({ ok: true }));
await app.listen({ port: 0 });
const port = app.server.address().port;

const preflight = await fetch(
  `http://127.0.0.1:${port}/tenants/alpha/protocol/openid-connect/token`,
  {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
  },
);
const wrongTenant = await fetch(
  `http://127.0.0.1:${port}/tenants/beta/protocol/openid-connect/token`,
  {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
  },
);

console.log('delegator saw:', seen);
console.log('preflight allow-origin:', preflight.headers.get('access-control-allow-origin'));
console.log('wrong-tenant allow-origin:', wrongTenant.headers.get('access-control-allow-origin'));
await app.close();
```

- [ ] **Step 3: Run it and read the three lines**

Run: `node /tmp/cors-spike/probe.mjs`

The answer is **yes** if `delegator saw:` contains an `OPTIONS` entry, `preflight allow-origin:` is `https://app.example`, and `wrong-tenant allow-origin:` is `null`. Anything else — the delegator not running for `OPTIONS`, the callback form rejecting an `async` function, the same header on both — is a **no**.

- [ ] **Step 4: Record the finding**

Create `docs/superpowers/p2a-spike-log.md` with a `## CORS: per-request origin decisions` section stating the exact command run, the three lines of output verbatim, and the one-sentence conclusion. Write what happened, not what was hoped for: a `no` here is a successful spike.

- [ ] **Step 5: Delete the probe**

```bash
rm -rf /tmp/cors-spike
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/p2a-spike-log.md
git commit -m "Establish whether a CORS origin decision can be taken per request"
```

---

### Task 2: Web origins — migration 0015, the origin grammar, and `+` expansion

**Files:**

- Create: `packages/db/drizzle/0015_client_web_origins.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/protocol-oidc/src/service/web-origin.ts`
- Create: `packages/protocol-oidc/src/service/web-origin.test.ts`
- Modify: `packages/protocol-oidc/src/schema/client-oidc-config.ts`
- Modify: `packages/protocol-oidc/src/repository/client-oidc-config.ts`
- Create: `packages/protocol-oidc/tests/web-origins.int.test.ts`

**Interfaces:**

- Consumes: `clientOidcConfig` table and `ClientOidcConfig` interface from `#/schema/client-oidc-config`
- Produces:
  - `isWellFormedWebOrigin(value: string): boolean`
  - `normalizeOrigin(value: string): string | null`
  - `expandWebOrigins(configured: readonly string[], redirectUris: readonly string[]): ReadonlySet<string>`
  - `ClientOidcConfig.webOrigins: string[]`
  - `clientOidcConfigRepository(tx).webOriginsForTenant(): Promise<ReadonlySet<string>>`

- [ ] **Step 1: Verify the platform claim this task rests on**

`normalizeOrigin` relies on `URL.origin` dropping a scheme's default port and keeping every other port. That is a claim about the platform, so it is verified before it is written down, not after.

Run:

```bash
node -e "for (const u of ['https://a.example:443','https://a.example','http://a.example:80','https://a.example:8443','http://[::1]:3000']) console.log(u, '->', new URL(u).origin)"
```

Expected: `https://a.example:443 -> https://a.example`, `http://a.example:80 -> http://a.example`, and `:8443` / `[::1]:3000` preserved. Record the command and output in `docs/superpowers/p2a-spike-log.md` under `## URL.origin normalization`.

- [ ] **Step 2: Write the failing unit tests**

```ts
// packages/protocol-oidc/src/service/web-origin.test.ts
import { describe, expect, it } from 'vitest';
import { expandWebOrigins, isWellFormedWebOrigin, normalizeOrigin } from '#/service/web-origin';

describe('web origin grammar', () => {
  it.each([
    ['https://app.example', true],
    ['http://localhost:3000', true],
    ['https://app.example:8443', true],
    ['+', true],
  ])('accepts %s', (value, expected) => {
    expect(isWellFormedWebOrigin(value)).toBe(expected);
  });

  it.each([
    ['*'],
    ['https://*'],
    ['https://*.example'],
    ['https://app.example/'],
    ['https://app.example/callback'],
    ['https://app.example?x=1'],
    ['app.example'],
    ['ftp://app.example'],
    [''],
  ])('refuses %s', (value) => {
    expect(isWellFormedWebOrigin(value)).toBe(false);
  });
});

describe('normalizeOrigin', () => {
  it('drops a scheme default port and keeps every other port', () => {
    expect(normalizeOrigin('https://app.example:443')).toBe('https://app.example');
    expect(normalizeOrigin('http://app.example:80')).toBe('http://app.example');
    expect(normalizeOrigin('https://app.example:8443')).toBe('https://app.example:8443');
  });

  it('returns null for something that is not an origin', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('expandWebOrigins', () => {
  it('expands + to the origins of the registered redirect URIs', () => {
    const origins = expandWebOrigins(
      ['+'],
      [
        'https://app.example/callback',
        'https://app.example/silent-renew',
        'https://admin.example/cb',
      ],
    );
    expect([...origins].sort()).toEqual(['https://admin.example', 'https://app.example']);
  });

  it('keeps explicit origins alongside an expanded +', () => {
    const origins = expandWebOrigins(['+', 'https://other.example'], ['https://app.example/cb']);
    expect([...origins].sort()).toEqual(['https://app.example', 'https://other.example']);
  });

  it('yields nothing for a client that configured nothing', () => {
    expect(expandWebOrigins([], ['https://app.example/cb']).size).toBe(0);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @odudu/protocol-oidc test web-origin`
Expected: FAIL — `Failed to resolve import "#/service/web-origin"`.

- [ ] **Step 4: Implement the grammar**

```ts
// packages/protocol-oidc/src/service/web-origin.ts

// A bare origin: scheme, host, optional port. No path, no query, no
// fragment, no wildcard. `+` is the one non-origin value permitted, and
// means "derive from this client's registered redirect URIs".
const ORIGIN_PATTERN = /^https?:\/\/[^/?#\s*]+$/;

export function isWellFormedWebOrigin(value: string): boolean {
  if (value === '+') return true;
  if (!ORIGIN_PATTERN.test(value)) return false;
  return normalizeOrigin(value) !== null;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function expandWebOrigins(
  configured: readonly string[],
  redirectUris: readonly string[],
): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of configured) {
    if (entry === '+') {
      for (const uri of redirectUris) {
        const origin = normalizeOrigin(uri);
        if (origin !== null) origins.add(origin);
      }
      continue;
    }
    const origin = normalizeOrigin(entry);
    if (origin !== null) origins.add(origin);
  }
  return origins;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @odudu/protocol-oidc test web-origin`
Expected: PASS.

- [ ] **Step 6: Write the migration**

A `CHECK` constraint cannot contain a subquery, so the per-element test goes in an `IMMUTABLE` SQL function the constraint calls. `bool_and` over an empty set returns `NULL`, and a `NULL` `CHECK` passes — which is the behaviour wanted for the default empty array.

```sql
-- packages/db/drizzle/0015_client_web_origins.sql
CREATE FUNCTION web_origins_are_valid(origins text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT bool_and(o = '+' OR o ~ '^https?://[^/?#[:space:]*]+$')
  FROM unnest(origins) AS o
$$;

ALTER TABLE client_oidc_config
  ADD COLUMN web_origins text[] NOT NULL DEFAULT '{}';

ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_web_origins_shape
  CHECK (web_origins_are_valid(web_origins));
```

Append to `packages/db/drizzle/meta/_journal.json`:

```json
{
  "idx": 15,
  "version": "7",
  "when": 1789049381658,
  "tag": "0015_client_web_origins",
  "breakpoints": true
}
```

- [ ] **Step 7: Write the integration test that proves the constraint bites**

The point of this test is the **negative** cases. A test that only inserts a valid origin passes against a database with no constraint at all.

```ts
// packages/protocol-oidc/tests/web-origins.int.test.ts
// Standard harness: startTestDatabase + runMigrations + withTenant, as in
// packages/protocol-oidc/tests/*.int.test.ts.

describe('client_oidc_config_web_origins_shape', () => {
  it.each([['*'], ['https://*.example'], ['https://app.example/'], ['app.example']])(
    'refuses %s',
    async (origin) => {
      await expect(insertConfigWithWebOrigins([origin])).rejects.toThrow(
        /client_oidc_config_web_origins_shape/,
      );
    },
  );

  it('accepts an explicit origin, a port, and the + placeholder together', async () => {
    await expect(
      insertConfigWithWebOrigins(['https://app.example', 'http://localhost:3000', '+']),
    ).resolves.toBeDefined();
  });

  it('accepts the empty default', async () => {
    await expect(insertConfigWithWebOrigins([])).resolves.toBeDefined();
  });
});
```

- [ ] **Step 8: Add the column to the schema and the repository**

In `packages/protocol-oidc/src/schema/client-oidc-config.ts`, add to the table definition and to `ClientOidcConfig`:

```ts
  webOrigins: text('web_origins').array().notNull().default([]),
```

```ts
  webOrigins: string[];
```

In `packages/protocol-oidc/src/repository/client-oidc-config.ts`, add `webOrigins: row.webOrigins` to the row mapper, and add the tenant-union read the preflight needs:

```ts
    // A CORS preflight carries no client identity, so the only allowlist
    // available at that moment is the tenant's union. The per-client list is
    // enforced on the real request, where the client is known.
    async webOriginsForTenant(): Promise<ReadonlySet<string>> {
      const rows = await tx
        .select({
          webOrigins: clientOidcConfig.webOrigins,
          redirectUris: clientOidcConfig.redirectUris,
        })
        .from(clientOidcConfig);
      const union = new Set<string>();
      for (const row of rows) {
        for (const origin of expandWebOrigins(row.webOrigins, row.redirectUris)) union.add(origin);
      }
      return union;
    },
```

- [ ] **Step 9: Probe it with a foreign tenant**

Every repository method is probed with a foreign `tenant_id`. Add to `web-origins.int.test.ts`:

```ts
it('returns no origins from another tenant', async () => {
  await seedClientWithOrigins(tenantA, ['https://a.example']);
  await seedClientWithOrigins(tenantB, ['https://b.example']);

  const inA = await withTenant(db, tenantA, (tx) =>
    clientOidcConfigRepository(tx).webOriginsForTenant(),
  );
  expect([...inA]).toEqual(['https://a.example']);
});
```

- [ ] **Step 10: Run the whole package and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/db/drizzle packages/protocol-oidc docs/superpowers/p2a-spike-log.md
git commit -m "Give a client its own web origins, and refuse the ones that cannot be one"
```

---

### Task 3: CORS at the edge — preflight against the tenant, the request against the client

**Files:**

- Create: `packages/protocol-oidc/src/service/cors.ts`
- Create: `packages/protocol-oidc/src/service/cors.test.ts`
- Create: `packages/protocol-oidc/src/view/routes/cors.ts`
- Modify: `packages/protocol-oidc/src/view/routes/token.ts`
- Modify: `packages/protocol-oidc/src/view/routes/userinfo.ts`
- Modify: `packages/protocol-oidc/src/view/routes/jwks.ts`
- Modify: `packages/protocol-oidc/src/view/routes/discovery.ts`
- Create: `packages/protocol-oidc/tests/cors.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: `expandWebOrigins`, `clientOidcConfigRepository(tx).webOriginsForTenant()` (Task 2); the Task 1 finding
- Produces:
  - `corsHeadersForPreflight(origin: string | undefined, allowed: ReadonlySet<string>): Record<string, string> | null`
  - `corsHeadersForRequest(origin: string | undefined, allowed: ReadonlySet<string>): Record<string, string>`
  - `registerCors(app, deps)` in `#/view/routes/cors`

- [ ] **Step 1: Read the Task 1 finding and pick the mechanism**

Open `docs/superpowers/p2a-spike-log.md`. If the finding says the delegator resolves preflight asynchronously, add `@fastify/cors` at the exact version the spike used and configure it through a delegator. If it says otherwise, implement the `onRequest` hook and add no dependency. **The pure decision functions in Steps 2–4 are identical either way**; only Step 5's wiring differs.

- [ ] **Step 2: Write the failing unit tests**

```ts
// packages/protocol-oidc/src/service/cors.test.ts
import { describe, expect, it } from 'vitest';
import { corsHeadersForPreflight, corsHeadersForRequest } from '#/service/cors';

const allowed = new Set(['https://app.example']);

describe('preflight', () => {
  it('echoes an allowed origin explicitly and varies on Origin', () => {
    expect(corsHeadersForPreflight('https://app.example', allowed)).toEqual({
      'access-control-allow-origin': 'https://app.example',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
  });

  it('returns null for an origin nothing in the tenant allows', () => {
    expect(corsHeadersForPreflight('https://evil.example', allowed)).toBeNull();
  });

  it('returns null when there is no Origin header at all', () => {
    expect(corsHeadersForPreflight(undefined, allowed)).toBeNull();
  });

  it('never grants credentials', () => {
    const headers = corsHeadersForPreflight('https://app.example', allowed);
    expect(headers).not.toHaveProperty('access-control-allow-credentials');
  });
});

describe('actual request', () => {
  it('echoes an allowed origin and always varies on Origin', () => {
    expect(corsHeadersForRequest('https://app.example', allowed)).toEqual({
      'access-control-allow-origin': 'https://app.example',
      vary: 'Origin',
    });
  });

  it('omits allow-origin for a disallowed origin but still varies', () => {
    expect(corsHeadersForRequest('https://evil.example', allowed)).toEqual({ vary: 'Origin' });
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @odudu/protocol-oidc test cors`
Expected: FAIL — `Failed to resolve import "#/service/cors"`.

- [ ] **Step 4: Implement the decision**

```ts
// packages/protocol-oidc/src/service/cors.ts
import { normalizeOrigin } from '#/service/web-origin';

const PREFLIGHT_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
} as const;

// `Vary: Origin` is set whether or not the origin was allowed: without it a
// shared cache can serve one origin's allowed response to another.
export function corsHeadersForPreflight(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string> | null {
  const echoed = allowedOrigin(origin, allowed);
  if (echoed === null) return null;
  return { 'access-control-allow-origin': echoed, ...PREFLIGHT_HEADERS, vary: 'Origin' };
}

export function corsHeadersForRequest(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const echoed = allowedOrigin(origin, allowed);
  return echoed === null
    ? { vary: 'Origin' }
    : { 'access-control-allow-origin': echoed, vary: 'Origin' };
}

function allowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): string | null {
  if (origin === undefined) return null;
  const normalized = normalizeOrigin(origin);
  if (normalized === null || !allowed.has(normalized)) return null;
  return normalized;
}
```

- [ ] **Step 5: Run them and watch them pass, then wire the edge**

Run: `pnpm --filter @odudu/protocol-oidc test cors`
Expected: PASS.

Wire four endpoints, and only four:

| Route                               | Treatment                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/protocol/openid-connect/token`    | `OPTIONS` answered from `webOriginsForTenant()`; `POST` answered from the resolved client's own expanded origins |
| `/protocol/openid-connect/userinfo` | same, with the client taken from the access token's `client_id` claim                                            |
| `/protocol/openid-connect/certs`    | `access-control-allow-origin: *`, no `Vary`                                                                      |
| `/.well-known/openid-configuration` | `access-control-allow-origin: *`, no `Vary`                                                                      |

`/protocol/openid-connect/auth` and `/login-actions/*` get **nothing**: they are top-level navigations, and a CORS header there would grant browser script read access to a login page.

On `/token` the client is the `client_id` in the form body; on `/userinfo` it is the `client_id` claim of the presented access token. In both cases the per-client decision is taken **after** the client is resolved, and the headers are attached to the response that is already being built — a disallowed origin changes no status code and no body, it only withholds the header, and the browser discards the response.

- [ ] **Step 6: Write the integration test that proves the split**

This is the test the whole design rests on. Two clients in one tenant with different origins: the preflight succeeds against the union, the real request is refused against the client.

```ts
// packages/protocol-oidc/tests/cors.int.test.ts
describe('preflight is answered from the tenant, the request from the client', () => {
  it('allows at preflight an origin that belongs to another client, then withholds it on the real request', async () => {
    await seedClient({ clientId: 'app-a', webOrigins: ['https://a.example'] });
    await seedClient({ clientId: 'app-b', webOrigins: ['https://b.example'] });

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/tenants/demo/protocol/openid-connect/token',
      headers: { origin: 'https://b.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('https://b.example');

    const actual = await app.inject({
      method: 'POST',
      url: '/tenants/demo/protocol/openid-connect/token',
      headers: { origin: 'https://b.example' },
      payload: tokenRequestFor('app-a'),
    });
    expect(actual.headers['access-control-allow-origin']).toBeUndefined();
    expect(actual.headers['vary']).toBe('Origin');
  });

  it('never sets allow-credentials on any endpoint', async () => {
    for (const url of [
      '/tenants/demo/protocol/openid-connect/token',
      '/tenants/demo/protocol/openid-connect/userinfo',
      '/tenants/demo/protocol/openid-connect/certs',
      '/tenants/demo/.well-known/openid-configuration',
    ]) {
      const res = await app.inject({
        method: 'OPTIONS',
        url,
        headers: { origin: 'https://a.example' },
      });
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  it('sets no CORS header on the authorization endpoint', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/tenants/demo/protocol/openid-connect/auth',
      headers: { origin: 'https://a.example', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
```

- [ ] **Step 7: Document it, with commands that were actually run**

Add a section to `docs/request-paths.md` showing a real preflight and a real cross-origin token exchange against the running stack. Every command in that document has been executed and every response is real output — run these, paste what came back. Add the `web_origins` field to the client-registration description in `README.md`.

- [ ] **Step 8: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/protocol-oidc docs/request-paths.md README.md
git commit -m "Answer a preflight from the tenant and the request from the client"
```

---

### Task 4: Client scopes — migration 0016, the repository, and tenant seeds

**Files:**

- Create: `packages/db/drizzle/0016_client_scopes.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/domain-tenant/src/schema/client-scopes.ts`
- Create: `packages/domain-tenant/src/repository/client-scopes.ts`
- Create: `packages/domain-tenant/tests/client-scopes.int.test.ts`
- Modify: `packages/domain-tenant/src/index.ts`

**Interfaces:**

- Consumes: `clients` table from `#/schema/clients`
- Produces:
  - `clientScopes`, `clientScopeAssignments` tables
  - `interface ClientScopeRecord { id, tenantId, name, description, includeInTokenScope, includeInIdToken }`
  - `clientScopeRepository(tx)` with `allForTenant()`, `byName(name)`, `forClient(clientId)`, `create(input)`, `assign(clientId, scopeId, assignment)`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0016_client_scopes.sql
CREATE TABLE client_scopes (
  id                     uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  -- Whether the scope's own name appears in the issued `scope` claim. A
  -- scope that exists only to carry claims need not advertise itself back.
  include_in_token_scope boolean NOT NULL DEFAULT true,
  -- Section 3.4 of the phase design: a scope is granted per request, so the
  -- ID token is distinguished from the access token by data, not by the ask.
  include_in_id_token    boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_scopes_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT client_scopes_tenant_id_unique UNIQUE (tenant_id, id),
  -- RFC 6749 section 3.3 scope-token: %x21 / %x23-5B / %x5D-7E, one or more.
  CONSTRAINT client_scopes_name_is_scope_token
    CHECK (name ~ '^[\x21\x23-\x5B\x5D-\x7E]+$')
);

CREATE TABLE client_scope_assignments (
  tenant_id        uuid NOT NULL,
  client_id       uuid NOT NULL,
  client_scope_id uuid NOT NULL,
  assignment      text NOT NULL,
  PRIMARY KEY (client_id, client_scope_id),
  CONSTRAINT client_scope_assignments_assignment_check
    CHECK (assignment IN ('default', 'optional')),
  CONSTRAINT client_scope_assignments_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT client_scope_assignments_scope_fk
    FOREIGN KEY (tenant_id, client_scope_id) REFERENCES client_scopes(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE client_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scopes_isolation ON client_scopes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE client_scope_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scope_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scope_assignments_isolation ON client_scope_assignments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Append to `_journal.json`: `{ "idx": 16, "version": "7", "when": 1789049381659, "tag": "0016_client_scopes", "breakpoints": true }`.

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/domain-tenant/tests/client-scopes.int.test.ts
describe('client scope names', () => {
  it('refuses a name containing a space, which is the scope separator', async () => {
    await expect(create({ name: 'read write' })).rejects.toThrow(
      /client_scopes_name_is_scope_token/,
    );
  });

  it('refuses an empty name', async () => {
    await expect(create({ name: '' })).rejects.toThrow(/client_scopes_name_is_scope_token/);
  });

  it('accepts the OIDC vocabulary and a resource-server style scope', async () => {
    for (const name of ['openid', 'profile', 'roles', 'reports:read']) {
      await expect(create({ name })).resolves.toMatchObject({ name });
    }
  });

  it('refuses a duplicate name in one tenant but permits it across tenants', async () => {
    await create({ name: 'roles', tenantId: tenantA });
    await expect(create({ name: 'roles', tenantId: tenantA })).rejects.toThrow(
      /client_scopes_name_unique/,
    );
    await expect(create({ name: 'roles', tenantId: tenantB })).resolves.toBeDefined();
  });
});

describe('assignment', () => {
  it('refuses an assignment that is neither default nor optional', async () => {
    await expect(assign(clientId, scopeId, 'sometimes')).rejects.toThrow(
      /client_scope_assignments_assignment_check/,
    );
  });

  it('returns nothing for a client in another tenant', async () => {
    const scopes = await withTenant(db, tenantB, (tx) =>
      clientScopeRepository(tx).forClient(clientInTenantA),
    );
    expect(scopes).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/domain-tenant test:int client-scopes`
Expected: FAIL — the table does not exist.

- [ ] **Step 4: Write the schema and the repository**

`packages/domain-tenant/src/schema/client-scopes.ts` mirrors the SQL with `pgTable(...).enableRLS()`, following `clients.ts` exactly — policies stay hand-authored SQL, never `pgPolicy()`. The record interface lives beside the table, not in the repository, so `service` can reference the shape without depending on the layer that reads it.

`packages/domain-tenant/src/repository/client-scopes.ts` exposes `allForTenant()`, `byName(name)`, `forClient(clientId)` (joining assignments), `create(input)` and `assign(clientId, scopeId, assignment)`. Every method reads through the `TenantScopedDatabase` it is given and adds no `tenant_id` predicate of its own — RLS is the filter, which is what the foreign-tenant probes prove.

Export all of it from `packages/domain-tenant/src/index.ts`.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @odudu/domain-tenant test:int client-scopes`
Expected: PASS.

- [ ] **Step 6: Seed the OIDC vocabulary per tenant**

The tenant bootstrap that today creates a tenant must now also create its seven scopes, so that Task 5 can delete `SUPPORTED_SCOPES` without changing behaviour:

| name      | `include_in_token_scope` | `include_in_id_token` |
| --------- | ------------------------ | --------------------- |
| `openid`  | true                     | true                  |
| `profile` | true                     | true                  |
| `email`   | true                     | true                  |
| `address` | true                     | true                  |
| `phone`   | true                     | true                  |
| `roles`   | true                     | **false**             |
| `groups`  | true                     | **false**             |

`roles` and `groups` are off for the ID token deliberately: it reaches the browser, and a full role list there is size and disclosure a client cannot opt out of.

**Amended during execution: seed only the three scopes whose claim mappers
exist** — `openid`, `profile`, `email`. `standardClaimMappers()` registers
`sub`, `profile` and `email` and nothing else, so seeding the other four would
advertise in `scopes_supported` four promises about claims that no mapper
produces — the same dishonesty `discovery.ts` already refuses in the other
direction by holding `claims_supported` at `sub` until mappers existed. It
would also un-skip `oidcc-scope-address`, `oidcc-scope-phone` and
`oidcc-scope-all` in the conformance job, which would then fail. The remaining
four rows above are created by the task that adds their mapper: `roles` and
`groups` in Task 10, `address` and `phone` in Task 13. Defining them without
assigning them is **not** an alternative — `scopes_supported` is built from
`allForTenant()`, so a defined scope is an advertised one.

- [ ] **Step 7: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/db/drizzle packages/domain-tenant
git commit -m "Make a scope a thing a tenant owns rather than a constant in the binary"
```

---

### Task 5: Scopes sourced from the tenant — discovery, `/authorize`, `resolveScope`

The riskiest task in the phase: it touches discovery, the authorization endpoint and token issuance at once, and every P1 scope test moves from a constant to tenant data. It is its own increment and ends green before any role work starts.

**Files:**

- Modify: `packages/contracts/src/discovery.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/protocol-oidc/src/service/authorize-validation.ts`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:319`
- Modify: `packages/protocol-oidc/src/service/authorize-validation.test.ts`
- Create: `packages/protocol-oidc/tests/tenant-scopes.int.test.ts`
- Modify: `docs/request-paths.md`

**Interfaces:**

- Consumes: `clientScopeRepository(tx).forClient(clientId)` and `.allForTenant()` (Task 4)
- Produces:
  - `discoveryDocument(opts)` takes `scopesSupported: readonly string[]`; the `SUPPORTED_SCOPES` export is **deleted**
  - `validateAuthorizationRequest(params, client, config, knownScopes: ReadonlySet<string>, clientScopes: ReadonlySet<string>)`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/protocol-oidc/tests/tenant-scopes.int.test.ts
describe('scopes come from the tenant', () => {
  it('advertises exactly the scopes the tenant defines', async () => {
    await createScope(tenantId, { name: 'reports:read' });
    const res = await app.inject({ url: '/tenants/demo/.well-known/openid-configuration' });
    expect(res.json().scopes_supported).toContain('reports:read');
  });

  it('refuses a scope the tenant has never heard of', async () => {
    const res = await authorizeWith({ scope: 'openid nonsense' });
    expect(res.headers.location).toContain('error=invalid_scope');
  });

  it('refuses a scope the tenant defines but this client is not assigned', async () => {
    await createScope(tenantId, { name: 'reports:read' });
    // deliberately not assigned to `app-a`
    const res = await authorizeWith({ clientId: 'app-a', scope: 'openid reports:read' });
    expect(res.headers.location).toContain('error=invalid_scope');
  });

  it('grants a scope the client is assigned', async () => {
    const scope = await createScope(tenantId, { name: 'reports:read' });
    await assign('app-a', scope.id, 'optional');
    const res = await authorizeWith({ clientId: 'app-a', scope: 'openid reports:read' });
    expect(res.headers.location).not.toContain('error=');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @odudu/protocol-oidc test:int tenant-scopes`
Expected: FAIL — `scopes_supported` is the frozen three-element constant.

- [ ] **Step 3: Take the scope list out of `contracts`**

Delete `SUPPORTED_SCOPES` from `packages/contracts/src/discovery.ts` and its re-export from `index.ts`. Add `scopesSupported: readonly string[]` to `DiscoveryDocumentOptions` and use it for the `scopes_supported` member. `contracts` is a leaf and must not learn how to read a database; the caller supplies the list.

- [ ] **Step 4: Make `/authorize` validate against tenant data**

`validateAuthorizationRequest` currently closes over a module-level `KNOWN_SCOPES` set. Give it two arguments instead, because the two failures are different and both are `invalid_scope`:

```ts
function scopesAreGrantable(
  scope: string | undefined,
  knownToTenant: ReadonlySet<string>,
  assignedToClient: ReadonlySet<string>,
): boolean {
  const tokens = (scope ?? 'openid').split(' ').filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((token) => knownToTenant.has(token) && assignedToClient.has(token));
}
```

A scope unknown to the tenant and a scope known but unassigned are both refused rather than silently dropped, which is what `/authorize` does today and what RFC 6749 section 3.3 asks for.

- [ ] **Step 5: Feed `resolveScope` real data**

`packages/protocol-oidc/src/usecase/token-issuance.ts:319` reads:

```ts
const scope = resolveScope(code.scope, [...SUPPORTED_SCOPES], null, null);
```

Replace the second argument with the scopes assigned to the redeeming client, read through `clientScopeRepository(tx).forClient(client.id)`. The `consented` and `delegated` arguments stay `null`: consent is P3's and delegation is P5's, and the parameters exist so those arrivals need no change to this function's shape.

- [ ] **Step 6: Update the P1 unit tests that asserted the constant**

`packages/protocol-oidc/src/service/authorize-validation.test.ts` has a test named _"accepts exactly what discovery advertises as scopes_supported, and nothing beyond it"_ which reads `discoveryDocument(...).scopes_supported`. It still holds — the property is that validation and discovery agree — but both sides now come from the same tenant-derived list passed in, rather than from a shared import. Rewrite it to pass one set to both and assert they agree; do not delete it. It is the only test standing between the two lists drifting apart.

- [ ] **Step 7: Run everything**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 8: Update the documentation and commit**

`docs/request-paths.md` describes `scopes_supported` as a fixed list in at least one place. Re-run the discovery transcript against the running stack and paste the real output; add a line saying a scope must be both defined by the tenant and assigned to the client.

```bash
git add packages/contracts packages/protocol-oidc docs/request-paths.md
git commit -m "Read the supported scopes from the tenant that defines them"
```

---

### Task 6: Spike — does a recursive CTE terminate on a cyclic graph?

Effective-role resolution runs on the hot path of every token issuance. If a `UNION` recursive CTE does not terminate on a cycle, a hang is reachable from data an operator can enter. The claim is verified against real PostgreSQL, in the exact query shape Task 8 will use, before it is written into code.

**Files:**

- Modify: `docs/superpowers/p2a-spike-log.md`

**Interfaces:**

- Consumes: nothing
- Produces: a finding under `## Recursive CTE termination on a cyclic role graph`, either `verified: UNION terminates; UNION ALL hangs` or a description of what actually happened. Task 8 cites this.

- [ ] **Step 1: Start a throwaway PostgreSQL and build a cyclic graph**

```bash
docker run --rm -d --name cte-spike -e POSTGRES_PASSWORD=spike -p 55432:5432 postgres:17
sleep 3
```

- [ ] **Step 2: Run the probe**

Three roles in a cycle — `a` includes `b`, `b` includes `c`, `c` includes `a` — which the `parent <> child` CHECK permits, because it only refuses self-reference.

```bash
PGPASSWORD=spike psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE role_composites (parent_role_id text, child_role_id text);
INSERT INTO role_composites VALUES ('a','b'), ('b','c'), ('c','a');

SET statement_timeout = '5s';

WITH RECURSIVE seed AS (SELECT 'a'::text AS role_id),
role_closure AS (
  SELECT role_id FROM seed
  UNION
  SELECT rc.child_role_id FROM role_composites rc
    JOIN role_closure c ON rc.parent_role_id = c.role_id
)
SELECT role_id FROM role_closure ORDER BY role_id;
SQL
```

Expected if the assumption holds: three rows — `a`, `b`, `c` — returned well inside the five-second timeout, because `UNION` discards duplicates and the frontier empties.

- [ ] **Step 3: Prove the test would catch the mistake**

Re-run the identical query with `UNION ALL` in place of `UNION`.

Expected: `ERROR: canceling statement due to statement timeout`. If `UNION ALL` _also_ returns, the probe is not exercising a cycle and Step 2's result proves nothing — fix the fixture before recording anything.

- [ ] **Step 4: Record both results and stop the container**

Append to `docs/superpowers/p2a-spike-log.md`: the exact commands, both outputs verbatim, and the conclusion. Then:

```bash
docker rm -f cte-spike
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/p2a-spike-log.md
git commit -m "Establish that a UNION recursive CTE survives a cyclic role graph"
```

---

### Task 7: Roles — migration 0017, the repository, and cycle refusal

**Files:**

- Create: `packages/domain-authz/` (new package: `package.json`, `tsconfig.json`, `src/index.ts`)
- Create: `packages/db/drizzle/0017_roles.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/domain-authz/src/schema/roles.ts`
- Create: `packages/domain-authz/src/repository/roles.ts`
- Create: `packages/domain-authz/src/service/role-name.ts`
- Create: `packages/domain-authz/src/service/role-name.test.ts`
- Create: `packages/domain-authz/tests/roles.int.test.ts`
- Modify: `tests/boundaries/boundaries.test.ts`, `.dependency-cruiser.cjs`

**Interfaces:**

- Consumes: `tenants` and `clients` tables
- Produces:
  - `roles`, `role_composites`, `subject_roles`, `client_scope_roles` tables
  - `interface RoleRecord { id, tenantId, clientId: string | null, name, description, defaultForNewSubjects }`
  - `qualifiedRoleName(role: { name: string }, clientKey: string | null): string`
  - `roleRepository(tx)` with `create`, `byName`, `addComposite`, `assignToSubject`, `mapToClientScope`, `defaultsForTenant`

- [ ] **Step 1: Scaffold the package**

`packages/domain-authz/package.json` copies `packages/domain-tenant/package.json`, changing the name to `@odudu/domain-authz`. It declares `"imports": { "#/*": "./src/*.ts" }` and depends on `@odudu/db` and `@odudu/kernel` and **nothing else** — in particular not `@odudu/domain-tenant`, so that a role's `client_id` is an id this package never dereferences.

Add the package to `tests/boundaries/boundaries.test.ts` and the `dependency-cruiser` rules in the same commit. A dead rule there is one of the defects the P0 decision log records, so assert it bites: add a fixture importing `@odudu/protocol-oidc` from `domain-authz` and confirm the rule rejects it.

- [ ] **Step 2: Write the failing unit test for the name grammar**

```ts
// packages/domain-authz/src/service/role-name.test.ts
import { describe, expect, it } from 'vitest';
import { qualifiedRoleName } from '#/service/role-name';

describe('qualifiedRoleName', () => {
  it('leaves a tenant role bare', () => {
    expect(qualifiedRoleName({ name: 'admin' }, null)).toBe('admin');
  });

  it('qualifies a client role with the owning client', () => {
    expect(qualifiedRoleName({ name: 'reader' }, 'reports-api')).toBe('reports-api:reader');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/domain-authz test role-name`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement it**

```ts
// packages/domain-authz/src/service/role-name.ts

// A tenant role is bare, a client role is qualified by its owning client.
// The database refuses `:` in a role name, so the qualified form cannot be
// ambiguous and this join needs no escaping.
export function qualifiedRoleName(
  role: { readonly name: string },
  clientKey: string | null,
): string {
  return clientKey === null ? role.name : `${clientKey}:${role.name}`;
}
```

- [ ] **Step 5: Write the migration**

```sql
-- packages/db/drizzle/0017_roles.sql
CREATE TABLE roles (
  id                       uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id                uuid,
  name                     text NOT NULL,
  description              text,
  default_for_new_subjects boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_tenant_id_unique UNIQUE (tenant_id, id),
  -- What makes `clientId:roleName` unambiguous. Enforced here rather than in
  -- the code that formats the claim, so no ambiguous role can exist at all.
  CONSTRAINT roles_name_has_no_colon CHECK (name !~ ':' AND name <> ''),
  CONSTRAINT roles_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX roles_tenant_name ON roles (tenant_id, name) WHERE client_id IS NULL;
CREATE UNIQUE INDEX roles_client_name ON roles (client_id, name) WHERE client_id IS NOT NULL;

CREATE TABLE role_composites (
  tenant_id       uuid NOT NULL,
  parent_role_id uuid NOT NULL,
  child_role_id  uuid NOT NULL,
  PRIMARY KEY (parent_role_id, child_role_id),
  CONSTRAINT role_composites_not_self CHECK (parent_role_id <> child_role_id),
  CONSTRAINT role_composites_parent_fk FOREIGN KEY (tenant_id, parent_role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT role_composites_child_fk FOREIGN KEY (tenant_id, child_role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE subject_roles (
  tenant_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  role_id    uuid NOT NULL,
  PRIMARY KEY (subject_id, role_id),
  CONSTRAINT subject_roles_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT subject_roles_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE client_scope_roles (
  tenant_id        uuid NOT NULL,
  client_scope_id uuid NOT NULL,
  role_id         uuid NOT NULL,
  PRIMARY KEY (client_scope_id, role_id),
  CONSTRAINT client_scope_roles_scope_fk FOREIGN KEY (tenant_id, client_scope_id)
    REFERENCES client_scopes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT client_scope_roles_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

-- Bypasses the scope-mapping intersection. It belongs in this migration
-- rather than with client scopes because there are no roles to intersect
-- until now. Off by default: a new client's tokens carry no roles until an
-- operator maps them.
ALTER TABLE clients ADD COLUMN full_scope_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE role_composites ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_composites FORCE ROW LEVEL SECURITY;
CREATE POLICY role_composites_isolation ON role_composites
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE subject_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY subject_roles_isolation ON subject_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE client_scope_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scope_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scope_roles_isolation ON client_scope_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Append to `_journal.json`: `{ "idx": 17, "version": "7", "when": 1789049381660, "tag": "0017_roles", "breakpoints": true }`.

- [ ] **Step 6: Write the failing integration test**

```ts
// packages/domain-authz/tests/roles.int.test.ts
describe('role names', () => {
  it('refuses a colon, which would make the qualified form ambiguous', async () => {
    await expect(createRole({ name: 'reports-api:reader' })).rejects.toThrow(
      /roles_name_has_no_colon/,
    );
  });

  it('permits the same name as a tenant role and as a client role', async () => {
    await expect(createRole({ name: 'reader', clientId: null })).resolves.toBeDefined();
    await expect(createRole({ name: 'reader', clientId: reportsApi })).resolves.toBeDefined();
  });

  it('refuses two tenant roles of the same name', async () => {
    await createRole({ name: 'admin', clientId: null });
    await expect(createRole({ name: 'admin', clientId: null })).rejects.toThrow(
      /roles_tenant_name/,
    );
  });
});

describe('composites', () => {
  it('refuses a role that includes itself', async () => {
    const role = await createRole({ name: 'admin' });
    await expect(addComposite(role.id, role.id)).rejects.toThrow(/role_composites_not_self/);
  });

  it('refuses a cycle the CHECK cannot see', async () => {
    const a = await createRole({ name: 'a' });
    const b = await createRole({ name: 'b' });
    await addComposite(a.id, b.id);
    await expect(addComposite(b.id, a.id)).rejects.toThrow(/would create a cycle/);
  });
});

describe('tenant isolation', () => {
  it('finds no role from another tenant', async () => {
    await createRole({ name: 'admin', tenantId: tenantA });
    const found = await withTenant(db, tenantB, (tx) => roleRepository(tx).byName('admin', null));
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter @odudu/domain-authz test:int roles`
Expected: FAIL — the tables do not exist.

- [ ] **Step 8: Implement the schema, the repository, and cycle refusal**

The schema file mirrors the SQL with `pgTable(...).enableRLS()`, following `packages/domain-tenant/src/schema/clients.ts`.

`addComposite` refuses a cycle before inserting, by asking whether the proposed child already reaches the proposed parent:

```ts
    // The CHECK constraint refuses only self-reference. A longer cycle is
    // refused here: if the child already reaches the parent, adding this
    // edge closes a loop. The resolving query survives one anyway (it
    // unions), but a graph nobody can read back is not worth storing.
    async addComposite(parentRoleId: string, childRoleId: string): Promise<void> {
      const reachable = await closureFrom(tx, childRoleId);
      if (reachable.has(parentRoleId)) {
        throw new OduduError('role_composite_cycle', 'would create a cycle');
      }
      await tx.insert(roleComposites).values({ tenantId, parentRoleId, childRoleId });
    },
```

- [ ] **Step 9: Run it and watch it pass**

Run: `pnpm --filter @odudu/domain-authz test:int roles`
Expected: PASS.

- [ ] **Step 10: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/domain-authz packages/db/drizzle tests/boundaries .dependency-cruiser.cjs
git commit -m "Give a tenant roles, and refuse the ones that cannot be named or resolved"
```

---

### Task 8: Effective-role resolution — the composite closure

**Files:**

- Create: `packages/domain-authz/src/repository/effective-roles.ts`
- Create: `packages/domain-authz/tests/effective-roles.int.test.ts`
- Modify: `packages/domain-authz/src/index.ts`

**Interfaces:**

- Consumes: the Task 6 finding; `roles`, `role_composites`, `subject_roles` (Task 7)
- Produces: `effectiveRoles(tx, subjectId): Promise<readonly EffectiveRole[]>` where `interface EffectiveRole { roleId: string; name: string; clientKey: string | null }`. `clientKey` is the OAuth `client_id` string of the owning client, or `null` for a tenant role. Task 9 extends the same query with groups; Task 10 formats the result into a claim.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/domain-authz/tests/effective-roles.int.test.ts
describe('effectiveRoles', () => {
  it('returns a directly assigned tenant role', async () => {
    const admin = await createRole({ name: 'admin' });
    await assignToSubject(subject, admin.id);
    expect(await names(subject)).toEqual(['admin']);
  });

  it('follows a composite one level down', async () => {
    const admin = await createRole({ name: 'admin' });
    const reader = await createRole({ name: 'reader' });
    await addComposite(admin.id, reader.id);
    await assignToSubject(subject, admin.id);
    expect(await names(subject)).toEqual(['admin', 'reader']);
  });

  it('follows a composite chain to its end', async () => {
    const a = await createRole({ name: 'a' });
    const b = await createRole({ name: 'b' });
    const c = await createRole({ name: 'c' });
    await addComposite(a.id, b.id);
    await addComposite(b.id, c.id);
    await assignToSubject(subject, a.id);
    expect(await names(subject)).toEqual(['a', 'b', 'c']);
  });

  it('reports a client role with the owning client key, not its uuid', async () => {
    const reader = await createRole({ name: 'reader', clientId: reportsApiId });
    await assignToSubject(subject, reader.id);
    expect(await effectiveRoles(tx, subject)).toEqual([
      { roleId: reader.id, name: 'reader', clientKey: 'reports-api' },
    ]);
  });

  it('terminates on a cycle inserted behind the repository', async () => {
    // Written directly to the table, bypassing addComposite's refusal, so
    // that the query is proven to survive data a future writer might create.
    const a = await createRole({ name: 'a' });
    const b = await createRole({ name: 'b' });
    await rawInsertComposite(a.id, b.id);
    await rawInsertComposite(b.id, a.id);
    await assignToSubject(subject, a.id);
    expect(await names(subject)).toEqual(['a', 'b']);
  }, 10_000);

  it('returns nothing for a subject in another tenant', async () => {
    const admin = await createRole({ name: 'admin', tenantId: tenantA });
    await assignToSubject(subjectInA, admin.id);
    const found = await withTenant(db, tenantB, (tx) => effectiveRoles(tx, subjectInA));
    expect(found).toEqual([]);
  });
});
```

The cycle test carries an explicit 10-second timeout for a reason: without one, a non-terminating query hangs the whole suite rather than failing this test, and the failure it was written to catch would look like infrastructure trouble.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @odudu/domain-authz test:int effective-roles`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the closure**

`UNION`, never `UNION ALL` — the Task 6 finding is what this rests on, and the comment names the reason rather than the spike.

```ts
// packages/domain-authz/src/repository/effective-roles.ts
import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

export interface EffectiveRole {
  readonly roleId: string;
  readonly name: string;
  readonly clientKey: string | null;
}

interface EffectiveRoleRow {
  role_id: string;
  name: string;
  client_key: string | null;
}

// UNION rather than UNION ALL: duplicates are discarded, so a cyclic
// composite graph empties its frontier and the query ends. UNION ALL on the
// same data does not terminate.
export async function effectiveRoles(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<readonly EffectiveRole[]> {
  const rows = await tx.execute<EffectiveRoleRow>(sql`
    WITH RECURSIVE seed_roles AS (
      SELECT role_id FROM subject_roles WHERE subject_id = ${subjectId}
    ),
    role_closure AS (
      SELECT role_id FROM seed_roles
      UNION
      SELECT rc.child_role_id
      FROM role_composites rc
      JOIN role_closure c ON rc.parent_role_id = c.role_id
    )
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM role_closure rc
    JOIN roles r ON r.id = rc.role_id
    LEFT JOIN clients cl ON cl.id = r.client_id
  `);

  return rows.map((row) => ({
    roleId: row.role_id,
    name: row.name,
    clientKey: row.client_key,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @odudu/domain-authz test:int effective-roles`
Expected: PASS, including the cycle case inside its timeout.

- [ ] **Step 5: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/domain-authz
git commit -m "Resolve the roles a subject actually holds, cycles included"
```

---

### Task 9: Groups — migration 0018, path maintenance, inherited roles

**Files:**

- Create: `packages/db/drizzle/0018_groups.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/domain-authz/src/schema/groups.ts`
- Create: `packages/domain-authz/src/repository/groups.ts`
- Modify: `packages/domain-authz/src/repository/effective-roles.ts`
- Create: `packages/domain-authz/tests/groups.int.test.ts`
- Modify: `packages/domain-authz/tests/effective-roles.int.test.ts`

**Interfaces:**

- Consumes: `effectiveRoles` (Task 8)
- Produces:
  - `groups`, `group_roles`, `subject_groups` tables
  - `groupRepository(tx)` with `create({ name, parentId })`, `byPath(path)`, `addToSubject`, `mapRole`
  - `effectiveGroupPaths(tx, subjectId): Promise<readonly string[]>`
  - `effectiveRoles` now includes roles inherited through groups and their ancestors

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0018_groups.sql
CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id  uuid,
  name       text NOT NULL,
  path       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT groups_path_unique UNIQUE (tenant_id, path),
  -- `/` separates path segments, so it cannot appear inside one.
  CONSTRAINT groups_name_has_no_slash CHECK (name !~ '/' AND name <> ''),
  CONSTRAINT groups_path_is_absolute CHECK (path LIKE '/%'),
  CONSTRAINT groups_parent_fk FOREIGN KEY (tenant_id, parent_id)
    REFERENCES groups(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE group_roles (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  role_id  uuid NOT NULL,
  PRIMARY KEY (group_id, role_id),
  CONSTRAINT group_roles_group_fk FOREIGN KEY (tenant_id, group_id)
    REFERENCES groups(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT group_roles_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE subject_groups (
  tenant_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  group_id   uuid NOT NULL,
  PRIMARY KEY (subject_id, group_id),
  CONSTRAINT subject_groups_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT subject_groups_group_fk FOREIGN KEY (tenant_id, group_id)
    REFERENCES groups(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY groups_isolation ON groups
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE group_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY group_roles_isolation ON group_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE subject_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY subject_groups_isolation ON subject_groups
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Append to `_journal.json`: `{ "idx": 18, "version": "7", "when": 1789049381661, "tag": "0018_groups", "breakpoints": true }`.

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/domain-authz/tests/groups.int.test.ts
describe('paths', () => {
  it('gives a top-level group a single-segment absolute path', async () => {
    const g = await createGroup({ name: 'engineering', parentId: null });
    expect(g.path).toBe('/engineering');
  });

  it('builds a child path from its parent', async () => {
    const parent = await createGroup({ name: 'engineering', parentId: null });
    const child = await createGroup({ name: 'platform', parentId: parent.id });
    expect(child.path).toBe('/engineering/platform');
  });

  it('permits the same name under two different parents', async () => {
    const a = await createGroup({ name: 'engineering', parentId: null });
    const b = await createGroup({ name: 'sales', parentId: null });
    await expect(createGroup({ name: 'platform', parentId: a.id })).resolves.toMatchObject({
      path: '/engineering/platform',
    });
    await expect(createGroup({ name: 'platform', parentId: b.id })).resolves.toMatchObject({
      path: '/sales/platform',
    });
  });

  it('refuses a name containing the separator', async () => {
    await expect(createGroup({ name: 'a/b', parentId: null })).rejects.toThrow(
      /groups_name_has_no_slash/,
    );
  });

  it('refuses a group that would be its own ancestor', async () => {
    const a = await createGroup({ name: 'a', parentId: null });
    const b = await createGroup({ name: 'b', parentId: a.id });
    await expect(reparent(a.id, b.id)).rejects.toThrow(/would create a cycle/);
  });
});

describe('group membership and roles', () => {
  it('grants a role mapped to the group the subject is in', async () => {
    const g = await createGroup({ name: 'engineering', parentId: null });
    const role = await createRole({ name: 'deployer' });
    await mapRole(g.id, role.id);
    await addToSubject(subject, g.id);
    expect(await names(subject)).toEqual(['deployer']);
  });

  it('inherits a role mapped to an ancestor of the group the subject is in', async () => {
    const parent = await createGroup({ name: 'engineering', parentId: null });
    const child = await createGroup({ name: 'platform', parentId: parent.id });
    const role = await createRole({ name: 'deployer' });
    await mapRole(parent.id, role.id);
    await addToSubject(subject, child.id);
    expect(await names(subject)).toEqual(['deployer']);
  });

  it('does not grant a role mapped to a descendant', async () => {
    const parent = await createGroup({ name: 'engineering', parentId: null });
    const child = await createGroup({ name: 'platform', parentId: parent.id });
    const role = await createRole({ name: 'deployer' });
    await mapRole(child.id, role.id);
    await addToSubject(subject, parent.id);
    expect(await names(subject)).toEqual([]);
  });

  it('reports the paths of the groups a subject belongs to', async () => {
    const parent = await createGroup({ name: 'engineering', parentId: null });
    const child = await createGroup({ name: 'platform', parentId: parent.id });
    await addToSubject(subject, child.id);
    expect(await effectiveGroupPaths(tx, subject)).toEqual(['/engineering/platform']);
  });

  it('finds no group from another tenant', async () => {
    await createGroup({ name: 'engineering', parentId: null, tenantId: tenantA });
    const found = await withTenant(db, tenantB, (tx) => groupRepository(tx).byPath('/engineering'));
    expect(found).toBeNull();
  });
});
```

The third test — _does not grant a role mapped to a descendant_ — is the one that proves inheritance runs in only one direction. Without it, a resolver that walked the tree in both directions would pass every other test here.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/domain-authz test:int groups`
Expected: FAIL — the tables do not exist.

- [ ] **Step 4: Implement the repository**

`path` is denormalized and this repository is its **only writer**: `create` reads the parent's path and appends, in the same transaction. `reparent` refuses a cycle the way `addComposite` does, then rewrites the subtree's paths.

- [ ] **Step 5: Extend the closure to groups**

`effectiveRoles` gains a group-ancestor walk feeding the same seed. `WITH RECURSIVE` introduces the whole `WITH` list, so both recursive terms live in one statement:

```sql
    WITH RECURSIVE group_closure AS (
      SELECT g.id, g.parent_id
      FROM groups g
      JOIN subject_groups sg ON sg.group_id = g.id
      WHERE sg.subject_id = ${subjectId}
      UNION
      SELECT p.id, p.parent_id
      FROM groups p
      JOIN group_closure c ON p.id = c.parent_id
    ),
    seed_roles AS (
      SELECT role_id FROM subject_roles WHERE subject_id = ${subjectId}
      UNION
      SELECT gr.role_id FROM group_roles gr JOIN group_closure gc ON gc.id = gr.group_id
    ),
    role_closure AS (
      SELECT role_id FROM seed_roles
      UNION
      SELECT rc.child_role_id
      FROM role_composites rc
      JOIN role_closure c ON rc.parent_role_id = c.role_id
    )
```

The walk goes child → parent (`p.id = c.parent_id`), which is what makes a role inherited downward and never upward.

- [ ] **Step 6: Run both suites and watch them pass**

Run: `pnpm --filter @odudu/domain-authz test:int`
Expected: PASS — Task 8's assertions unchanged and still green.

- [ ] **Step 7: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/domain-authz packages/db/drizzle
git commit -m "Nest groups, inherit their roles downward, and identify one by its path"
```

---

### Task 10: The `roles` and `groups` claim mappers

**Files:**

- Modify: `packages/protocol-oidc/src/service/claims.ts`
- Modify: `packages/protocol-oidc/src/service/claims.test.ts`
- Modify: `packages/protocol-oidc/src/usecase/userinfo.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`

**Interfaces:**

- Consumes: `effectiveRoles`, `effectiveGroupPaths`, `qualifiedRoleName` (Tasks 7–9)
- Produces:
  - `ClaimContext` widened to `{ subjectId, user, roles: readonly EffectiveRole[], groups: readonly string[] }`
  - `rolesMapper` (scope `roles`, claim `roles`), `groupsMapper` (scope `groups`, claim `groups`), both registered in `standardClaimMappers()`

- [ ] **Step 1: Write the failing unit tests**

```ts
// packages/protocol-oidc/src/service/claims.test.ts (added)
describe('roles claim', () => {
  const ctx = {
    subjectId: 'sub-1',
    user: null,
    roles: [
      { roleId: 'r2', name: 'reader', clientKey: 'reports-api' },
      { roleId: 'r1', name: 'admin', clientKey: null },
      { roleId: 'r3', name: 'admin', clientKey: null },
    ],
    groups: ['/engineering/platform', '/engineering'],
  };

  it('emits tenant roles bare and client roles qualified', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], ctx);
    expect(claims.roles).toEqual(['admin', 'reports-api:reader']);
  });

  it('sorts and de-duplicates, so a token is reproducible', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], ctx);
    expect(claims.roles).toEqual([...new Set(claims.roles)].sort());
  });

  it('emits nothing when the roles scope was not granted', async () => {
    const claims = await standardClaimMappers().assemble(['openid'], ctx);
    expect(claims).not.toHaveProperty('roles');
  });

  it('omits the claim entirely rather than emitting an empty array', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], {
      ...ctx,
      roles: [],
    });
    expect(claims).not.toHaveProperty('roles');
  });

  it('never emits entitlements', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles', 'groups'], ctx);
    expect(claims).not.toHaveProperty('entitlements');
  });
});

describe('groups claim', () => {
  it('emits sorted paths as an array of strings', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'groups'], ctx);
    expect(claims.groups).toEqual(['/engineering', '/engineering/platform']);
  });
});
```

The "omits rather than empties" assertion matters: an empty `roles` array and an absent one read the same to a careless consumer and differently to a careful one, and the `email` mapper already sets the precedent of leaving a claim out rather than asserting an empty value.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @odudu/protocol-oidc test claims`
Expected: FAIL — `ClaimContext` has no `roles`.

- [ ] **Step 3: Implement the mappers**

```ts
// packages/protocol-oidc/src/service/claims.ts (added)

// RFC 9068 section 2.2.3.1 names `roles` and `groups`, referencing RFC 7643
// section 4.1.2. Both are string arrays here rather than that schema's
// complex form — see the reading note in docs/protocols/rfc9068.md.
const rolesMapper: ClaimMapper<ClaimContext> = {
  name: 'roles',
  scopes: ['roles'],
  claims: ['roles'],
  map: (ctx) => {
    const names = [
      ...new Set(ctx.roles.map((role) => qualifiedRoleName(role, role.clientKey))),
    ].sort();
    return Promise.resolve(names.length === 0 ? {} : { roles: names });
  },
};

const groupsMapper: ClaimMapper<ClaimContext> = {
  name: 'groups',
  scopes: ['groups'],
  claims: ['groups'],
  map: (ctx) => {
    const paths = [...new Set(ctx.groups)].sort();
    return Promise.resolve(paths.length === 0 ? {} : { groups: paths });
  },
};
```

Widen `ClaimContext` and register both in `standardClaimMappers()`.

**In this same commit, add `roles` and `groups` to `TENANT_DEFAULT_SCOPE_NAMES`**
(`packages/domain-tenant/src/usecase/provision-defaults.ts`) and to the default
set `provisionClientDefaults` assigns. Task 4's seed was reduced to the three
scopes whose mappers existed; a scope joins the tenant vocabulary in the commit
that makes it true, so that `scopes_supported` never advertises a promise
nothing keeps. The discovery transcript in `docs/request-paths.md` changes with
it and must be re-run, not edited.

- [ ] **Step 4: Resolve in the usecase, not the mapper**

`claims.ts` states that a mapper never runs a query: `service` is a leaf, and the usecase does the one lookup. Roles need a recursive CTE, so `userinfo.ts` and `token-issuance.ts` call `effectiveRoles` and `effectiveGroupPaths` **once** and pass the results in. Do not make the mapper query; the expensive work must happen once per issuance, not once per mapper.

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @odudu/protocol-oidc test claims`
Expected: PASS.

- [ ] **Step 6: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/protocol-oidc
git commit -m "Emit roles and groups under the names the JWT registry gives them"
```

---

### Task 11: The access token runs the registry, and scope mappings narrow it

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:286-304`
- Create: `packages/protocol-oidc/src/service/scope-mapping.ts`
- Create: `packages/protocol-oidc/src/service/scope-mapping.test.ts`
- Create: `packages/protocol-oidc/tests/role-claims.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: `effectiveRoles` (Task 8), `clientScopeRepository` (Task 4), `client_scope_roles` (Task 7), the mappers (Task 10)
- Produces: `narrowByScopeMappings(roles, mappedRoleIds, fullScopeAllowed): readonly EffectiveRole[]`

- [ ] **Step 1: Write the failing unit tests**

```ts
// packages/protocol-oidc/src/service/scope-mapping.test.ts
import { describe, expect, it } from 'vitest';
import { narrowByScopeMappings } from '#/service/scope-mapping';

const held = [
  { roleId: 'r1', name: 'admin', clientKey: null },
  { roleId: 'r2', name: 'reader', clientKey: 'reports-api' },
];

describe('narrowByScopeMappings', () => {
  it('withholds a role the granted scopes do not reach', () => {
    expect(narrowByScopeMappings(held, new Set(['r2']), false)).toEqual([held[1]]);
  });

  it('withholds everything when nothing is mapped', () => {
    expect(narrowByScopeMappings(held, new Set(), false)).toEqual([]);
  });

  it('passes everything through when the client has full scope', () => {
    expect(narrowByScopeMappings(held, new Set(), true)).toEqual(held);
  });
});
```

The first two assertions are the load-bearing ones. The failure mode is **over-disclosure**, so a test asserting a role _is_ present would pass against an implementation that does no narrowing at all.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @odudu/protocol-oidc test scope-mapping`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// packages/protocol-oidc/src/service/scope-mapping.ts
import { type EffectiveRole } from '@odudu/domain-authz';

// A role reaches a token only if the granted scopes reach it. Without this,
// one login tells a client the tenant's entire role vocabulary.
export function narrowByScopeMappings(
  held: readonly EffectiveRole[],
  reachableRoleIds: ReadonlySet<string>,
  fullScopeAllowed: boolean,
): readonly EffectiveRole[] {
  if (fullScopeAllowed) return held;
  return held.filter((role) => reachableRoleIds.has(role.roleId));
}
```

- [ ] **Step 4: Run them and watch them pass, then extend `mintAccessToken`**

Run: `pnpm --filter @odudu/protocol-oidc test scope-mapping`
Expected: PASS.

`mintAccessToken` at `token-issuance.ts:286` builds a fixed claim set today; the registry has only ever fed the ID token and `/userinfo`. Assemble mapper claims there too, gated on granted scope exactly as the ID token's are, and spread them **under** the registered claims so no mapper can overwrite `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `client_id` or `scope`:

```ts
const mapped = await deps.claimMappers.assemble(input.scope, claimContext);
const accessTokenClaims = { ...mapped, iss: deps.issuer, sub: input.subjectId /* … */ };
```

The ID token's own assembly gains the `include_in_id_token` gate from Task 4: a scope granted on the request contributes to the ID token only if its definition says so, which ships off for `roles` and `groups`.

- [ ] **Step 5: Write the end-to-end integration test**

```ts
// packages/protocol-oidc/tests/role-claims.int.test.ts
describe('roles in an issued token', () => {
  it('withholds a held role that the client scopes do not reach', async () => {
    await giveSubjectRole('admin'); // held, but mapped to no scope
    const { access_token } = await completeCodeFlow({ scope: 'openid roles' });
    expect(decode(access_token)).not.toHaveProperty('roles');
  });

  it('emits a role once its scope is mapped', async () => {
    const admin = await giveSubjectRole('admin');
    await mapRoleToScope(admin, 'roles');
    const { access_token } = await completeCodeFlow({ scope: 'openid roles' });
    expect(decode(access_token).roles).toEqual(['admin']);
  });

  it('keeps roles out of the ID token, which the browser sees', async () => {
    const admin = await giveSubjectRole('admin');
    await mapRoleToScope(admin, 'roles');
    const { id_token } = await completeCodeFlow({ scope: 'openid roles' });
    expect(decode(id_token)).not.toHaveProperty('roles');
  });

  it('returns them from userinfo on the same gate', async () => {
    const admin = await giveSubjectRole('admin');
    await mapRoleToScope(admin, 'roles');
    const { access_token } = await completeCodeFlow({ scope: 'openid roles' });
    expect((await userinfo(access_token)).roles).toEqual(['admin']);
  });

  it('lets a mapper claim overwrite no registered claim', async () => {
    // A scope whose mapper tries to set `sub` must not succeed; the
    // registered claims are spread last for exactly this reason.
    const { access_token } = await completeCodeFlow({ scope: 'openid roles' });
    expect(decode(access_token).sub).toBe(subjectId);
  });
});
```

- [ ] **Step 6: Run everything**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 7: Document the contract and commit**

`docs/request-paths.md` gains a decoded access token showing the `roles` claim, produced by running the flow — not by hand-writing a plausible one. `README.md` gains the sentence that answers the predictable first support question: **a role reaches a token only when it is mapped to a scope the client is assigned, because `full_scope_allowed` is off by default.**

```bash
git add packages/protocol-oidc docs/request-paths.md README.md
git commit -m "Let a client see only the roles its scopes reach"
```

---

### Task 12: User profile — migration 0019 and the constrained columns

**Files:**

- Create: `packages/db/drizzle/0020_user_profile.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/domain-identity/src/schema/users.ts`
- Modify: `packages/domain-identity/src/repository/users.ts`
- Create: `packages/domain-identity/src/service/profile.ts`
- Create: `packages/domain-identity/src/service/profile.test.ts`
- Create: `packages/domain-identity/tests/profile.int.test.ts`

**Interfaces:**

- Consumes: the `users` table
- Produces:
  - `UserRecord` widened with every OIDC Core section 5.1 claim column
  - `isValidBirthdate(value: string): boolean`, `isValidZoneinfo`, `isValidLocale`
  - `userRepository(tx).updateProfile(subjectId, patch): Promise<UserRecord>`

- [ ] **Step 1: Write the migration**

Constraints go **on the column the claim is emitted from**, which is migration 0012's precedent: validating in the repository alone left the rule enforced on no path that actually produces a claim.

```sql
-- packages/db/drizzle/0020_user_profile.sql
ALTER TABLE users
  ADD COLUMN name                  text,
  ADD COLUMN given_name            text,
  ADD COLUMN family_name           text,
  ADD COLUMN middle_name           text,
  ADD COLUMN nickname              text,
  ADD COLUMN preferred_username    text,
  ADD COLUMN profile               text,
  ADD COLUMN picture               text,
  ADD COLUMN website               text,
  ADD COLUMN gender                text,
  ADD COLUMN birthdate             text,
  ADD COLUMN zoneinfo              text,
  ADD COLUMN locale                text,
  ADD COLUMN phone_number          text,
  ADD COLUMN phone_number_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN profile_updated_at    timestamptz,
  ADD COLUMN address_formatted     text,
  ADD COLUMN address_street        text,
  ADD COLUMN address_locality      text,
  ADD COLUMN address_region        text,
  ADD COLUMN address_postal_code   text,
  ADD COLUMN address_country       text;

-- OIDC Core section 5.1: YYYY-MM-DD, or YYYY alone when only the year is
-- known. 0000 is the permitted year for an address that withholds it, so
-- the pattern must not require a plausible year.
ALTER TABLE users ADD CONSTRAINT users_birthdate_shape
  CHECK (birthdate IS NULL OR birthdate ~ '^[0-9]{4}(-[0-9]{2}-[0-9]{2})?$');

ALTER TABLE users ADD CONSTRAINT users_zoneinfo_shape
  CHECK (zoneinfo IS NULL OR zoneinfo ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$');

ALTER TABLE users ADD CONSTRAINT users_locale_shape
  CHECK (locale IS NULL OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$');

ALTER TABLE users ADD CONSTRAINT users_profile_urls_are_http
  CHECK (
    (profile IS NULL OR profile ~ '^https?://')
    AND (picture IS NULL OR picture ~ '^https?://')
    AND (website IS NULL OR website ~ '^https?://')
  );
```

**`phone_number` gets no constraint, deliberately.** Section 5.1 says E.164 is RECOMMENDED, not required; a CHECK enforcing it would refuse a conformant value, which is a bug dressed as rigour. Record that in the migration as a one-line comment, not as an essay.

Append to `_journal.json`: `{ "idx": 20, "version": "7", "when": 1789049381663, "tag": "0020_user_profile", "breakpoints": true }`.

- [ ] **Step 2: Decide `users_lookup` explicitly**

`users_lookup` is `(tenant_id, username) INCLUDE (subject_id, email, email_verified)` — a covering index on the hot path of every token issuance, added because class-table inheritance puts that join there. **It is left unchanged, and that is a decision, not an omission:** it covers the _login_ lookup by username, whereas profile claims are read by `subject_id`, which is the primary key and needs no covering index. Adding twenty columns to `INCLUDE` would enlarge every leaf page to serve a query that never uses it. Write that reason into the migration as a two-line comment so the next reader does not "fix" it.

- [ ] **Step 3: Write the failing tests**

```ts
// packages/domain-identity/src/service/profile.test.ts
describe('birthdate', () => {
  it.each([['1990-01-31'], ['1990'], ['0000']])('accepts %s', (v) =>
    expect(isValidBirthdate(v)).toBe(true),
  );
  it.each([['90-01-31'], ['1990-1-1'], ['31/01/1990'], ['']])('refuses %s', (v) =>
    expect(isValidBirthdate(v)).toBe(false),
  );
});

describe('locale', () => {
  it.each([['en'], ['en-US'], ['zh-Hans-CN']])('accepts %s', (v) =>
    expect(isValidLocale(v)).toBe(true),
  );
  it.each([['english'], ['en_US'], ['']])('refuses %s', (v) =>
    expect(isValidLocale(v)).toBe(false),
  );
});
```

```ts
// packages/domain-identity/tests/profile.int.test.ts
describe('the database enforces what the claim promises', () => {
  it.each([['31/01/1990'], ['1990-1-1']])('refuses birthdate %s', async (birthdate) => {
    await expect(updateProfile(subject, { birthdate })).rejects.toThrow(/users_birthdate_shape/);
  });

  it('refuses a locale the shape does not admit', async () => {
    await expect(updateProfile(subject, { locale: 'en_US' })).rejects.toThrow(/users_locale_shape/);
  });

  it('accepts a phone number in any format, since E.164 is only recommended', async () => {
    for (const phoneNumber of ['+14155552671', '(415) 555-2671', '0415 555 2671']) {
      await expect(updateProfile(subject, { phoneNumber })).resolves.toBeDefined();
    }
  });

  it('refuses a profile URL that is not http or https', async () => {
    await expect(updateProfile(subject, { picture: 'javascript:alert(1)' })).rejects.toThrow(
      /users_profile_urls_are_http/,
    );
  });

  it('updates no profile in another tenant', async () => {
    await expect(
      withTenant(db, tenantB, (tx) =>
        userRepository(tx).updateProfile(subjectInA, { nickname: 'x' }),
      ),
    ).rejects.toThrow(/not found/);
  });
});
```

The `javascript:` case is why the URL columns are constrained at all: these three claims are rendered as links by consumers.

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm --filter @odudu/domain-identity test profile`
Expected: FAIL — the columns do not exist.

- [ ] **Step 5: Implement**

Widen the Drizzle table and `UserRecord`, add `updateProfile`, and mirror each SQL pattern in `profile.ts`. Keep the TypeScript and SQL spellings in agreement the way `email.ts` does — migration 0012's parity assertion holds the two in step case by case, and the same technique applies here.

- [ ] **Step 6: Run them, run everything, commit**

Run: `pnpm --filter @odudu/domain-identity test profile` then `pnpm verify`
Expected: PASS.

```bash
git add packages/db/drizzle packages/domain-identity
git commit -m "Give a user a profile, constrained where the specification states a format"
```

---

### Task 13: The `profile`, `address` and `phone` mappers, and `claims_supported` honesty

**Files:**

- Modify: `packages/protocol-oidc/src/service/claims.ts`
- Modify: `packages/protocol-oidc/src/service/claims.test.ts`
- Create: `packages/protocol-oidc/tests/claims-supported.int.test.ts`
- Create: `tests/docs/claims-supported.test.ts`

**Interfaces:**

- Consumes: the widened `UserRecord` (Task 12)
- Produces: `profileMapper` widened to OIDC Core section 5.4's claim list; `addressMapper` (scope `address`); `phoneMapper` (scope `phone`)

- [ ] **Step 1: Write the failing unit tests**

```ts
// packages/protocol-oidc/src/service/claims.test.ts (added)
describe('profile mapper', () => {
  it('emits section 5.4 profile claims from stored attributes', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({
        name: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
        nickname: 'Ada',
        locale: 'en-GB',
        zoneinfo: 'Europe/London',
      }),
    );
    expect(claims).toMatchObject({
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      nickname: 'Ada',
      locale: 'en-GB',
      zoneinfo: 'Europe/London',
    });
  });

  it('falls back to the username when no display name is stored', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({
        name: null,
        username: 'ada',
      }),
    );
    expect(claims.name).toBe('ada');
  });

  it('omits a claim with nothing behind it rather than emitting null', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({
        name: 'Ada',
        givenName: null,
      }),
    );
    expect(claims).not.toHaveProperty('given_name');
  });
});

describe('address mapper', () => {
  it('emits address as one JSON object, per section 5.1.1', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'address'],
      ctxWith({
        addressLocality: 'London',
        addressCountry: 'GB',
      }),
    );
    expect(claims.address).toEqual({ locality: 'London', country: 'GB' });
  });

  it('omits address entirely when no component is stored', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'address'], ctxWith({}));
    expect(claims).not.toHaveProperty('address');
  });
});

describe('phone mapper', () => {
  it('omits both phone claims together when no number is stored', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'phone'],
      ctxWith({ phoneNumber: null }),
    );
    expect(claims).not.toHaveProperty('phone_number');
    expect(claims).not.toHaveProperty('phone_number_verified');
  });
});
```

The last one repeats the `email` mapper's rule: a missing value and an unverified one are different things, and the two claims leave together rather than asserting a false verification status for a value that does not exist.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @odudu/protocol-oidc test claims`
Expected: FAIL — `profile` emits only `name`.

- [ ] **Step 3: Implement the three mappers**

`address` is a single JSON object claim (section 5.1.1), assembled from the six columns with absent components left out. The `profile` mapper keeps its username fallback for `name` — that is what holds P1's tested behaviour true for users who have no display name.

**Migration 0019 was inserted during execution** — `client_scopes.include_in_access_token`, symmetric with `include_in_id_token`. Running the claim mapper registry on the access token, which Task 11 does to carry `roles` and `groups`, also moved `name`, `email` and `email_verified` there: an access token goes to the resource servers named in `aud`, which should not receive the end-user's address because the registry started running. The gate defaults true for `roles` and `groups` and false for `openid`, `profile` and `email`. Every migration from the user profile onward shifted by one.

**In this same commit, add `address` and `phone` to `TENANT_DEFAULT_SCOPE_NAMES`**
and to the default set `provisionClientDefaults` assigns, for the reason given
in Task 4. These two are the last of the seven. Adding them un-skips
`oidcc-scope-address`, `oidcc-scope-phone` and `oidcc-scope-all` in the
conformance job — which is correct here, because the mappers that make them
true land in this commit. **Expect that job to exercise them for the first
time, and treat a failure there as this task's to fix**, not as pre-existing.

Also emit `updated_at` (seconds since the epoch, from migration 0019's
`profile_updated_at`) and `preferred_username` (falling back to
`users.username` when the column is null), both named by section 5.4 and
neither named elsewhere in this plan.

- [ ] **Step 4: Write the honesty test**

`claims_supported` must equal what the registry can actually produce, across the ID token, the access token and `/userinfo`. `discovery.ts`'s own comment already forbids advertising a claim nothing returns; this makes it a test.

```ts
// tests/docs/claims-supported.test.ts
it('advertises exactly the claims the registry can produce', () => {
  const advertised = new Set(discoveryDocument({ ...opts }).claims_supported);
  const producible = new Set(standardClaimMappers().claimNames());
  expect([...advertised].sort()).toEqual([...producible].sort());
});

it('does not advertise entitlements', () => {
  expect(discoveryDocument({ ...opts }).claims_supported).not.toContain('entitlements');
});
```

- [ ] **Step 5: Run everything and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/protocol-oidc tests/docs
git commit -m "Map the standard claims out of the profile that now stores them"
```

---

### Task 14: Spike — does the SMTP client survive the production image?

ADR 0002 fixes a single-container shape, and `@node-rs/argon2` is already known to be waiting there for P2b. An SMTP client is proven by **building the image and running it**, not by reading a README.

**Files:**

- Modify: `docs/superpowers/p2a-spike-log.md`

**Interfaces:**

- Consumes: nothing
- Produces: a finding under `## SMTP client through the production image`, naming the package and exact version that works, or the failure. Task 15 installs exactly what this records.

- [ ] **Step 1: Add the candidate and write a probe module**

```bash
pnpm --filter @odudu/server add nodemailer@7.0.9
pnpm --filter @odudu/server add -D @types/nodemailer@7.0.4
```

```ts
// apps/server/src/smtp-probe.ts  (throwaway)
import { createTransport } from 'nodemailer';
export async function probe(): Promise<string> {
  const transport = createTransport({ host: '127.0.0.1', port: 1025, secure: false });
  const info = await transport.sendMail({
    from: 'odudu@example.test',
    to: 'ada@example.test',
    subject: 'probe',
    text: 'probe',
  });
  return info.messageId;
}
```

- [ ] **Step 2: Build the image and run the probe inside it**

This is the whole point of the spike. `pnpm verify` does not build the image, and `tsup` bundling is where a native or CJS-only dependency fails.

```bash
docker run --rm -d --name smtp-sink -p 1025:1025 axllent/mailpit
docker build -f infra/docker/Dockerfile -t odudu-smtp-spike .
docker run --rm --network host odudu-smtp-spike node -e "import('./dist/smtp-probe.js').then(m => m.probe()).then(console.log)"
```

Expected: a message id printed, and the message visible in Mailpit. A `ERR_MODULE_NOT_FOUND`, a `require is not defined`, or a missing native binding is the finding — record it and name the alternative tried next.

- [ ] **Step 3: Record the finding and remove the probe**

Append the exact commands and output to `docs/superpowers/p2a-spike-log.md`. Then delete `apps/server/src/smtp-probe.ts` and remove the dependency again — Task 15 adds it deliberately, to the package that should own it, which is `@odudu/email` and not `@odudu/server`.

```bash
docker rm -f smtp-sink
git checkout -- apps/server/package.json pnpm-lock.yaml
rm apps/server/src/smtp-probe.ts
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/p2a-spike-log.md
git commit -m "Establish that the SMTP client survives the production image"
```

---

### Task 15: `@odudu/email` — the port, the adapters, the templates

**Files:**

- Create: `packages/email/` (`package.json`, `tsconfig.json`, `src/index.ts`)
- Create: `packages/email/src/service/sender.ts`
- Create: `packages/email/src/adapter/smtp.ts`
- Create: `packages/email/src/adapter/capturing.ts`
- Create: `packages/email/src/adapter/capturing.test.ts`
- Create: `packages/email/src/service/templates.ts`
- Create: `packages/email/src/service/templates.test.ts`
- Create: `packages/email/tests/smtp.int.test.ts`
- Modify: `packages/kernel/src/config.ts`, `.env.example`, `infra/docker/compose.yaml`
- Modify: `tests/boundaries/boundaries.test.ts`, `.dependency-cruiser.cjs`

**Interfaces:**

- Consumes: the Task 14 finding (the exact package and version)
- Produces:
  - `interface EmailMessage { to: string; subject: string; text: string; html: string }`
  - `interface EmailSender { send(message: EmailMessage): Promise<void> }`
  - `smtpSender(config): EmailSender`, `capturingSender(): EmailSender & { readonly sent: readonly EmailMessage[] }`
  - `renderVerifyEmail(input): EmailMessage`, `renderResetPassword(input): EmailMessage`

- [ ] **Step 1: Scaffold the package and write the failing tests**

```ts
// packages/email/src/adapter/capturing.test.ts
describe('capturingSender', () => {
  it('records what it was asked to send', async () => {
    const sender = capturingSender();
    await sender.send({ to: 'ada@example.test', subject: 'Verify', text: 't', html: '<p>t</p>' });
    expect(sender.sent).toEqual([
      { to: 'ada@example.test', subject: 'Verify', text: 't', html: '<p>t</p>' },
    ]);
  });
});
```

```ts
// packages/email/src/service/templates.test.ts
describe('renderVerifyEmail', () => {
  it('puts the action link in both the text and the html body', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
      tenantDisplayName: 'Demo',
    });
    expect(msg.text).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
    );
    expect(msg.html).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
    );
  });

  it('escapes a tenant name that contains markup', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      tenantDisplayName: '<script>x</script>',
    });
    expect(msg.html).not.toContain('<script>');
  });
});
```

The escaping test is not decoration: a tenant display name is operator-supplied and lands in an HTML body that a mail client renders.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @odudu/email test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the port and the adapters**

```ts
// packages/email/src/service/sender.ts
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// A port, so the SMTP client is one adapter and the test double is another.
// `send` resolves when the message has been handed to the transport; it
// makes no claim about delivery, which no SMTP client can make either.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

The capturing adapter writes to the logger as well as recording in memory, so the compose stack shows the verification link without a mail server.

- [ ] **Step 4: Add the configuration at the kernel boundary**

`ODUDU_SMTP_HOST`, `_PORT`, `_FROM`, `_USERNAME`, `_PASSWORD`, `_STARTTLS`, parsed and validated by the existing Zod config schema in `@odudu/kernel` — that is where the environment is decoded and length-checked already, and it is what keeps an untyped `process.env` read out of the adapter. Per ADR 0015, credentials come from the environment; per-tenant SMTP is P4's. With no host configured the server selects the capturing adapter and logs that it has done so, rather than failing to boot: a tenant with `verify_email` off needs no mail at all.

- [ ] **Step 5: Write the integration test against a real SMTP sink**

```ts
// packages/email/tests/smtp.int.test.ts
// Mailpit via Testcontainers: a real SMTP conversation, not a mock.
it('delivers a message an SMTP server accepts and can be read back', async () => {
  await smtpSender(config).send({
    to: 'ada@example.test',
    subject: 'Verify your address',
    text: 'link',
    html: '<p>link</p>',
  });
  const messages = await mailpit.listMessages();
  expect(messages).toHaveLength(1);
  expect(messages[0].To[0].Address).toBe('ada@example.test');
});
```

- [ ] **Step 6: Wire boundaries, run everything, commit**

Add `@odudu/email` to `tests/boundaries/boundaries.test.ts` and the `dependency-cruiser` rules, with a fixture proving the rule bites.

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/email packages/kernel .env.example infra/docker/compose.yaml tests/boundaries .dependency-cruiser.cjs
git commit -m "Put one seam under every message this server will ever send"
```

---

### Task 16: Action tokens — migration 0020 and single-use redemption

**Files:**

- Create: `packages/db/drizzle/0021_action_tokens.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/account/` (`package.json`, `tsconfig.json`, `src/index.ts`)
- Create: `packages/account/src/schema/action-tokens.ts`
- Create: `packages/account/src/repository/action-tokens.ts`
- Create: `packages/account/tests/action-tokens.int.test.ts`
- Modify: `tests/boundaries/boundaries.test.ts`, `.dependency-cruiser.cjs`

**Interfaces:**

- Consumes: `subjects` table
- Produces:
  - `action_tokens` table
  - `actionTokenRepository(tx)` with `issue({ subjectId, type, email, ttlSeconds }): Promise<{ token: string }>` and `consume(token, type): Promise<ActionTokenRecord | null>`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0021_action_tokens.sql
CREATE TABLE action_tokens (
  id          uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL,
  type        text NOT NULL,
  token_hash  text NOT NULL,
  -- The address the token was minted for. Changing it invalidates an
  -- outstanding verification rather than letting it verify a value the
  -- user no longer holds.
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT action_tokens_type_check CHECK (type IN ('verify_email', 'reset_password')),
  CONSTRAINT action_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT action_tokens_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY action_tokens_isolation ON action_tokens
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Append to `_journal.json`: `{ "idx": 21, "version": "7", "when": 1789049381664, "tag": "0021_action_tokens", "breakpoints": true }`.

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/account/tests/action-tokens.int.test.ts
describe('issue and consume', () => {
  it('returns the subject for a fresh token', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      email: 'ada@example.test',
    });
    await expect(consume(token, 'verify_email')).resolves.toMatchObject({ subjectId: subject });
  });

  it('stores no plaintext token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email' });
    const rows = await rawSelectAllActionTokens();
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });

  it('refuses a second redemption', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email' });
    await consume(token, 'verify_email');
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('refuses an expired token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email', ttlSeconds: -1 });
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('refuses a reset token presented as a verification token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'reset_password' });
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('keeps the consumed row, because nothing is deleted', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email' });
    await consume(token, 'verify_email');
    const rows = await rawSelectAllActionTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0].consumed_at).not.toBeNull();
  });

  it('lets exactly one of two concurrent redemptions win', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email' });
    const results = await Promise.all([
      consume(token, 'verify_email'),
      consume(token, 'verify_email'),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('consumes nothing from another tenant', async () => {
    const { token } = await issueIn(tenantA, { subjectId: subjectInA, type: 'verify_email' });
    await expect(
      withTenant(db, tenantB, (tx) => actionTokenRepository(tx).consume(token, 'verify_email')),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/account test:int action-tokens`
Expected: FAIL — the table does not exist.

- [ ] **Step 4: Implement it**

Single-use is one statement, which is what makes the concurrency test pass — the same shape `authorization_codes` uses:

```ts
    // One UPDATE decides the winner between two concurrent redemptions.
    // The row is kept afterwards: nothing in this codebase deletes expired
    // state, and retention is decided once for every table that has it.
    async consume(token: string, type: ActionTokenType): Promise<ActionTokenRecord | null> {
      const hash = sha256Hex(token);
      const rows = await tx
        .update(actionTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(actionTokens.tokenHash, hash),
            eq(actionTokens.type, type),
            isNull(actionTokens.consumedAt),
            gt(actionTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },
```

`issue` generates 32 bytes from `crypto.randomBytes`, returns the base64url encoding to the caller, and stores only the SHA-256 hex of it.

- [ ] **Step 5: Run it, run everything, commit**

Run: `pnpm --filter @odudu/account test:int action-tokens` then `pnpm verify`
Expected: PASS.

```bash
git add packages/account packages/db/drizzle tests/boundaries .dependency-cruiser.cjs
git commit -m "Mint an action token that can be spent once and is never thrown away"
```

---

### Task 17: Address verification — migration 0021 and the first honest `email_verified`

`email_verified` has been a stored boolean nothing could set truthfully since it was added. This task is what makes it mean something, and it ships **before** registration.

**Files:**

- Create: `packages/db/drizzle/0022_realm_account_settings.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/account/src/usecase/verify-email.ts`
- Create: `packages/account/src/view/routes/action-token.ts`
- Create: `packages/account/src/view/verification-html.ts`
- Create: `packages/account/tests/verify-email.int.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: `actionTokenRepository` (Task 16), `EmailSender` and `renderVerifyEmail` (Task 15), `userRepository` (Task 12)
- Produces:
  - `tenants.registration_allowed`, `tenants.verify_email`, `tenants.reset_password_allowed`
  - `sendVerificationEmail(deps, { subjectId, email }): Promise<void>`
  - `GET /tenants/:tenant/login-actions/action-token?key=…`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0022_realm_account_settings.sql
-- All three default off: a tenant does not acquire a public registration
-- endpoint because it was upgraded.
ALTER TABLE tenants
  ADD COLUMN registration_allowed   boolean NOT NULL DEFAULT false,
  ADD COLUMN verify_email           boolean NOT NULL DEFAULT false,
  ADD COLUMN reset_password_allowed boolean NOT NULL DEFAULT false;
```

Append to `_journal.json`: `{ "idx": 22, "version": "7", "when": 1789049381665, "tag": "0022_realm_account_settings", "breakpoints": true }`.

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/account/tests/verify-email.int.test.ts
describe('address verification', () => {
  it('sends a link the user can follow, and flips email_verified when they do', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const link = extractLink(sender.sent[0]);

    const res = await app.inject({ method: 'GET', url: link });

    expect(res.statusCode).toBe(200);
    expect(await emailVerified(subject)).toBe(true);
  });

  it('sends the mail only after the transaction that issued the token commits', async () => {
    // A token the user receives but the database never stored is a support
    // call with no trace. Ordering is asserted, not assumed.
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const stored = await rawSelectAllActionTokens();
    expect(stored).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('refuses a second use of the same link', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const link = extractLink(sender.sent[0]);
    await app.inject({ method: 'GET', url: link });
    const second = await app.inject({ method: 'GET', url: link });
    expect(second.statusCode).toBe(400);
  });

  it('invalidates an outstanding token when the address changes', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const link = extractLink(sender.sent[0]);

    await updateProfile(subject, { email: 'ada+new@example.test' });

    const res = await app.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(400);
    expect(await emailVerified(subject)).toBe(false);
  });

  it('refuses a token minted in another tenant', async () => {
    const link = await verificationLinkIn(tenantA, subjectInA);
    const res = await app.inject({
      method: 'GET',
      url: link.replace('/tenants/a/', '/tenants/b/'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('emits email_verified true in the token only after verification', async () => {
    const before = await completeCodeFlow({ scope: 'openid email' });
    expect(decode(before.id_token).email_verified).toBe(false);
    await verify(subject);
    const after = await completeCodeFlow({ scope: 'openid email' });
    expect(decode(after.id_token).email_verified).toBe(true);
  });
});
```

The address-change test is the one that stops a verification proving something about an address the user has already abandoned; the token's `email` column exists for it.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/account test:int verify-email`
Expected: FAIL — the route does not exist.

- [ ] **Step 4: Implement the usecase and the route**

The ordering rule is the substance of this task: issue the token **inside** the transaction, send the mail **after it commits**, awaited. A send that fails after commit leaves a user with no mail, which is why resend is a first-class action rather than a retry — and it is why the token is stored before it is sent, never after.

Consumption compares the token's `email` column against the user's current address and refuses if they differ.

- [ ] **Step 5: Run it, run everything**

Run: `pnpm --filter @odudu/account test:int verify-email` then `pnpm verify`
Expected: PASS.

- [ ] **Step 6: Document and commit**

Add the flow to `docs/request-paths.md` with real output from a live stack — including the captured message body from the development adapter, which is how a reader gets the link without a mail server. `README.md` gains the three tenant settings and the SMTP environment variables.

```bash
git add packages/account packages/db/drizzle apps/server docs/request-paths.md README.md
git commit -m "Make email_verified a claim about something that happened"
```

---

### Task 18: Self-registration — migration 0022 and the address that must be taken only once

**Files:**

- Create: `packages/db/drizzle/0023_users_email_unique.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/account/src/usecase/register.ts`
- Create: `packages/account/src/view/routes/registration.ts`
- Create: `packages/account/src/view/registration-html.ts`
- Create: `packages/account/tests/register.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: Tasks 15–17; `roleRepository(tx).defaultsForTenant()` (Task 7)
- Produces: `GET` and `POST /tenants/:tenant/login-actions/registration`

- [ ] **Step 1: Write the migration, knowing it can be rejected**

```sql
-- packages/db/drizzle/0023_users_email_unique.sql
-- Self-registration makes "is this address already taken?" a live question
-- for the first time. This index can fail on a database that already holds
-- duplicates; that failure is correct and the operator resolves it before
-- enabling registration. Partial, because email stays nullable.
CREATE UNIQUE INDEX users_email_unique ON users (tenant_id, email) WHERE email IS NOT NULL;
```

Append to `_journal.json`: `{ "idx": 23, "version": "7", "when": 1789049381666, "tag": "0023_users_email_unique", "breakpoints": true }`.

- [ ] **Step 2: Write the failing integration test**

```ts
// packages/account/tests/register.int.test.ts
describe('self-registration', () => {
  it('is not served at all when the tenant has not enabled it', async () => {
    await setTenant({ registrationAllowed: false });
    const res = await app.inject({ url: '/tenants/demo/login-actions/registration' });
    expect(res.statusCode).toBe(404);
  });

  it('creates a user and applies the tenant default roles', async () => {
    await setTenant({ registrationAllowed: true });
    await createRole({ name: 'offline_access', defaultForNewSubjects: true });

    await register({
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(await roleNames('ada')).toEqual(['offline_access']);
  });

  it('refuses an address another user in the tenant already holds', async () => {
    await setTenant({ registrationAllowed: true });
    await register({ username: 'ada', email: 'ada@example.test', password: 'p' });
    const res = await registerRaw({ username: 'grace', email: 'ada@example.test', password: 'p' });
    expect(res.statusCode).toBe(400);
  });

  it('permits the same address in a different tenant', async () => {
    await registerIn(tenantA, { username: 'ada', email: 'ada@example.test', password: 'p' });
    await expect(
      registerIn(tenantB, { username: 'ada', email: 'ada@example.test', password: 'p' }),
    ).resolves.toBeDefined();
  });

  it('refuses to complete a login until the address is verified', async () => {
    await setTenant({ registrationAllowed: true, verifyEmail: true });
    await register({ username: 'ada', email: 'ada@example.test', password: 'p' });

    const login = await attemptLogin('ada', 'p');
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('verify');
    expect(login.headers.location).toBeUndefined();
  });

  it('lets the login complete once the address is verified', async () => {
    await setTenant({ registrationAllowed: true, verifyEmail: true });
    await register({ username: 'ada', email: 'ada@example.test', password: 'p' });
    await followVerificationLink();

    const login = await attemptLogin('ada', 'p');
    expect(login.headers.location).toContain('code=');
  });
});
```

The fifth test is the phase's security property in one assertion: an unverified self-registered address must not be usable to obtain a token. Assert **no authorization code is issued**, not merely that a page said something.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @odudu/account test:int register`
Expected: FAIL — the route does not exist.

- [ ] **Step 4: Implement registration**

Create the subject, the user row, the password credential through `domain-identity`'s existing Argon2id path, and the default roles — in one transaction. Issue the verification token in that same transaction, and send after it commits, as Task 17 established. When `verify_email` is on, the login flow refuses to complete until `email_verified` is true.

- [ ] **Step 5: Run it, run everything, document, commit**

Run: `pnpm verify`
Expected: PASS.

`docs/request-paths.md` gains the registration walkthrough, run against a live stack. `README.md` gains the `registration_allowed` setting and the sentence that unverified accounts cannot complete a login when `verify_email` is on.

```bash
git add packages/account packages/db/drizzle docs/request-paths.md README.md
git commit -m "Let a user create their own account, and hold it until the address answers"
```

---

### Task 19: Password reset, enumeration-safe

**Files:**

- Create: `packages/account/src/usecase/reset-password.ts`
- Create: `packages/account/src/view/routes/reset-password.ts`
- Create: `packages/account/src/view/reset-html.ts`
- Create: `packages/account/tests/reset-password.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: Tasks 15–17; `credentialRepository` from `@odudu/domain-identity`
- Produces: `GET`/`POST /tenants/:tenant/login-actions/reset-password`, and the `reset_password` branch of the action-token route

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/account/tests/reset-password.int.test.ts
describe('password reset', () => {
  it('answers identically for a known and an unknown address', async () => {
    const known = await requestReset('ada@example.test');
    const unknown = await requestReset('nobody@example.test');
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
  });

  it('sends mail only for the address that exists', async () => {
    await requestReset('nobody@example.test');
    expect(sender.sent).toHaveLength(0);
    await requestReset('ada@example.test');
    expect(sender.sent).toHaveLength(1);
  });

  it('sets a new password the user can then log in with', async () => {
    await requestReset('ada@example.test');
    await submitNewPassword(extractLink(sender.sent[0]), 'a new password');
    const login = await attemptLogin('ada', 'a new password');
    expect(login.headers.location).toContain('code=');
  });

  it('stops the old password working', async () => {
    await requestReset('ada@example.test');
    await submitNewPassword(extractLink(sender.sent[0]), 'a new password');
    const login = await attemptLogin('ada', 'the old password');
    expect(login.headers.location).toBeUndefined();
  });

  it('refuses a reset link a second time', async () => {
    await requestReset('ada@example.test');
    const link = extractLink(sender.sent[0]);
    await submitNewPassword(link, 'first');
    const second = await submitNewPassword(link, 'second');
    expect(second.statusCode).toBe(400);
    const login = await attemptLogin('ada', 'second');
    expect(login.headers.location).toBeUndefined();
  });

  it('is not served when the tenant has not enabled it', async () => {
    await setTenant({ resetPasswordAllowed: false });
    expect(
      (await app.inject({ url: '/tenants/demo/login-actions/reset-password' })).statusCode,
    ).toBe(404);
  });
});
```

The first two tests are a pair, and both are needed: identical responses prove the endpoint discloses nothing, and the mail assertion proves the endpoint is still doing its job rather than silently doing nothing for everybody.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @odudu/account test:int reset-password`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement it**

The response is composed before the lookup and is the same either way. The rules a new password must satisfy are **P2b's** — this flow sets whatever P2b later constrains, and adds no policy of its own now.

- [ ] **Step 4: Run everything, document, commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/account docs/request-paths.md README.md
git commit -m "Let a user who has lost a password get a new one without disclosing who exists"
```

---

### Task 20: The seed CLI learns roles, groups, scopes, mappings and profile

Provisioning in P2a is the seed CLI, and this is the task that makes the phase usable. An increment that adds an admin-shaped HTTP surface is out of scope by definition — that is P4.

**Files:**

- Modify: `apps/server/src/cli/seed.ts`
- Create: `apps/server/tests/seed-authz.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: every repository built in Tasks 4, 7, 9 and 12
- Produces: `seed role`, `seed group`, `seed scope`, `seed assign-scope`, `seed map-role`, `seed grant-role`, `seed join-group`, `seed profile`

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/server/tests/seed-authz.int.test.ts
it('provisions a tenant whose user can obtain a token carrying a role', async () => {
  await seed(['tenant', '--name', 'demo']);
  await seed([
    'client',
    '--tenant',
    'demo',
    '--client-id',
    'app',
    '--public',
    '--redirect-uri',
    'https://app.example/cb',
    '--web-origin',
    'https://app.example',
  ]);
  await seed([
    'user',
    '--tenant',
    'demo',
    '--username',
    'ada',
    '--password',
    'p',
    '--email',
    'ada@example.test',
  ]);
  await seed(['role', '--tenant', 'demo', '--name', 'admin']);
  await seed(['grant-role', '--tenant', 'demo', '--username', 'ada', '--role', 'admin']);
  await seed(['map-role', '--tenant', 'demo', '--scope', 'roles', '--role', 'admin']);
  await seed([
    'assign-scope',
    '--tenant',
    'demo',
    '--client-id',
    'app',
    '--scope',
    'roles',
    '--assignment',
    'optional',
  ]);

  const { access_token } = await completeCodeFlow({ clientId: 'app', scope: 'openid roles' });
  expect(decode(access_token).roles).toEqual(['admin']);
});

it('qualifies a client role with its owning client', async () => {
  await seed(['role', '--tenant', 'demo', '--name', 'reader', '--client-id', 'reports-api']);
  await seed([
    'grant-role',
    '--tenant',
    'demo',
    '--username',
    'ada',
    '--role',
    'reports-api:reader',
  ]);
  await seed(['map-role', '--tenant', 'demo', '--scope', 'roles', '--role', 'reports-api:reader']);
  const { access_token } = await completeCodeFlow({ clientId: 'app', scope: 'openid roles' });
  expect(decode(access_token).roles).toEqual(['reports-api:reader']);
});

it('refuses to grant a role that does not exist rather than creating one', async () => {
  await expect(
    seed(['grant-role', '--tenant', 'demo', '--username', 'ada', '--role', 'nope']),
  ).rejects.toThrow(/no role named/);
});
```

The first test is the phase's acceptance test in one place: seven commands and a real token with a real claim.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @odudu/server test:int seed-authz`
Expected: FAIL — unknown subcommand `role`.

- [ ] **Step 3: Implement the subcommands**

`seed client` gains `--web-origin` (repeatable). `grant-role` and `map-role` accept the **qualified** name, parsing `clientId:roleName` with the same rule the claim uses — which is safe precisely because the database refuses `:` inside a role name.

- [ ] **Step 4: Run everything, document, commit**

Run: `pnpm verify`
Expected: PASS.

`docs/request-paths.md` gains the seven-command walkthrough, executed against a live stack with real output. `README.md`'s getting-started section gains the same, because it is now the shortest path from an empty database to a token with a role in it.

```bash
git add apps/server docs/request-paths.md README.md
git commit -m "Teach the seed command the identity model it now has to provision"
```

---

### Task 21: Traceability — clause rows, reading notes, and the census

**Files:**

- Modify: `docs/protocols/rfc9068.md`
- Modify: `docs/protocols/oidc-core.md`
- Modify: `tools/trace/silenced-musts.json`

**Interfaces:**

- Consumes: every test id written in Tasks 2–20
- Produces: a `pnpm trace` run that is green in strict mode

- [ ] **Step 1: Write the RFC 9068 section 2.2.3.1 reading note**

Three things, and no more — a reading note is not an essay, and the eight-line comment cap exists because this repository has drifted there before:

1. `roles`, `groups` and `entitlements` are IANA-registered JWT claims, referenced to RFC 7643 section 4.1.2 and RFC 9068 section 2.2.3.1.
2. Odudu emits `groups` as an array of strings rather than RFC 7643's complex multi-valued form, because that is what the consuming ecosystem reads — Kubernetes requires a list of strings from the claim named by `--oidc-groups-claim` even for a single value.
3. `entitlements` is **not** emitted: Odudu has no entitlement concept, and the omission is deliberate.

- [ ] **Step 2: Close section 2.2.3's SHOULD row**

The row reads _"if the authorization request includes a `scope` parameter, the corresponding JWT access token includes a `scope` claim"_ and is currently `gap`. `mintAccessToken` has always emitted the claim; the row is a gap for want of a **test**, not for want of behaviour. Add the test id and change the row.

- [ ] **Step 3: Rewrite section 4's `n/a:` reason**

It currently reads _"the `groups`/`roles`/`entitlements` claims of section 2.2.3.1 are OPTIONAL and not emitted by Odudu in P1"_. That becomes **false** the moment Task 10 ships, and a row whose justification has quietly become untrue is worse than a gap. The clause obliges a **resource server** to use authorization claims in its decision; Odudu is the authorization server. That is the reason the row should give. The status stays `n/a:`, so the census does not move for this one.

- [ ] **Step 4: Add the OIDC Core rows**

Rows for section 5.1 (standard claims), 5.1.1 (the address claim) and 5.4 (the scope-to-claim mapping), each closed by a test id from Task 13.

**Read RFC 7643 section 4.1.2 and decide whether it yields normative rows worth a clause table of its own.** Do not assume either answer — the spec deliberately left this to be settled by reading. If it does, create `docs/protocols/rfc7643.md`; if it does not, say so in the RFC 9068 reading note.

- [ ] **Step 5: Move the census**

Every new `deferred:` or `n/a:` row must move the count in `tools/trace/silenced-musts.json` in the same diff, or the tool fails the build — which is the point: a new silent row costs a number a reviewer sees.

- [ ] **Step 6: Run trace strict and commit**

Run: `pnpm trace` then `pnpm verify`
Expected: PASS, with no MUST left `gap` or `documented:`.

```bash
git add docs/protocols tools/trace
git commit -m "Trace the claims this phase added to the clauses that name them"
```

---

### Task 22: Phase close — the whole-phase documentation pass

Per-increment edits keep each individual claim true while letting the overall narrative drift out of shape. This task reads both documents as documents.

**Files:**

- Modify: `docs/request-paths.md`, `README.md`, `docs/NEXT.md`
- Modify: `docs/superpowers/specs/2026-09-10-odudu-design.md`

- [ ] **Step 1: Re-run every affected transcript against a live stack**

```bash
docker compose -f infra/docker/compose.yaml up -d --build
```

Every command in `docs/request-paths.md` has been executed and every response is real output. **Re-run them; do not edit them to look right.** A command that cannot be run gets a sentence saying so rather than output nobody produced. Pay particular attention to the transcripts P2a changed underneath: discovery (`scopes_supported`), `/authorize` (scope refusal), `/token` (the `roles` claim), `/userinfo`, and every CORS exchange.

- [ ] **Step 2: Read `README.md` whole**

Not as a diff. The getting-started path must still work end to end for somebody with an empty database, and it now runs through more seed commands than it did. Check that the answer to "I created a role and it isn't in my token" is findable.

- [ ] **Step 3: Check the docs tests still assert something**

`tests/docs/` compares what these documents assert against what the server serves. Confirm the new checks from Tasks 5 and 13 are running and would fail if the documents drifted — change a value locally, watch the test go red, change it back. A documentation test nobody has seen fail is a documentation test nobody should trust.

- [ ] **Step 4: Update `docs/NEXT.md` for whoever starts P2b**

Rewrite "Start here". P2a is complete; P2b is next. Record what a P2b reader needs and cannot derive from the code:

- The token contract as it now stands, and that `full_scope_allowed` is off by default.
- That `user_credentials.type` is still `CHECK (type IN ('password'))` with `UNIQUE (subject_id, type)` beside it, and that both need widening for TOTP and passkeys — one row per type is right for a password and wrong for passkeys.
- That `action_tokens` joins the four tables with `expires_at` and no `DELETE`, so P2b's reaping decision now covers five tables, and ADR 0021's warning applies to all of them.
- Anything a spike in `docs/superpowers/p2a-spike-log.md` established that the code now silently depends on.

- [ ] **Step 5: Mark the phase in the umbrella spec**

Section 11's P2a row gets its exit criterion checked against what was actually built. If anything in the criterion was not delivered, **say so in the row** rather than quietly narrowing it — that is the failure the "Exit criteria that omitted work their phase already owned" section was added to prevent.

- [ ] **Step 6: Full green, then finish the branch**

Run: `pnpm verify`, and confirm `verify`, `container`, `conformance` and `commit-messages` are green in CI **on the pushed commit**.

```bash
git add docs
git commit -m "Close P2a: re-run the transcripts and hand P2b what it needs"
git push
```

Then use `superpowers:finishing-a-development-branch`.

---

## Self-review notes

Run after writing this plan, recorded so an executor knows what was checked.

**Spec coverage.** Every section of the spec maps to a task: section 3.1–3.3 → Tasks 7, 10; section 3.4 → Tasks 4, 11; section 3.5 → Task 11; section 4 migrations 0015–0022 → Tasks 2, 4, 7, 9, 12, 16, 17, 18; section 5 → Tasks 1–3; section 6 → Tasks 14–19; section 7 → Tasks 7, 15, 16; section 8 → Tasks 1, 6, 14; section 9 → the tests named in each; section 10 → Task 21; section 11 → Task 22; section 13's seven exit criteria → Tasks 11, 11, 13, 3, 17–19, 21, 22 respectively.

**One gap found and closed.** The spec's section 4 names `client_scope_roles` under migration 0017 while describing it under scope mappings; the plan places it in 0017 with the reason, because it references `roles(tenant_id, id)` and cannot exist before that table.

**Naming consistency checked across tasks.** `effectiveRoles` / `effectiveGroupPaths` (Tasks 8, 9, 10), `qualifiedRoleName` (Tasks 7, 10), `narrowByScopeMappings` (Task 11), `expandWebOrigins` / `normalizeOrigin` (Tasks 2, 3), `EffectiveRole.clientKey` — the OAuth `client_id` string, never the uuid — used identically in Tasks 8, 10 and 11.

**Three ordering constraints are load-bearing and are stated in the tasks that depend on them:** Task 1 before Task 3, Task 6 before Task 8, Task 14 before Task 15. Task 4 must precede Task 5, and Task 17 must precede Task 18 — the second of those is a security property, not a convenience.
