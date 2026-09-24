# P4c — Admin API: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Odudu is administered over HTTP — tenants, settings, SMTP, clients, subjects, sessions, roles, scopes, claim mappers, the authentication flow and signing keys — by a tenant's own admins and by a system-tenant admin acting across tenants, with every mutation audited and the whole surface published as OpenAPI.

**Architecture:** A new `packages/protocol-admin` carrying the five layers, mounted beside `oidcRoutes`. A bearer access token establishes identity; capability is re-resolved from the database on every request through `resolveRoleReach`; the target tenant comes from the path and binds `app.tenant_id` for the transaction, so every existing repository is reused unchanged. Request and response shapes are authored in Zod under `packages/contracts/admin/` and compiled once for ajv boundary validation and once for the published OpenAPI document.

**Tech Stack:** TypeScript (no `any`), Fastify 5.12.3, Drizzle over PostgreSQL with row-level security, Zod 4.6.1 with `z.toJSONSchema()`, ajv 8, `jose`, Vitest with Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-24-p4c-admin-api-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec and from `CLAUDE.md`.

- **No `any`.** Not as an annotation, not as a cast, not leaked in from `JSON.parse`. Use `unknown` and narrow. No inline `eslint-disable` of `no-explicit-any` or `no-unsafe-*`; `tests/lint/no-any.test.ts` fails the build on one.
- **Tests precede implementation.** Every task writes the failing test first and runs it to see it fail.
- **Integration tests run against real PostgreSQL via Testcontainers**, never a mock.
- **Every repository method is probed with a foreign `tenant_id`.** This carries extra weight here: for a cross-tenant admin request, RLS is scoped to the tenant the caller asked for, so it is no longer the second independent defence (spec §7).
- **`SET LOCAL`, never `SET`**, for tenant context — in practice `withTenant`, which binds it via `set_config(..., true)`.
- **No comment block longer than eight lines.** `tests/lint/comment-block-length.test.ts` fails the build, and there is no waiver.
- **Never reference the development process from a comment** — no task numbers, no "the plan", no increment slots. Name the thing instead: not "Task 3.2's predicate" but "the admin capability check".
- **Call a function as `doThing()`, never `void doThing()`.**
- **Layering:** `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing. Domain packages never import protocol packages. Protocol packages never import each other **except** the single edge this phase adds and tests: `protocol-admin → protocol-oidc`.
- **No tool-attribution line in a commit message or a pull request description.** `.githooks/commit-msg` and the `commit-messages` CI job catch the commit half; nothing can see a pull request body, so that half is followed rather than caught.
- **Commit messages:** subject ≤72 characters, body reading as ≤8 lines, blank line between. Enable the hook once per clone with `git config core.hooksPath .githooks`.
- **An increment is finished when CI is green on a pushed commit with a pull request open, and the review that push attracted has been answered.**
- **`README.md`, `docs/request-paths.md` and `docs/admin-paths.md` are updated in the same commit as the code** that changes a request, response, branch, error code, endpoint, command or default. Every transcript is real output from a running stack; a fenced block holding a response carries **no language tag**.

## Branch layout

**One branch per increment, merging into the phase branch; one phase pull request into `main`.**

- `p4c-admin-api` is the **integration branch**. It already carries the spec. Nothing is committed to it directly after this plan; everything arrives by merge.
- Each increment gets `p4c/<n>-<slug>`, branched from the integration branch at its current tip, with its own pull request **into the integration branch**.
- A **draft pull request from `p4c-admin-api` into `main` opens with the first push** and stays open until `finishing-a-development-branch`. `verify.yml` triggers on a bare `pull_request:`, so a branch with no pull request open runs nothing.

## File structure

| File                                                           | Responsibility                                                                                                           | New?   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| `packages/db/drizzle/0061_system_tenant.sql`                   | The `system` tenant row, `clients.builtin_admin`, and the capability-role provisioning function's supporting index.      | create |
| `packages/db/drizzle/0066_admin_audit.sql`                     | `audit_events`, its RLS policy and its indexes.                                                                          | create |
| `packages/db/drizzle/0065_tenant_smtp.sql`                     | `tenant_smtp`.                                                                                                           | create |
| `packages/db/drizzle/0064_client_scope_mappers.sql`            | `client_scope_mappers`.                                                                                                  | create |
| `packages/db/drizzle/0062_service_subject_fk.sql`              | `clients_service_subject_fk` rebuilt with the column-list `SET NULL`.                                                    | create |
| `packages/domain-tenant/src/service/admin-capabilities.ts`     | The capability names, the `tenant-admin` composite, and the built-in admin client's fixed `client_id`. A leaf.           | create |
| `packages/domain-tenant/src/usecase/provision-admin-client.ts` | Creates a tenant's built-in admin client and its capability roles.                                                       | create |
| `packages/protocol-admin/src/service/*`                        | Pure decisions: capability requirements per route, cursor encode/decode, problem-details shapes, patch-field allowlists. | create |
| `packages/protocol-admin/src/usecase/*`                        | One journey each: authenticate-and-authorize, and one per resource group.                                                | create |
| `packages/protocol-admin/src/repository/*`                     | Reads and writes this package owns — `audit_events`, `tenant_smtp`, `client_scope_mappers`.                              | create |
| `packages/protocol-admin/src/view/routes/*`                    | Fastify routes, one file per resource group.                                                                             | create |
| `packages/contracts/admin/*`                                   | Zod request and response schemas, compiled for ajv and OpenAPI.                                                          | create |
| `packages/contracts/src/authorize.ts`                          | Deleted — `authorizeQuerySchema` and `AuthorizeQuery` have no consumer.                                                  | delete |
| `packages/protocol-oidc/src/service/client-enabled.ts`         | The one `client.enabled` predicate the five doors share.                                                                 | create |
| `packages/crypto/src/service/kek.ts`                           | Generalised to `wrapSecret`/`unwrapSecret`; the JWK pair becomes typed wrappers.                                         | modify |
| `packages/crypto/src/repository/signing-keys.ts`               | `byAlg` selection and the promote/retire transitions.                                                                    | modify |
| `packages/authn-flows/src/repository/sessions.ts`              | `liveBySubject`.                                                                                                         | modify |
| `packages/authn-flows/src/service/requirements.ts`             | `required` and `conditional` made to differ.                                                                             | modify |
| `apps/server/src/cli/seed.ts`                                  | `seed admin`.                                                                                                            | modify |
| `apps/server/src/app.ts`                                       | Mounts `adminRoutes`.                                                                                                    | modify |
| `.dependency-cruiser.cjs`                                      | The one permitted protocol-to-protocol edge.                                                                             | modify |
| `docs/admin-paths.md`                                          | Executed operator journeys.                                                                                              | create |
| `docs/adr/0035-the-admin-api-may-import-the-oidc-package.md`   | §4's exception.                                                                                                          | create |
| `docs/adr/0036-userinfo-claims-narrowing.md`                   | §24's decision.                                                                                                          | create |

**On the migration numbers above.** They are assigned in the order the increments create them — 0061 in Increment 1, 0062 in 6, 0063 in 10, 0064 in 11, 0065 in 12, 0066 in 13 — because the timeline is forward-only and ordered. They are still _predictions_: six citations under `docs/superpowers/plans/` are off by one because another migration landed first. Take the next free number at the moment you write the file and keep the descriptive name; do not renumber a migration that has already merged.

## Review Focus

Five things the spec implies and no happy path exercises, most likely to bite first. Each has its test placed in the task that owns the code.

1. **A tenant-local admin of T presenting a valid, fully-capable token at `/admin/tenants/U/**`.** This is the whole cross-tenant boundary, and §7 admits RLS is scoped to U for a legitimate system admin — so the check is the defence. Expected: 403, no row of U's read or written, and an audit row recording the refusal. — Increment 2, Task 2.5.
2. **An ordinary application access token — correct tenant, correct signature, live grant — presented at `/admin`.** Without the `aud` check, every token in the tenant administers it. Expected: 401. — Increment 2, Task 2.3.
3. **A cursor from one collection replayed against another, and a hand-written one.** Keyset pagination that trusts its cursor is an arbitrary-offset read. Expected: 400, never a page. — Increment 3, Task 3.4.
4. **Disabling the built-in admin client, and disabling the client whose token is making the request.** The first locks out every admin in the tenant; the second is legitimate but surprising. Expected: 409 for the built-in one; allowed with the consequence audited for the other. — Increment 5, Task 5.6.
5. **`PATCH` of `grant_types` narrowing a grant a client is mid-flight on, and of `redirect_uris` to a list that `parseClientMetadata` would refuse at registration.** P4a made `grant_types` gate every grant, so this is a live authorization change. Expected: the narrow takes effect on the next `/token` call; the invalid list is refused with the same error registration gives. — Increment 5, Task 5.4.

## Spikes

Each settles an `assumption:` from spec §19 and runs **before** the increment that depends on it. A spike's output is an answer written into this plan, not code that is kept.

- **Spike A — ajv and draft 2020-12.** Before Increment 3. `z.toJSONSchema()` emits `$schema: https://json-schema.org/draft/2020-12/schema` (`verified:` by running it under Zod 4.6.1), but ajv 8's default export is draft-07. Determine whether `Ajv2020` from `ajv/dist/2020` wires cleanly as a Fastify `setValidatorCompiler`. If not, emit `target: 'draft-7'` for ajv and 2020-12 for the OpenAPI document — two compilations of one authored schema, which still honours ADR 0007.
- **Spike B — problem details beside RFC 6749.** Before Increment 3. Confirm a Fastify error handler scoped to the `/admin` prefix emits `application/problem+json` without changing what the OIDC routes return on the same instance.
- **Spike C — a rotating key can sign.** Before Increment 9. The signing path reaches for `signingKeyRepository.active()`. Enumerate every caller and confirm none other than the default selection assumes `active`.
- **Spike D — cross-tenant `SET LOCAL`.** Before Increment 2. Confirm binding `app.tenant_id` to a tenant other than the caller's behaves identically, including in the transaction that also writes the audit row, and that resolving `{tenant}` from the path needs the owner connection exactly as `AppDeps` already records for the OIDC routes.

---

## Increment 1 — The system tenant, the built-in admin client and the bootstrap

Nothing here is reachable over HTTP. It is the authority the rest of the phase authenticates against, and it must exist before any route can be tested.

**One deviation from the spec, decided here.** Spec §5 says a migration creates the system tenant. The migration inserts the **row**, which reserves the name from that moment; provisioning its flow and defaults stays in `provisionTenant`, called idempotently by the bootstrap command. Duplicating `provisionTenant`'s inserts as hand-written SQL would give the browser flow a second authority that could silently disagree with the first.

### Task 1.1: The capability names, as a leaf

**Files:**

- Create: `packages/domain-tenant/src/service/admin-capabilities.ts`
- Create: `packages/domain-tenant/src/service/admin-capabilities.test.ts`
- Modify: `packages/domain-tenant/src/index.ts`

**Interfaces:**

- Consumes: nothing. `service` is a leaf.
- Produces: `ADMIN_CLIENT_ID: 'odudu-admin'`, `SYSTEM_TENANT_NAME: 'system'`, `TENANT_CAPABILITIES: readonly TenantCapability[]`, `MANAGE_TENANTS: 'manage-tenants'`, `TENANT_ADMIN: 'tenant-admin'`, `viewCounterpart(capability: TenantCapability): TenantCapability | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain-tenant/src/service/admin-capabilities.test.ts
import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
} from '#/service/admin-capabilities';

describe('admin capabilities', () => {
  it('names the seven per-tenant capabilities', () => {
    expect([...TENANT_CAPABILITIES]).toEqual([
      'view-users',
      'manage-users',
      'manage-clients',
      'manage-tenant',
      'manage-keys',
      'manage-sessions',
      'view-audit',
    ]);
  });

  it('keeps the cross-tenant capability out of the per-tenant set', () => {
    expect(TENANT_CAPABILITIES).not.toContain(MANAGE_TENANTS);
    expect(TENANT_CAPABILITIES).not.toContain(TENANT_ADMIN);
  });

  it('composes manage-users onto view-users so granting one is enough', () => {
    expect(viewCounterpart('manage-users')).toBe('view-users');
  });

  it('gives a capability with no view counterpart none', () => {
    expect(viewCounterpart('manage-keys')).toBeNull();
    expect(viewCounterpart('view-audit')).toBeNull();
  });

  it('fixes the built-in client id and the system tenant name', () => {
    expect(ADMIN_CLIENT_ID).toBe('odudu-admin');
    expect(SYSTEM_TENANT_NAME).toBe('system');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/domain-tenant/src/service/admin-capabilities.test.ts`
Expected: FAIL — `Cannot find module '#/service/admin-capabilities'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain-tenant/src/service/admin-capabilities.ts

// The client every tenant's administration roles hang from. Fixed rather
// than configurable: it is named in the bootstrap command, in the capability
// matrix and in the guard that refuses to disable it, and a tenant that
// could rename it could hide it from all three.
export const ADMIN_CLIENT_ID = 'odudu-admin';

// Cross-tenant administration is a permission, not a property of living in a
// particular tenant — so this tenant is structurally identical to every other
// and holds only the subjects granted that permission.
export const SYSTEM_TENANT_NAME = 'system';

export const TENANT_CAPABILITIES = [
  'view-users',
  'manage-users',
  'manage-clients',
  'manage-tenant',
  'manage-keys',
  'manage-sessions',
  'view-audit',
] as const;

export type TenantCapability = (typeof TENANT_CAPABILITIES)[number];

/** Holds every capability in `TENANT_CAPABILITIES`, as a composite role. */
export const TENANT_ADMIN = 'tenant-admin';

/** Reaches every tenant. Provisioned only in the system tenant. */
export const MANAGE_TENANTS = 'manage-tenants';

const VIEW_COUNTERPARTS: Partial<Record<TenantCapability, TenantCapability>> = {
  'manage-users': 'view-users',
};

// Granting a manage- capability must never also require granting its view-
// counterpart beside it: the composite carries the read, so an operator
// cannot produce a subject that may write a thing it cannot read.
export function viewCounterpart(capability: TenantCapability): TenantCapability | null {
  return VIEW_COUNTERPARTS[capability] ?? null;
}
```

Add to `packages/domain-tenant/src/index.ts`:

```ts
export {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
  type TenantCapability,
} from '#/service/admin-capabilities';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/domain-tenant/src/service/admin-capabilities.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain-tenant/src/service/admin-capabilities.ts \
        packages/domain-tenant/src/service/admin-capabilities.test.ts \
        packages/domain-tenant/src/index.ts
git commit -m "Name the admin capabilities and the built-in admin client"
```

### Task 1.2: The migration — the system tenant row and the built-in marker

**Files:**

- Create: `packages/db/drizzle/0061_system_tenant.sql`
- Modify: `packages/domain-tenant/src/schema/clients.ts`
- Test: `packages/domain-tenant/tests/system-tenant.int.test.ts`

**Interfaces:**

- Consumes: `SYSTEM_TENANT_NAME` from Task 1.1.
- Produces: a `tenants` row named `system`; `clients.builtin_admin boolean NOT NULL DEFAULT false`, at most one true per tenant; `ClientRecord.builtinAdmin: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain-tenant/tests/system-tenant.int.test.ts
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: TestDatabase;
let owner: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.ownerUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  await createAppRole(container);
  app = createDatabase(container.appUrl);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await container?.stop();
});

describe('the system tenant', () => {
  it('exists after migration, enabled, with no subjects', async () => {
    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, 'system'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('refuses a second built-in admin client in one tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
      await tx.insert(clients).values({
        id: newId(),
        tenantId,
        clientId: 'odudu-admin',
        name: 'Admin',
        type: 'confidential',
        builtinAdmin: true,
      });
    });
    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await tx.insert(clients).values({
          id: newId(),
          tenantId,
          clientId: 'odudu-admin-2',
          name: 'Admin 2',
          type: 'confidential',
          builtinAdmin: true,
        });
      }),
    ).rejects.toThrow(/clients_one_builtin_admin/u);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/domain-tenant/tests/system-tenant.int.test.ts`
Expected: FAIL — no `system` row, and `builtinAdmin` is not a column.

- [ ] **Step 3: Write minimal implementation**

```sql
-- packages/db/drizzle/0061_system_tenant.sql

-- Cross-tenant administration is an explicit permission rather than a
-- property of living in a particular tenant, so this tenant is structurally
-- identical to every other one. Only the row is inserted here: its browser
-- flow and defaults come from provisionTenant, which `odudu seed admin`
-- calls, so that provisioning has one authority rather than two.
INSERT INTO tenants (id, name, display_name)
VALUES ('0199aa00-0000-7000-8000-000000000001', 'system', 'System');

-- Marks the client a tenant's administration roles hang from. The guard that
-- refuses to disable or delete it reads this, not the client_id, so a
-- renamed client cannot slip past it.
ALTER TABLE clients ADD COLUMN builtin_admin boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX clients_one_builtin_admin
  ON clients (tenant_id) WHERE builtin_admin;
```

In `packages/domain-tenant/src/schema/clients.ts`, add to the table and to `ClientRecord`:

```ts
  builtinAdmin: boolean('builtin_admin').notNull().default(false),
```

```ts
builtinAdmin: boolean;
```

and map it in `toRecord` in `packages/domain-tenant/src/repository/clients.ts`:

```ts
    builtinAdmin: row.builtinAdmin,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/domain-tenant/tests/system-tenant.int.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm vitest run packages/db/tests/schema-drift.int.test.ts`
Expected: PASS — the Drizzle schema and the migrations agree.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0061_system_tenant.sql \
        packages/domain-tenant/src/schema/clients.ts \
        packages/domain-tenant/src/repository/clients.ts \
        packages/domain-tenant/tests/system-tenant.int.test.ts
git commit -m "Add the system tenant and the built-in admin client marker"
```

### Task 1.3: Provisioning a tenant's admin client and capability roles

**Files:**

- Create: `packages/domain-tenant/src/usecase/provision-admin-client.ts`
- Create: `packages/domain-tenant/tests/provision-admin-client.int.test.ts`
- Modify: `packages/domain-tenant/src/index.ts`

**Interfaces:**

- Consumes: `TENANT_CAPABILITIES`, `TENANT_ADMIN`, `MANAGE_TENANTS`, `ADMIN_CLIENT_ID`, `viewCounterpart` (Task 1.1); `clientRepository`, `roleRepository`.
- Produces: `provisionAdminClient(tx: TenantScopedDatabase, tenantId: string, options?: { crossTenant?: boolean }): Promise<{ clientDbId: string }>` — idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain-tenant/tests/provision-admin-client.int.test.ts
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, provisionAdminClient, TENANT_ADMIN } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: TestDatabase;
let owner: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.ownerUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  await createAppRole(container);
  app = createDatabase(container.appUrl);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await container?.stop();
});

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
  });
  return tenantId;
}

describe('provisionAdminClient', () => {
  it('creates the client and the seven capability roles', async () => {
    const tenantId = await freshTenant();
    const { clientDbId } = await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId),
    );
    await withTenant(app.db, tenantId, async (tx) => {
      const repo = roleRepository(tx);
      for (const name of [
        'view-users',
        'manage-users',
        'manage-clients',
        'manage-tenant',
        'manage-keys',
        'manage-sessions',
        'view-audit',
      ]) {
        expect(await repo.byName(name, clientDbId), name).not.toBeNull();
      }
      expect(await repo.byName(TENANT_ADMIN, clientDbId)).not.toBeNull();
      expect(await repo.byName('manage-tenants', clientDbId)).toBeNull();
    });
  });

  it('provisions manage-tenants only when asked, and only once', async () => {
    const tenantId = await freshTenant();
    const { clientDbId } = await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId, { crossTenant: true }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId, { crossTenant: true }),
    );
    await withTenant(app.db, tenantId, async (tx) => {
      expect(await roleRepository(tx).byName('manage-tenants', clientDbId)).not.toBeNull();
    });
  });

  it('is invisible from another tenant', async () => {
    const mine = await freshTenant();
    const theirs = await freshTenant();
    await withTenant(app.db, mine, (tx) => provisionAdminClient(tx, mine));
    await withTenant(app.db, theirs, async (tx) => {
      const clientsSeen = await tx.query.clients.findMany();
      expect(clientsSeen.filter((c) => c.clientId === ADMIN_CLIENT_ID)).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/domain-tenant/tests/provision-admin-client.int.test.ts`
Expected: FAIL — `provisionAdminClient` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain-tenant/src/usecase/provision-admin-client.ts
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { clientRepository } from '#/repository/clients';
import {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
} from '#/service/admin-capabilities';

export interface ProvisionAdminClientOptions {
  /** Adds `manage-tenants`. Only the system tenant asks for it. */
  readonly crossTenant?: boolean;
}

export interface ProvisionedAdminClient {
  readonly clientDbId: string;
}

/**
 * Idempotent: re-running adds what is missing and changes nothing else, so a
 * tenant provisioned before a capability existed gains it on the next pass.
 */
export async function provisionAdminClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  options: ProvisionAdminClientOptions = {},
): Promise<ProvisionedAdminClient> {
  const clients = clientRepository(tx);
  const existing = await clients.byClientId(ADMIN_CLIENT_ID);
  const clientDbId = existing?.id ?? newId();
  if (existing === null) {
    await clients.create({
      id: clientDbId,
      tenantId,
      clientId: ADMIN_CLIENT_ID,
      name: 'Odudu administration',
      type: 'confidential',
      builtinAdmin: true,
    });
  }

  const roles = roleRepository(tx);
  const ensure = async (name: string): Promise<string> => {
    const found = await roles.byName(name, clientDbId);
    if (found !== null) return found.id;
    const created = await roles.create({ tenantId, clientId: clientDbId, name });
    return created.id;
  };

  const composite = await ensure(TENANT_ADMIN);
  for (const capability of TENANT_CAPABILITIES) {
    const roleId = await ensure(capability);
    await roles.addComposite(composite, roleId);
    const view = viewCounterpart(capability);
    if (view !== null) await roles.addComposite(roleId, await ensure(view));
  }
  if (options.crossTenant === true) {
    await roles.addComposite(composite, await ensure(MANAGE_TENANTS));
  }
  return { clientDbId };
}
```

Export it from `packages/domain-tenant/src/index.ts`:

```ts
export {
  provisionAdminClient,
  type ProvisionAdminClientOptions,
  type ProvisionedAdminClient,
} from '#/usecase/provision-admin-client';
```

`roleRepository.addComposite` must tolerate a repeat for idempotence. If it does not, add `ON CONFLICT DO NOTHING` to its insert in `packages/domain-authz/src/repository/roles.ts:110` and a unit test beside it asserting a second call is a no-op.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/domain-tenant/tests/provision-admin-client.int.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain-tenant/src/usecase/provision-admin-client.ts \
        packages/domain-tenant/src/index.ts \
        packages/domain-tenant/tests/provision-admin-client.int.test.ts
git commit -m "Provision a tenant's admin client and its capability roles"
```

### Task 1.4: `odudu seed admin`

**Files:**

- Modify: `apps/server/src/cli/seed.ts`
- Modify: `apps/server/src/cli/seed.test.ts`
- Modify: `packages/kernel/src/errors.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `provisionAdminClient` (Task 1.3), `provisionTenant`, `subjectRepository`, `userRepository`, `credentialRepository`, `hashPassword`, `requiredActionRepository`, `generateSigningKey`, `signingKeyRepository`.
- Produces: the `admin` seed subcommand; error code `seed_admin_exists`.

- [ ] **Step 1: Write the failing test**

```ts
// in apps/server/src/cli/seed.test.ts
describe('seed admin', () => {
  it('refuses a username that already administers', async () => {
    await seedAdmin({ username: 'root' });
    await expect(seedAdmin({ username: 'root' })).rejects.toMatchObject({
      code: 'seed_admin_exists',
    });
  });

  it('creates the subject with manage-tenants and a forced password change', async () => {
    const result = await seedAdmin({ username: 'ada' });
    expect(result.password).toHaveLength(32);
    await withTenant(app.db, result.tenantId, async (tx) => {
      const actions = await requiredActionRepository(tx).forSubject(result.subjectId);
      expect(actions).toContain('update-password');
      const reach = await effectiveRoles(tx, result.subjectId);
      expect(reach.map((r) => r.name)).toContain('manage-tenants');
    });
  });

  it('gives the system tenant a signing key, so it can issue admin tokens', async () => {
    const result = await seedAdmin({ username: 'kai' });
    await withTenant(app.db, result.tenantId, async (tx) => {
      await expect(signingKeyRepository(tx).active()).resolves.toMatchObject({ status: 'active' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/cli/seed.test.ts -t "seed admin"`
Expected: FAIL — `seedAdmin` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add `'seed_admin_exists'` to `ErrorCode` in `packages/kernel/src/errors.ts`. Add `'admin'` to `SEED_COMMANDS` and a `case 'admin':` to the dispatch in `seed.ts`. Then:

```ts
// in apps/server/src/cli/seed.ts

// 24 random bytes, base64url — a printed, single-use value, so length is
// chosen for pasting rather than for memorability. The update-password
// action written beside it is what makes it single-use.
function generatedPassword(): string {
  return randomBytes(24).toString('base64url');
}

export interface SeedAdminOptions {
  readonly username: string;
}

export interface SeededAdmin {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly password: string;
}

export async function seedAdmin(options: SeedAdminOptions): Promise<SeededAdmin> {
  const tenantId = await systemTenantId();
  const password = generatedPassword();
  return withTenant(database.db, tenantId, async (tx) => {
    await provisionTenant(tx, tenantId);
    const { clientDbId } = await provisionAdminClient(tx, tenantId, { crossTenant: true });
    await ensureSigningKey(tx, tenantId);

    if ((await userRepository(tx).byUsername(options.username)) !== null) {
      throw new OduduError(
        'seed_admin_exists',
        `a subject named ${JSON.stringify(options.username)} already exists in the system tenant`,
      );
    }

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId,
      username: options.username,
    });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(password) },
    });
    const admin = await roleRepository(tx).byName(TENANT_ADMIN, clientDbId);
    if (admin === null) throw new OduduError('role_not_found', 'tenant-admin was not provisioned');
    await roleRepository(tx).assignToSubject(subject.id, admin.id);
    await requiredActionRepository(tx).add(tenantId, subject.id, 'update-password');
    return { tenantId, subjectId: subject.id, password };
  });
}
```

`ensureSigningKey` generates an ES256 key under the configured KEK and inserts it as `active` when the tenant has none. The command prints the password once, on its own line, with a sentence saying it cannot be retrieved.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/cli/seed.test.ts -t "seed admin"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Update `README.md`, then commit**

`README.md` gains the bootstrap under its setup section: the command, that the password is printed once, that the first login forces a change, and that it needs database access rather than a running server.

```bash
git add apps/server/src/cli/seed.ts apps/server/src/cli/seed.test.ts \
        packages/kernel/src/errors.ts README.md
git commit -m "Bootstrap the first administrator with odudu seed admin"
```

### Increment 1 close

- [ ] Run `pnpm verify`. Expected: green.
- [ ] Push `p4c/1-system-tenant`, open its pull request into `p4c-admin-api`, and **open the draft pull request from `p4c-admin-api` into `main`** — this is the push that starts CI for the phase.
- [ ] `gh pr checks <pr> --watch` until green.
- [ ] Read every review comment the push attracted, answer each on its thread, and resolve only what is fixed or refuted.
- [ ] Merge into `p4c-admin-api`. Check that branch's own pull request is still green.

## Increment 2 — The package, the layering exception, and the request pipeline

Everything an admin request passes through before a route sees it. Nothing administers anything yet; one probe route exists so the pipeline is testable on its own.

### Task 2.1: The package, the permitted edge, and the ADR

**Files:**

- Create: `packages/protocol-admin/package.json`, `tsconfig.json`, `src/index.ts`
- Modify: `.dependency-cruiser.cjs`
- Create: `tests/boundaries/fixtures/protocol-admin-to-oidc.ts`
- Modify: `tests/boundaries/boundaries.test.ts`
- Create: `docs/adr/0035-the-admin-api-may-import-the-oidc-package.md`

**Interfaces:**

- Produces: `@odudu/protocol-admin` resolving, and `adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync` as a stub returning an empty plugin.

- [ ] **Step 1: Write the failing test**

```ts
// in tests/boundaries/boundaries.test.ts
it('permits the admin API to import the OIDC package', async () => {
  const result = await cruise(['tests/boundaries/fixtures/protocol-admin-to-oidc.ts'], options);
  expect(violationsOf(result, 'no-protocol-to-protocol')).toHaveLength(0);
});

it('still forbids the OIDC package importing the admin API', async () => {
  const result = await cruise(['tests/boundaries/fixtures/protocol-oidc-to-admin.ts'], options);
  expect(violationsOf(result, 'no-protocol-to-protocol')).toHaveLength(1);
});
```

with fixtures that import `@odudu/protocol-oidc` from a `packages/protocol-admin/`-shaped path and the reverse. Follow the existing fixture layout in `tests/boundaries/fixtures/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/boundaries/boundaries.test.ts`
Expected: FAIL — the first case reports a `no-protocol-to-protocol` violation, because the rule's `to` is `packages/protocol-(?!$2/)[^/]+/` with no exception.

- [ ] **Step 3: Write minimal implementation**

In `.dependency-cruiser.cjs`, narrow the rule's `from` so the admin package is not a source of it, and add a rule that forbids the reverse explicitly:

```js
    {
      name: 'no-protocol-to-protocol',
      severity: 'error',
      comment:
        'Protocols stay independently testable and independently deletable. protocol-admin is ' +
        'exempt as a source: it administers the protocol surface rather than standing beside it, ' +
        'so it is downstream by definition (ADR 0035). The reverse edge is forbidden below.',
      from: { path: '(^|/)packages/protocol-([^/]+)/', pathNot: '(^|/)packages/protocol-admin/' },
      to: { path: '(^|/)packages/protocol-(?!$2/)[^/]+/' },
    },
    {
      name: 'no-protocol-to-admin',
      severity: 'error',
      comment:
        'The admin API may import a protocol package; a protocol package may never import it. ' +
        'Without this the exemption above would be a two-way door and the cycle would return.',
      from: { path: '(^|/)packages/protocol-(?!admin/)[^/]+/' },
      to: { path: '(^|/)packages/protocol-admin/' },
    },
```

Write `docs/adr/0035-the-admin-api-may-import-the-oidc-package.md` recording: the rule exists to keep _peer_ protocol surfaces independently deletable (OIDC and P8's SAML); the admin API is not a peer; `client_oidc_config` and `token_grants` live in `protocol-oidc` and client management needs both; the rejected alternative is moving those schemas into `domain-tenant`, which is where they arguably belong and which a later phase may still do, at which point this exception is what it removes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/boundaries/boundaries.test.ts`
Expected: PASS.

Run: `pnpm boundaries`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin .dependency-cruiser.cjs tests/boundaries \
        docs/adr/0035-the-admin-api-may-import-the-oidc-package.md
git commit -m "Add protocol-admin and permit its one edge to protocol-oidc"
```

### Task 2.2: A test harness, so fourteen files do not repeat a container bootstrap

**Files:**

- Create: `packages/testkit/src/admin.ts`
- Modify: `packages/testkit/src/index.ts`

**Interfaces:**

- Produces:

```ts
export interface TestClient {
  readonly id: string;
  readonly clientId: string;
  readonly secret: string;
  /** A bearer token for this client's own service account, when it has one. */
  readonly token: string;
}

export interface AdminFixture {
  readonly owner: DatabaseHandle;
  readonly app: DatabaseHandle;
  readonly http: FastifyInstance;
  readonly clock: FakeClock;
  readonly systemTenantId: string;

  /** Creates a tenant, provisions its flow and its admin client, mints a key. */
  createTenant(name: string): Promise<{ id: string; name: string }>;
  stop(): Promise<void>;

  // Tokens. `adminToken` and `systemAdminToken` carry `aud` = `${issuer}/admin`;
  // `applicationToken` deliberately does not, which is what tells the admin
  // audience check apart from an ordinary access token.
  adminToken(tenantName: string, capabilities: readonly string[]): Promise<string>;
  systemAdminToken(capabilities: readonly string[]): Promise<string>;
  applicationToken(tenantName: string, options: { audience: string }): Promise<string>;

  // Subjects and clients.
  createSubject(tenantName: string, username: string): Promise<{ id: string }>;
  createConfidentialClient(
    tenantName: string,
    overrides: Partial<{ grantTypes: string[]; redirectUris: string[] }>,
  ): Promise<TestClient>;
  createServiceAccountClient(
    tenantName: string,
    capabilities: readonly string[],
  ): Promise<TestClient>;
  builtinAdminClient(tenantName: string): Promise<TestClient>;
  registerClient(
    tenantName: string,
    metadata: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>;
  registerClientWithUserinfoAlg(tenantName: string, alg: string): Promise<TestClient>;
  patchClient(
    tenantName: string,
    clientDbId: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>;

  // Protocol calls, so a test can prove an admin change reached /token.
  tokenRequest(
    tenantName: string,
    client: TestClient,
    body: Record<string, string>,
  ): Promise<LightMyRequestResponse>;

  // State changes a test needs but no endpoint offers, written directly.
  revokeGrantsFor(tenantName: string): Promise<void>;
  revokeCapability(tenantName: string, token: string, capability: string): Promise<void>;
  disableClientOf(token: string): Promise<void>;
  renameClientIdDirectly(tenantId: string, clientDbId: string, clientId: string): Promise<void>;
  /** Forces the next mutation to throw after its audit row is written. */
  failNextWriteAfterAudit(): Promise<void>;
}

export function startAdminFixture(): Promise<AdminFixture>;
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/testkit/src/admin.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/admin';

let fixture: AdminFixture;
beforeAll(async () => {
  fixture = await startAdminFixture();
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

describe('startAdminFixture', () => {
  it('mints a token carrying only the capabilities asked for', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect(token.split('.')).toHaveLength(3);
  });

  it('isolates tenants created through it', async () => {
    const a = await fixture.createTenant('alpha');
    const b = await fixture.createTenant('beta');
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/testkit/src/admin.test.ts`
Expected: FAIL — `Cannot find module '#/admin'`.

- [ ] **Step 3: Write minimal implementation**

`startAdminFixture` does once what Task 1.2's test does by hand: start the container, run migrations, create the app role, open both handles, build a Fastify instance with `adminRoutes` mounted, and hold a `FakeClock`. `createTenant` inserts the row, calls `provisionTenant` and `provisionAdminClient`, and mints an ES256 signing key. `adminToken` creates a subject, assigns exactly the named capability roles, and signs an access token with `iss` set to that tenant's issuer and `aud` set to `${issuer}/admin`.

The fixture is a test helper, not product code, so it lives in `testkit` and no package under `packages/` other than a test imports it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/testkit/src/admin.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/testkit/src/admin.ts packages/testkit/src/admin.test.ts \
        packages/testkit/src/index.ts
git commit -m "Add an admin API test fixture to the testkit"
```

### Task 2.3: The bearer chain refuses everything that is not an admin token

Review Focus #2 lives here.

**Files:**

- Create: `packages/protocol-admin/src/usecase/authenticate-admin.ts`
- Create: `packages/protocol-admin/tests/authentication.int.test.ts`

**Interfaces:**

- Consumes: `verifyJwt` (`@odudu/crypto`), `signingKeyRepository`, `tokenGrantRepository.byId`, `sessionRepository.isLive`, the `client.enabled` read.
- Produces:

```ts
export type AdminPrincipal = {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly clientDbId: string;
};
export type AdminAuthOutcome =
  | { kind: 'authenticated'; principal: AdminPrincipal }
  | { kind: 'unauthenticated'; reason: string };

export function authenticateAdmin(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
): Promise<AdminAuthOutcome>;
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/tests/authentication.int.test.ts
describe('admin authentication', () => {
  it('refuses an ordinary access token from the right tenant', async () => {
    const t = await fixture.createTenant('acme');
    // Minted with the tenant's own key and a live grant, but aud is the API
    // the application talks to, not the admin API.
    const token = await fixture.applicationToken(t.name, { audience: 'https://api.example' });
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses a token signed by a third tenant', async () => {
    const target = await fixture.createTenant('acme');
    const other = await fixture.createTenant('evil');
    const token = await fixture.adminToken(other.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${target.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token whose grant has been revoked', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    await fixture.revokeGrantsFor(t.name);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token whose client has been disabled', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    await fixture.disableClientOf(token);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a token from the target tenant with the admin audience', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/authentication.int.test.ts`
Expected: FAIL — every case 404, because no `/admin` route exists.

- [ ] **Step 3: Write minimal implementation**

`authenticateAdmin` runs spec §7's steps 1 to 4 in order, returning `unauthenticated` at the first failure and never saying which step failed in the response body:

1. Parse `Authorization: Bearer <jwt>`; absent or malformed is `unauthenticated`.
2. Read the unverified `iss`; accept it only if it equals the target tenant's issuer or the system tenant's, compared as strings. Verify the signature against **that** tenant's publishable keys.
3. Require `aud` to contain `${iss}/admin`. This is a resource identifier a client obtains through RFC 8707's `resource` parameter, so no new minting concept is introduced.
4. Load the grant named by the token; require it unrevoked, its session live, and its client enabled.

The `whoami` probe route returns `{ subjectId, issuerTenantId }` and exists so the pipeline is testable before any resource does. It is removed in Increment 4 once real routes exist, and the tests move with it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/authentication.int.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src packages/protocol-admin/tests
git commit -m "Authenticate an admin request, refusing everything else"
```

### Task 2.4: Capability, re-resolved on every request

**Files:**

- Create: `packages/protocol-admin/src/service/capability.ts`
- Create: `packages/protocol-admin/src/service/capability.test.ts`
- Create: `packages/protocol-admin/src/usecase/authorize-admin.ts`
- Modify: `packages/protocol-admin/tests/authentication.int.test.ts`

**Interfaces:**

- Consumes: `effectiveRoles` (`@odudu/domain-authz`), `AdminPrincipal` (Task 2.3).
- Produces: `requiredCapability(method: string, routePattern: string): TenantCapability | null` and `authorizeAdmin(deps, principal, target, required): Promise<'allowed' | 'forbidden'>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/src/service/capability.test.ts
import { describe, expect, it } from 'vitest';
import { requiredCapability } from '#/service/capability';

describe('requiredCapability', () => {
  it('reads a subject list with view-users and writes with manage-users', () => {
    expect(requiredCapability('GET', '/admin/tenants/:tenant/subjects')).toBe('view-users');
    expect(requiredCapability('POST', '/admin/tenants/:tenant/subjects')).toBe('manage-users');
  });

  it('has an entry for every admin route', () => {
    // ADMIN_ROUTES is the single list the router registers from, so a route
    // added without a capability fails here rather than shipping open.
    for (const route of ADMIN_ROUTES) {
      expect(
        requiredCapability(route.method, route.pattern),
        `${route.method} ${route.pattern}`,
      ).not.toBeUndefined();
    }
  });
});
```

and, in the integration file:

```ts
it('refuses a capability the caller does not hold', async () => {
  const t = await fixture.createTenant('acme');
  const token = await fixture.adminToken(t.name, ['view-audit']);
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${t.name}/subjects`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(403);
});

it('stops honouring a capability the moment it is revoked', async () => {
  const t = await fixture.createTenant('acme');
  const token = await fixture.adminToken(t.name, ['view-users']);
  const url = `/admin/tenants/${t.name}/subjects`;
  const headers = { authorization: `Bearer ${token}` };
  expect((await fixture.http.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
  await fixture.revokeCapability(t.name, token, 'view-users');
  expect((await fixture.http.inject({ method: 'GET', url, headers })).statusCode).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin`
Expected: FAIL — `requiredCapability` is not defined; the revocation case returns 200 twice.

- [ ] **Step 3: Write minimal implementation**

`ADMIN_ROUTES` is one exported array of `{ method, pattern, capability }`, and the router registers from it, so the table and the routes cannot disagree. `authorizeAdmin` calls `effectiveRoles` against the **target** tenant's context and requires the named capability; where the principal's issuer is the system tenant and the target is another tenant, it additionally requires `manage-tenants`, resolved in the system tenant's own context.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin
git commit -m "Re-resolve an admin caller's capability on every request"
```

### Task 2.5: Cross-tenant probes

Review Focus #1 lives here, and this is the phase's own exit criterion.

**Files:**

- Create: `packages/protocol-admin/tests/cross-tenant.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('cross-tenant administration', () => {
  it('refuses a tenant-local admin of T at U, with every capability held', async () => {
    const t = await fixture.createTenant('acme');
    const u = await fixture.createTenant('umbrella');
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('admits a system admin holding manage-tenants', async () => {
    const u = await fixture.createTenant('umbrella');
    const token = await fixture.systemAdminToken(['manage-tenants', 'view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a system admin without manage-tenants', async () => {
    const u = await fixture.createTenant('umbrella');
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('reads no row of U even when the authorization check is bypassed', async () => {
    // RLS is the second defence for a tenant-local caller: bind T's context
    // and ask for U's subjects directly, the way a bug in the check would.
    const t = await fixture.createTenant('acme');
    const u = await fixture.createTenant('umbrella');
    await fixture.createSubject(u.name, 'victim');
    const seen = await withTenant(fixture.app.db, t.id, (tx) => tx.query.users.findMany());
    expect(seen.map((row) => row.username)).not.toContain('victim');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/cross-tenant.int.test.ts`
Expected: FAIL — the first case returns 200 or 403 rather than 401 until the issuer check is exact.

Note the expected codes: a tenant-local admin of T presenting at U fails at **step 2** of §7, because T's issuer is neither U's nor the system tenant's — so it is a 401, not a 403. A system admin _is_ admitted by step 2 and refused at step 6, which is a 403. The two cases must not collapse into one code, or the tests stop distinguishing "you are not who this path accepts" from "you are, and may not do this".

- [ ] **Step 3: Write minimal implementation**

Whatever the previous two tasks got wrong. If all four pass unchanged, the tasks were right and this task adds only the tests — which is a legitimate outcome and is recorded as such in the commit message.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/cross-tenant.int.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/tests/cross-tenant.int.test.ts
git commit -m "Probe the cross-tenant boundary from both sides"
```

### Task 2.6: Mounting it

**Files:**

- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('serves the admin API and leaves the OIDC routes alone', async () => {
  const res = await app.inject({ method: 'GET', url: '/admin/tenants/acme/subjects' });
  expect(res.statusCode).toBe(401);
  const discovery = await app.inject({
    method: 'GET',
    url: '/tenants/acme/.well-known/openid-configuration',
  });
  expect(discovery.statusCode).not.toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/app.test.ts`
Expected: FAIL — 404 on the admin path.

- [ ] **Step 3: Write minimal implementation**

Register `adminRoutes` in `buildApp`, wired at the composition root the way `oidcRoutes` is: `findTenant` on the owner connection (ADR 0009's amendment — the lookup happens before any tenant context exists), the app connection for everything else, and the same `kek`, `logger` and `clock`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "Mount the admin API beside the OIDC routes"
```

### Increment 2 close

- [ ] `pnpm verify` green.
- [ ] Push `p4c/2-request-pipeline`; CI green on the pushed commit; review answered on its threads.
- [ ] Merge into `p4c-admin-api`; that branch's pull request still green.

## Increment 3 — The contract machinery

Run **Spike A** and **Spike B** before Task 3.1. Everything from Increment 4 onward is written against what this increment establishes, so a wrong shape here is re-done fourteen times.

### Task 3.1: Zod contracts compiled for ajv

**Files:**

- Create: `packages/contracts/admin/index.ts`, `packages/contracts/admin/shared.ts`
- Modify: `packages/contracts/package.json` (an `./admin` export subpath)
- Create: `packages/protocol-admin/src/adapter/validation.ts`
- Create: `packages/protocol-admin/src/adapter/validation.test.ts`

**Interfaces:**

- Produces: `compileSchema(schema: z.ZodType): ValidateFunction` and `adminValidatorCompiler`, wired to Fastify with `setValidatorCompiler` on the `/admin` prefix only.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/src/adapter/validation.test.ts
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { compileSchema } from '#/adapter/validation';

describe('compileSchema', () => {
  it('accepts a body matching the schema', () => {
    const validate = compileSchema(z.object({ name: z.string() }));
    expect(validate({ name: 'acme' })).toBe(true);
  });

  it('rejects an unknown property, because Zod emits additionalProperties false', () => {
    const validate = compileSchema(z.object({ name: z.string() }));
    expect(validate({ name: 'acme', sneaky: 1 })).toBe(false);
  });

  it('compiles a 2020-12 schema without falling back to draft-07 semantics', () => {
    // prefixItems is 2020-12; draft-07's ajv ignores it and would accept
    // anything, so this is what tells the two dialects apart.
    const validate = compileSchema(z.tuple([z.string(), z.number()]));
    expect(validate(['a', 1])).toBe(true);
    expect(validate([1, 'a'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/src/adapter/validation.test.ts`
Expected: FAIL — `compileSchema` is not defined.

- [ ] **Step 3: Write minimal implementation**

Per Spike A's answer. If `Ajv2020` wires cleanly:

```ts
// packages/protocol-admin/src/adapter/validation.ts
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { z } from 'zod';

// ajv 8's default export is draft-07; z.toJSONSchema emits 2020-12, and a
// draft-07 validator silently ignores the keywords it does not know rather
// than refusing them — so the dialect has to be chosen explicitly.
const ajv = addFormats(new Ajv2020({ allErrors: false, strict: true }));

export function compileSchema(schema: z.ZodType): ValidateFunction {
  return ajv.compile(z.toJSONSchema(schema));
}
```

If it does not, compile twice from the one authored schema —
`z.toJSONSchema(schema, { target: 'draft-7' })` for ajv and the 2020-12 form
for the OpenAPI document — and say so in a comment naming both consumers.

`packages/contracts/admin/shared.ts` holds what every resource reuses: the
cursor query shape, the problem-details response shape, and the `id`,
`created_at` and `ETag` primitives.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/src/adapter/validation.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/admin packages/contracts/package.json \
        packages/protocol-admin/src/adapter
git commit -m "Compile admin contracts from Zod for boundary validation"
```

### Task 3.2: Problem details, without disturbing RFC 6749

**Files:**

- Create: `packages/protocol-admin/src/view/problem.ts`
- Create: `packages/protocol-admin/src/view/problem.test.ts`
- Modify: `packages/protocol-admin/src/index.ts`

**Interfaces:**

- Produces: `problem(status: number, type: string, title: string, detail?: string): Problem` and `sendProblem(reply, request, problem)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/src/view/problem.test.ts
describe('problem', () => {
  it('carries type, title, status and the request id as instance', () => {
    expect(problem(403, 'about:blank#forbidden', 'Forbidden', 'manage-users required')).toEqual({
      type: 'about:blank#forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'manage-users required',
    });
  });

  it('omits detail rather than emitting null', () => {
    expect(problem(401, 'about:blank#unauthorized', 'Unauthorized')).not.toHaveProperty('detail');
  });
});
```

and, in the integration file:

```ts
it('leaves the OIDC error body alone on the same instance', async () => {
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/tenants/${t.name}/protocol/openid-connect/token`,
    payload: 'grant_type=nonsense',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.headers['content-type']).toContain('application/json');
  expect(res.json()).toHaveProperty('error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin`
Expected: FAIL — `problem` is not defined.

- [ ] **Step 3: Write minimal implementation**

Per Spike B's answer: an error handler and a serializer registered inside the `/admin` plugin's own encapsulation context, so Fastify's scoping keeps it off the OIDC routes. `sendProblem` sets `content-type: application/problem+json` and `instance` to `request.id`, which the server already generates and echoes as `x-request-id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src/view/problem.ts packages/protocol-admin/src/view/problem.test.ts
git commit -m "Answer admin errors with RFC 9457 problem details"
```

### Task 3.3: Delete the dead schemas and amend ADR 0007

**Files:**

- Delete: `packages/contracts/src/authorize.ts`, `packages/contracts/src/authorize.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `docs/adr/0007-zod-authored-json-schema-executed.md`
- Modify: `docs/NEXT.md`

- [ ] **Step 1: Write the failing test**

There is no behaviour to test — the exports have no consumer, which is the point. The check is the build:

Run: `grep -rn "authorizeQuerySchema\|AuthorizeQuery" --include="*.ts" . | grep -v node_modules`
Expected before the change: four hits, all inside `packages/contracts`.
Expected after: none.

- [ ] **Step 2: Run the typecheck to see nothing else depends on them**

Run: `pnpm typecheck`
Expected: PASS both before and after. A failure after deletion means a consumer exists that the grep missed, and the deletion is wrong.

- [ ] **Step 3: Delete, and amend the ADR**

Remove both files and the `index.ts` re-export. Append to ADR 0007 under a dated **Amendment** heading:

- It governs **JSON endpoints**; the admin API is its first execution.
- The form-encoded protocol endpoints keep `parseStructure`, for two reasons: their 400 body is RFC-defined (`error`/`error_description`) and ajv's is not, and at `/authorize` a check's position in the sequence is what makes it safe — boundary validation that rejects every structurally invalid request up front collapses render-versus-redirect for a missing `redirect_uri`.
- `authorizeQuerySchema` and `AuthorizeQuery` are deleted, `2e1e0e4`'s deletion of `tokenRequestSchema` being the precedent. They had no consumer and were stale in the same way — no `response_mode`, no `resource`, no `claims`, all three accepted by `/authorize` since P3b. The comment that kept them claimed consumers that did not exist.

Remove the corresponding entry from `docs/NEXT.md`'s "Decisions still open".

- [ ] **Step 4: Verify**

Run: `pnpm verify`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A packages/contracts docs/adr/0007-zod-authored-json-schema-executed.md docs/NEXT.md
git commit -m "Delete the unused authorize schema and amend ADR 0007"
```

### Task 3.4: Cursor pagination that refuses a forged cursor

Review Focus #3 lives here.

**Files:**

- Create: `packages/protocol-admin/src/service/cursor.ts`
- Create: `packages/protocol-admin/src/service/cursor.test.ts`

**Interfaces:**

- Produces:

```ts
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export function coerceLimit(raw: string | undefined): number;
export function encodeCursor(key: Uint8Array, c: CursorPayload): string;
export function decodeCursor(
  key: Uint8Array,
  collection: string,
  tenantId: string,
  raw: string,
): { kind: 'ok'; after: string } | { kind: 'invalid' };
export interface CursorPayload {
  readonly after: string;
  readonly collection: string;
  readonly tenantId: string;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/src/service/cursor.test.ts
const KEY = new Uint8Array(32).fill(7);

describe('coerceLimit', () => {
  it('defaults, and coerces down rather than refusing', () => {
    expect(coerceLimit(undefined)).toBe(50);
    expect(coerceLimit('10')).toBe(10);
    expect(coerceLimit('100000')).toBe(200);
  });

  it('refuses a limit that is not a positive integer', () => {
    for (const raw of ['0', '-1', '1.5', '1e3', ' 7 ', '']) {
      expect(() => coerceLimit(raw), raw).toThrow();
    }
  });
});

describe('decodeCursor', () => {
  it('round-trips a cursor for its own collection and tenant', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't1' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'ok', after: 'a-uuid' });
  });

  it('refuses a cursor minted for another collection', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'clients', tenantId: 't1' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor minted for another tenant', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't2' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a hand-written cursor', () => {
    const forged = Buffer.from(
      JSON.stringify({ after: 'a-uuid', collection: 'subjects', tenantId: 't1' }),
    ).toString('base64url');
    expect(decodeCursor(KEY, 'subjects', 't1', forged)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor whose tag was tampered with', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't1' });
    const tampered = `${raw.slice(0, -2)}${raw.endsWith('aa') ? 'bb' : 'aa'}`;
    expect(decodeCursor(KEY, 'subjects', 't1', tampered)).toEqual({ kind: 'invalid' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/src/service/cursor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`encodeCursor` serialises the payload, appends an HMAC-SHA256 tag over it under a key derived from `ODUDU_KEK`, and base64url-encodes the pair. `decodeCursor` verifies the tag with a timing-safe comparison **before** parsing, then requires the payload's collection and tenant to equal the ones the request is for. A cursor is otherwise an arbitrary-offset read into a table the caller chose.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/src/service/cursor.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src/service/cursor.ts packages/protocol-admin/src/service/cursor.test.ts
git commit -m "Add opaque, tamper-evident cursors for admin list endpoints"
```

### Task 3.5: `ETag` and `If-Match`

**Files:**

- Create: `packages/protocol-admin/src/service/etag.ts`
- Create: `packages/protocol-admin/src/service/etag.test.ts`

**Interfaces:**

- Produces: `etagOf(record: unknown): string` and `matches(ifMatch: string | undefined, current: string): 'absent' | 'match' | 'mismatch'`.

- [ ] **Step 1: Write the failing test**

```ts
describe('etagOf', () => {
  it('is stable for equal records and differs for different ones', () => {
    expect(etagOf({ a: 1, b: 2 })).toBe(etagOf({ b: 2, a: 1 }));
    expect(etagOf({ a: 1 })).not.toBe(etagOf({ a: 2 }));
  });
});

describe('matches', () => {
  it('treats an absent header as a caller who did not ask', () => {
    expect(matches(undefined, '"abc"')).toBe('absent');
  });
  it('matches an equal tag and refuses an unequal one', () => {
    expect(matches('"abc"', '"abc"')).toBe('match');
    expect(matches('"stale"', '"abc"')).toBe('mismatch');
  });
  it('refuses a wildcard rather than treating it as a match', () => {
    // `*` means "if the resource exists" in RFC 9110; honouring it here
    // would make an unconditional write look conditional.
    expect(matches('*', '"abc"')).toBe('mismatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/src/service/etag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`etagOf` hashes a canonical JSON serialisation with sorted keys, so key order cannot change a tag. `matches` is a strict string comparison against the quoted tag, with `*` refused.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/src/service/etag.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src/service/etag.ts packages/protocol-admin/src/service/etag.test.ts
git commit -m "Add ETag and If-Match for admin resource writes"
```

### Task 3.6: The OpenAPI document, and the test that keeps it honest

**Files:**

- Create: `packages/protocol-admin/src/view/routes/openapi.ts`
- Create: `packages/protocol-admin/tests/openapi.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('the published OpenAPI document', () => {
  it('describes every route the router registers', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };
    for (const route of ADMIN_ROUTES) {
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      expect(
        doc.paths[path]?.[route.method.toLowerCase()],
        `${route.method} ${path}`,
      ).toBeDefined();
    }
  });

  it('describes no route the router does not register', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };
    const registered = new Set(
      ADMIN_ROUTES.map((r) => `${r.method.toLowerCase()} ${r.pattern.replace(/:(\w+)/gu, '{$1}')}`),
    );
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const method of Object.keys(methods)) {
        expect(registered.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
      }
    }
  });

  it('is served without authentication, and describes the scheme it requires', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: expect.stringMatching(/^3\.1\./u) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/openapi.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

The document is generated from `ADMIN_ROUTES` and each route's Zod schemas via `z.toJSONSchema`, assembled into an OpenAPI 3.1 object. It is unauthenticated: it describes the API rather than exposing anything from it, and a client that cannot read it cannot generate against it.

Both directions are tested because a document with extra paths lies as readily as one with missing paths, and only the second direction catches a route that was deleted.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/openapi.int.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src/view/routes/openapi.ts packages/protocol-admin/tests/openapi.int.test.ts
git commit -m "Publish the admin API as OpenAPI 3.1, proven to cover every route"
```

### Increment 3 close

- [ ] `pnpm verify` green; push `p4c/3-contract-machinery`; CI green; review answered; merge.

---

## The resource pattern

Increments 4 to 8 each add resources, and they all have the same shape. It is written once here; each task below states only what differs — its schemas, its capability, its validation rules and its tests.

**Per resource group, five files:**

| File                                                   | Holds                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/admin/<group>.ts`                  | The Zod request and response schemas.                                                                                   |
| `packages/protocol-admin/src/service/<group>-patch.ts` | The allowlist of amendable fields and the refusal reason for each excluded one. A leaf; unit-tested without a database. |
| `packages/protocol-admin/src/usecase/<group>.ts`       | List, read, create, amend, delete — one exported function each, taking a `TenantScopedDatabase`.                        |
| `packages/protocol-admin/src/view/routes/<group>.ts`   | Fastify registration from `ADMIN_ROUTES`, no logic.                                                                     |
| `packages/protocol-admin/tests/<group>.int.test.ts`    | The capability matrix row, the happy paths, and the group's own refusals.                                               |

**Every list endpoint** takes `?limit=` and `?cursor=`, orders by `id`, emits `Link: rel="next"` and a body `next`, and returns no total.

**Every single-resource read** returns an `ETag`. **Every amend** honours `If-Match` and answers `412` on a mismatch.

**Every mutation** writes one audit row in the same transaction (wired in Increment 13; until then the usecases take an `audit` dependency that the tests assert is called, and the composition root supplies a no-op).

**Every task's tests include the capability matrix row for its routes** — a caller holding each capability and no other — so the matrix is complete by construction rather than assembled at the end.

---

## Increment 4 — Tenants and their settings

### Task 4.1: `/admin/tenants` — list and create

**Files:** the five of the resource pattern, for `tenants`. Also modify `apps/server/src/cli/seed.ts` so `seed tenant` refuses the name `system`.

**Interfaces:**

- Consumes: `provisionTenant`, `provisionAdminClient` (Task 1.3), `coerceLimit`, `encodeCursor`, `decodeCursor` (Task 3.4).
- Produces: `listTenants`, `createTenant` in `usecase/tenants.ts`.

**Capability:** `manage-tenants` for both. There is no tenant-local view of the tenant collection: a tenant-local admin already knows which tenant they administer, and listing the others is exactly the cross-tenant read `manage-tenants` gates.

- [ ] **Step 1: Write the failing test**

```ts
describe('POST /admin/tenants', () => {
  it('provisions the flow and the admin client with the tenant', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'acme', display_name: 'Acme' },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    await withTenant(fixture.app.db, id, async (tx) => {
      expect(await executionRepository(tx).forTenant(id)).not.toHaveLength(0);
      expect(await clientRepository(tx).byClientId('odudu-admin')).not.toBeNull();
    });
  });

  it('refuses the name system', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'system' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses a tenant-local admin holding every tenant capability', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'sneaky' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /admin/tenants', () => {
  it('pages with an opaque cursor and stops without a next link', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    for (const name of ['a1', 'a2', 'a3']) await fixture.createTenant(name);
    const first = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants?limit=2',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((first.json() as { items: unknown[] }).items).toHaveLength(2);
    expect(first.headers.link).toMatch(/rel="next"/u);
    const next = (first.json() as { next: string }).next;
    const second = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants?limit=2&cursor=${encodeURIComponent(next)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.headers.link).toBeUndefined();
    expect(second.json()).not.toHaveProperty('next');
  });

  it('returns no total', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).not.toHaveProperty('total');
    expect(res.json()).not.toHaveProperty('total_size');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/tenants.int.test.ts`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write minimal implementation**

`createTenant` runs in one transaction: insert the row, `provisionTenant`, `provisionAdminClient`. The name `system` is refused with 409 by an explicit check rather than left to the unique index, so the reason reaches the caller. `seed tenant` gains the same refusal, with a unit test, because the two doors must not disagree.

The system tenant appears in the listing like any other. Hiding it would make the one tenant an operator most needs to inspect the one they cannot.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/tenants.int.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/tenants.ts apps/server/src/cli/seed.ts
git commit -m "Create and list tenants through the admin API"
```

### Task 4.2: `/admin/tenants/{t}` and `/settings`

**Files:** the resource pattern, for `settings`.

**Interfaces:**

- Consumes: `coerceTenantSetting` and `TENANT_SETTING_NAMES` (`packages/domain-tenant/src/service/tenant-settings.ts`) — **reused, never re-implemented**. That map is the one authority `seed tenant --set` already uses.
- Produces: `readSettings`, `amendSettings` in `usecase/settings.ts`.

**Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

```ts
describe('PATCH /admin/tenants/{t}/settings', () => {
  it('applies a setting the CLI also applies, through the same map', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true, password_min_length: 14 },
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ verifyEmail: true, passwordMinLength: 14 });
    });
  });

  it('refuses an unknown setting, naming the known ones', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { not_a_setting: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets the database refuse a value outside its CHECK', async () => {
    // Ranges are CHECK constraints, deliberately not restated in the
    // settings map — a policy no writer may bypass belongs at the database.
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password_min_length: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 412 when If-Match is stale', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = await fixture.http.inject({ method: 'GET', url, headers });
    const etag = read.headers.etag as string;
    await fixture.http.inject({ method: 'PATCH', url, headers, payload: { verify_email: true } });
    const stale = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { verify_email: false },
    });
    expect(stale.statusCode).toBe(412);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/settings.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`amendSettings` maps each supplied name through `coerceTenantSetting`, collects the coerced columns, and issues one `UPDATE`. A CHECK violation is caught and turned into a 400 problem naming the setting — the constraint stays the authority and the caller still learns which value it refused.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/settings.int.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Update `docs/admin-paths.md` with the first executed transcript, then commit**

This is where `docs/admin-paths.md` is created: the file header, the three-artifact note, the pointer to `docs/request-paths.md`, and an executed transcript of bootstrapping an admin, obtaining a token and amending a setting. Add the reciprocal pointer to `docs/request-paths.md`.

```bash
git add packages/protocol-admin packages/contracts/admin/settings.ts \
        docs/admin-paths.md docs/request-paths.md
git commit -m "Amend a tenant's settings through the admin API"
```

### Increment 4 close

- [ ] `pnpm verify` green; push `p4c/4-tenants-and-settings`; CI green; review answered; merge.

---

## Increment 5 — Clients, and what disabling one means

The largest increment. It also lands the `client.enabled` predicate, which changes three documented request paths.

### Task 5.1: `/admin/tenants/{t}/clients` — list, read, create

**Files:** the resource pattern, for `clients`.

**Interfaces:**

- Consumes: `clientRepository`, `clientOidcConfigRepository`, `parseClientMetadata`.
- Produces: `listClients`, `readClient`, `createClient` in `usecase/clients.ts`.

**Capability:** `manage-clients` throughout — there is no `view-clients`, because client metadata is configuration rather than a population to browse, and the seven capabilities were fixed in Task 1.1.

- [ ] **Step 1: Write the failing test**

Cover: a created client appears in the listing; a secret is returned **once** on creation and never by a read; the read carries an `ETag`; a caller with `manage-users` alone is refused with 403; `parseClientMetadata`'s refusals reach the caller unchanged — assert a `jwks` and `jwks_uri` supplied together is a 400 with the same detail dynamic registration gives.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`createClient` runs `parseClientMetadata` first, so the admin door and the registration door refuse identically. A confidential client's generated secret is returned in the creation response and nowhere else; the row stores only its hash.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/clients.ts
git commit -m "List, read and create clients through the admin API"
```

### Task 5.2: The amendable-field allowlist, as a leaf

**Files:**

- Create: `packages/protocol-admin/src/service/client-patch.ts`
- Create: `packages/protocol-admin/src/service/client-patch.test.ts`

**Interfaces:**

- Produces: `AMENDABLE_CLIENT_FIELDS: readonly string[]`, `refusalFor(field: string): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
describe('the client amendment allowlist', () => {
  it('admits the three mutable columns on clients and all 22 on client_oidc_config', () => {
    expect(AMENDABLE_CLIENT_FIELDS).toHaveLength(25);
    for (const field of [
      'name',
      'enabled',
      'full_scope_allowed',
      'redirect_uris',
      'grant_types',
      'token_exchange_impersonation_allowed',
      'tls_client_auth_subject_dn',
      'userinfo_signed_response_alg',
    ]) {
      expect(AMENDABLE_CLIENT_FIELDS, field).toContain(field);
    }
  });

  it('refuses identity, history, provenance, the secret and the type, each with a reason', () => {
    for (const field of [
      'id',
      'tenant_id',
      'client_id',
      'created_at',
      'registration_origin',
      'service_subject_id',
      'secret_hash',
      'type',
    ]) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives an amendable field no refusal', () => {
    expect(refusalFor('redirect_uris')).toBeNull();
  });

  it('accounts for every column of both tables', () => {
    // A column added later is either amendable or refused with a reason —
    // never silently neither, which is how a field becomes unreachable.
    for (const column of [...CLIENT_COLUMNS, ...CLIENT_OIDC_CONFIG_COLUMNS]) {
      const known = AMENDABLE_CLIENT_FIELDS.includes(column) || refusalFor(column) !== null;
      expect(known, column).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/src/service/client-patch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

The allowlist and a `Record<string, string>` of refusal reasons, each reason the one from the spec: identity breaks relying parties and orphans `azp`; `created_at` is history; `registration_origin` is provenance; `service_subject_id` re-points role assignments; `secret_hash` is rotated through its own endpoint; `type` silently changes a live client's security model in both directions.

The fourth test is the one that matters long-term — it is what stops a column added in P5 or P13 from being invisible to this API.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/src/service/client-patch.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/src/service/client-patch.ts \
        packages/protocol-admin/src/service/client-patch.test.ts
git commit -m "Allowlist the amendable client fields, with a reason for each refusal"
```

### Task 5.3: `PATCH` and `DELETE`, and rotating a secret

**Files:** `usecase/clients.ts`, `view/routes/clients.ts`, `tests/clients.int.test.ts`.

- [ ] **Step 1: Write the failing test**

Cover: a `PATCH` of `name` succeeds and bumps the `ETag`; a `PATCH` naming `client_id` is a 400 quoting `refusalFor`'s reason; `POST /secret` returns a new secret once and the old one stops authenticating at `/token`; `DELETE` removes the client and its config; `If-Match` mismatch is 412.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`amendClient` splits the supplied fields across the two tables in one transaction, replacing every list field wholesale — never appending — and running the amended value through `parseClientMetadata` before the write.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin
git commit -m "Amend, delete and re-secret a client through the admin API"
```

### Task 5.4: The two amendments that change authorization

Review Focus #5 lives here.

**Files:** `packages/protocol-admin/tests/client-amendment.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('an amendment that changes what a client may do', () => {
  it('narrowing grant_types stops the next /token call using the removed grant', async () => {
    const t = await fixture.createTenant('acme');
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials', 'refresh_token'],
    });
    const before = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(before.statusCode).toBe(200);

    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { grant_types: ['refresh_token'] },
    });
    expect(patched.statusCode).toBe(200);

    const after = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(after.statusCode).toBe(400);
    expect(after.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('refuses a redirect list registration would refuse, with the same detail', async () => {
    const t = await fixture.createTenant('acme');
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { redirect_uris: ['https://app.example/cb#fragment'] },
    });
    expect(res.statusCode).toBe(400);
    const registration = await fixture.registerClient(t.name, {
      redirect_uris: ['https://app.example/cb#fragment'],
    });
    expect((res.json() as { detail: string }).detail).toContain(
      (registration.json() as { error_description: string }).error_description,
    );
  });

  it('replaces a redirect list rather than appending to it', async () => {
    const t = await fixture.createTenant('acme');
    const client = await fixture.createConfidentialClient(t.name, {
      redirectUris: ['https://a.example/cb', 'https://b.example/cb'],
    });
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { redirect_uris: ['https://a.example/cb'] },
    });
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect((read.json() as { redirect_uris: string[] }).redirect_uris).toEqual([
      'https://a.example/cb',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/client-amendment.int.test.ts`
Expected: FAIL if Task 5.3 appended rather than replaced, or if validation was skipped on amendment.

- [ ] **Step 3: Write minimal implementation**

Whatever the previous task got wrong. The first case needs no new code — P4a's `grant_types` gate already refuses — and its value is proving the amendment reaches that gate rather than a cached copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/client-amendment.int.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/tests/client-amendment.int.test.ts
git commit -m "Pin the two client amendments that change authorization"
```

### Task 5.5: One `client.enabled` predicate, at five doors

**Files:**

- Create: `packages/protocol-oidc/src/service/client-enabled.ts`
- Create: `packages/protocol-oidc/src/service/client-enabled.test.ts`
- Modify: `packages/protocol-oidc/src/usecase/userinfo.ts`
- Modify: `packages/protocol-oidc/src/usecase/introspection.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-exchange-subject.ts`
- Modify: `docs/request-paths.md`, `docs/NEXT.md`

**Interfaces:**

- Produces: `clientIsLive(client: { enabled: boolean } | null): boolean` and the `LiveClientLookup` dependency each usecase takes.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-oidc/tests/disabled-client.int.test.ts
describe('a client disabled after a token was issued to it', () => {
  it('is refused at /userinfo', async () => {
    /* 200 before, 401 after */
  });
  it('is refused at /introspect', async () => {
    /* active:true before, active:false after */
  });
  it('cannot exchange its access token', async () => {
    /* 200 before, 400 after */
  });
  it('cannot exchange its refresh token', async () => {
    /* 200 before, 400 after */
  });
  it('cannot exchange its id_token, which names no grant', async () => {
    /* 200 before, 400 after */
  });
});
```

Each case disables the client through `PATCH /admin/tenants/{t}/clients/{id}` rather than by writing the column, so the test exercises the operation an operator performs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-oidc/tests/disabled-client.int.test.ts`
Expected: FAIL — all five still succeed after disabling.

- [ ] **Step 3: Write minimal implementation**

One predicate, five call sites wired to it. The predicate is what the unit test pins; each integration case proves its own site is wired. Five inline reads would pass the same tests and is how the blind spot arose in the first place.

The id_token branch is the one that cannot be covered by revoking grants — `resolveIdToken` returns `grantId: null` — so it is the case that justifies the whole approach and must not be dropped if the others prove easier.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-oidc`
Expected: PASS, and no existing test regressed.

- [ ] **Step 5: Re-run the affected transcripts, then commit**

Bring up the stack and **re-execute** `docs/request-paths.md`'s `/userinfo`, `/introspect` and token-exchange sections, pasting real output. Editing the expected bytes by hand downgrades the document to a claim. Remove the `client.enabled` entry from `docs/NEXT.md`'s "Decisions still open".

```bash
git add packages/protocol-oidc docs/request-paths.md docs/NEXT.md
git commit -m "Refuse a disabled client's live tokens at every endpoint"
```

### Task 5.6: The built-in admin client cannot be disabled

Review Focus #4 lives here.

**Files:** `usecase/clients.ts`, `tests/clients.int.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses to disable the built-in admin client', async () => {
  const t = await fixture.createTenant('acme');
  const token = await fixture.adminToken(t.name, ['manage-clients']);
  const admin = await fixture.builtinAdminClient(t.name);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${t.name}/clients/${admin.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { enabled: false },
  });
  expect(res.statusCode).toBe(409);
  expect((res.json() as { detail: string }).detail).toMatch(/built-in/iu);
});

it('refuses to delete it', async () => {
  /* 409 */
});

it('reads builtin_admin, not the client_id, so a rename does not evade it', async () => {
  // The guard must survive a client_id that no longer says "odudu-admin".
  const t = await fixture.createTenant('acme');
  const admin = await fixture.builtinAdminClient(t.name);
  await fixture.renameClientIdDirectly(t.id, admin.id, 'something-else');
  const token = await fixture.adminToken(t.name, ['manage-clients']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${t.name}/clients/${admin.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { enabled: false },
  });
  expect(res.statusCode).toBe(409);
});

it('allows disabling an ordinary admin-capable client, locking that caller out', async () => {
  // Legitimate: a provisioning application's client. The built-in client
  // above it is the recovery, which is why this one is permitted.
  const t = await fixture.createTenant('acme');
  const provisioner = await fixture.createServiceAccountClient(t.name, ['manage-users']);
  const token = await fixture.adminToken(t.name, ['manage-clients']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${t.name}/clients/${provisioner.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { enabled: false },
  });
  expect(res.statusCode).toBe(200);
  const after = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${t.name}/subjects`,
    headers: { authorization: `Bearer ${provisioner.token}` },
  });
  expect(after.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: FAIL — the first three return 200.

- [ ] **Step 3: Write minimal implementation**

The guard reads `builtinAdmin`, refuses `enabled: false` and `DELETE` with 409, and says which client it is protecting and why.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/clients.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin
git commit -m "Refuse to disable or delete a tenant's built-in admin client"
```

### Increment 5 close

- [ ] `pnpm verify` green; push `p4c/5-clients`; CI green; review answered; merge.

---

## Increment 6 — Subjects, credentials, required actions and role assignment

### Task 6.1: The foreign key that a subject delete would break

This is inert today and becomes reachable in Task 6.3. It goes first so the delete is never merged without it.

**Files:**

- Create: `packages/db/drizzle/0062_service_subject_fk.sql`
- Create: `packages/domain-tenant/tests/service-subject-delete.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('detaches a client when its service subject is deleted', async () => {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'service' });
    await tx.insert(clients).values({
      id: newId(),
      tenantId,
      clientId: 'svc',
      name: 'Service',
      type: 'confidential',
      serviceSubjectId: subject.id,
    });
    await tx.delete(subjects).where(eq(subjects.id, subject.id));
    const [row] = await tx.select().from(clients).where(eq(clients.clientId, 'svc'));
    expect(row?.serviceSubjectId).toBeNull();
    expect(row?.tenantId).toBe(tenantId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/domain-tenant/tests/service-subject-delete.int.test.ts`
Expected: FAIL — `null value in column "tenant_id" of relation "clients" violates not-null constraint`. The unrestricted composite `ON DELETE SET NULL` nulls `tenant_id` alongside `service_subject_id`.

- [ ] **Step 3: Write minimal implementation**

```sql
-- packages/db/drizzle/0062_service_subject_fk.sql

-- An unrestricted composite SET NULL nulls tenant_id alongside
-- service_subject_id, so deleting a service subject failed the clients row's
-- own NOT NULL rather than detaching it. The column list (PostgreSQL 15+)
-- nulls only the one column — the same form 0059's two foreign keys use.
ALTER TABLE clients DROP CONSTRAINT clients_service_subject_fk;
ALTER TABLE clients ADD CONSTRAINT clients_service_subject_fk
  FOREIGN KEY (tenant_id, service_subject_id) REFERENCES subjects (tenant_id, id)
  ON DELETE SET NULL (service_subject_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/domain-tenant/tests/service-subject-delete.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `docs/NEXT.md`, then commit**

Remove the `clients_service_subject_fk` entry from "Decisions still open"; leave `token_grants_session_fk`'s, which this phase does not fire.

```bash
git add packages/db/drizzle/0062_service_subject_fk.sql \
        packages/domain-tenant/tests/service-subject-delete.int.test.ts docs/NEXT.md
git commit -m "Detach a client instead of failing when its service subject goes"
```

### Task 6.2: `/subjects` — list, read, create

**Files:** the resource pattern, for `subjects`.

**Capability:** `view-users` to read, `manage-users` to write.

- [ ] **Step 1: Write the failing test**

Cover: a created user appears in the listing with `username` and `email`; `?search=` filters by username prefix; the list pages by cursor; `view-users` may read and may not create; `manage-users` may do both without `view-users` beside it (the composite from Task 1.1); a subject of type `service` is listed and distinguishable by `type`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/subjects.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`createSubject` reuses `app.ts`'s composition of subject, user and default roles — extracted into `packages/protocol-admin/src/usecase/subjects.ts` so registration and administration share one path rather than drifting. A created subject gets the tenant's `default_for_new_subjects` roles exactly as self-registration does.

**No password field exists on this endpoint.** Creating a subject writes an `update-password` required action, and the operator conveys a channel to set it. Assert that in a test: a `POST` carrying a `password` property is a 400, because Zod emits `additionalProperties: false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/subjects.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/subjects.ts
git commit -m "List, read and create subjects through the admin API"
```

### Task 6.3: `PATCH`, `DELETE`, credentials, required actions and roles

**Files:** `usecase/subjects.ts`, `view/routes/subjects.ts`, `tests/subjects.int.test.ts`.

- [ ] **Step 1: Write the failing test**

Cover: `PATCH` amends `email` and `enabled`; `DELETE` removes the subject and, per Task 6.1, detaches a client that named it; `GET /credentials` returns type, `created_at`, `expired` and a recovery-code **count**, and contains neither `secret_data` nor any hash — assert on the serialised body, not on a mapped object, so a leak through an unmapped field is caught; `DELETE /credentials/{id}` removes a TOTP enrolment and the subject can then log in without it; `PUT /required-actions` sets the list; `PUT /roles` replaces a subject's role assignments and a removed role stops appearing in `effectiveRoles`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/subjects.int.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

As described. The credentials read builds its response from an explicit field list rather than from the row, so a column added later is absent by default rather than exposed by default.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/subjects.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin
git commit -m "Amend, delete and re-credential a subject through the admin API"
```

### Increment 6 close

- [ ] `pnpm verify` green; push `p4c/6-subjects`; CI green; review answered; merge.

---

## Increment 7 — A subject's sessions

### Task 7.1: `liveBySubject`, and the orphans it sees

**Files:**

- Modify: `packages/authn-flows/src/repository/sessions.ts`
- Modify: `packages/authn-flows/tests/sessions.int.test.ts`

**Interfaces:**

- Produces: `liveBySubject(subjectId: string, lifespans: SessionLifespans, now: Date): Promise<SessionRecord[]>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('liveBySubject', () => {
  it('returns a session the browser cookie no longer names', async () => {
    // ADR 0033's orphan: two concurrent logins in one browser can leave a
    // session the cookie does not list, and this is the only read that finds
    // it. A remembered orphan idles for remember_me_idle_seconds.
    const { subjectId, orphanId } = await seedOrphanedSession();
    const live = await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).liveBySubject(subjectId, GENEROUS_LIFESPANS, clock.now()),
    );
    expect(live.map((s) => s.id)).toContain(orphanId);
  });

  it('measures each session against its own lifespan pair', async () => {
    // A remembered session and an ordinary one, with the ordinary one idled
    // past sso_session_idle_seconds but inside remember_me_idle_seconds.
    const { rememberedId, ordinaryId } = await seedMixedSessions();
    const live = await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).liveBySubject(subjectId, MIXED_LIFESPANS, laterClock.now()),
    );
    expect(live.map((s) => s.id)).toEqual([rememberedId]);
    expect(live.map((s) => s.id)).not.toContain(ordinaryId);
  });

  it('returns nothing for a subject in another tenant', async () => {
    const live = await withTenant(app.db, otherTenantId, (tx) =>
      sessionRepository(tx).liveBySubject(subjectId, GENEROUS_LIFESPANS, clock.now()),
    );
    expect(live).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/authn-flows/tests/sessions.int.test.ts`
Expected: FAIL — `liveBySubject` is not a function.

- [ ] **Step 3: Write minimal implementation**

The same liveness arithmetic `liveByIds` performs, keyed on `subject_id` instead of an id list. Extract the predicate both use rather than writing it twice.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/authn-flows/tests/sessions.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/authn-flows
git commit -m "Read a subject's live sessions by subject rather than by cookie"
```

### Task 7.2: The routes, and ending one session

**Files:** the resource pattern, for `sessions`. **Capability:** `manage-sessions`.

- [ ] **Step 1: Write the failing test**

Cover: the list shows `id`, `created_at`, `last_active_at`, `remembered` and the client ids the session has grants for; ending a session revokes its grants and enqueues a back-channel Logout Token for each registered client; a second `DELETE` of the same session is idempotent and answers 204; the response states that no front-channel frames are delivered, since there is no browser; a caller with `view-users` alone is refused.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/sessions.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`endSession` reuses P3b's machinery unchanged — the same call the logout usecase makes — so there is one path that ends a session rather than two.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/sessions.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/sessions.ts
git commit -m "List a subject's sessions and end one through the admin API"
```

### Task 7.3: The UUID rider

**Files:**

- Modify: `packages/authn-flows/src/service/session-cookie.ts` (or wherever the hand-rolled pattern lives)
- Modify: its test beside it

- [ ] **Step 1: Write the failing test**

```ts
it('accepts an uppercase UUID, the way the rest of the codebase does', () => {
  // Inert today — newId() emits lowercase — and ironic in the module whose
  // purpose is to be one authority for what a session cookie holds.
  expect(parseSessionCookie('B8B2E0A6-6C1B-7C7E-9F9F-2C1E0A6B8B2E')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/authn-flows/src/service/session-cookie.test.ts`
Expected: FAIL — the hand-rolled pattern is case-sensitive.

- [ ] **Step 3: Write minimal implementation**

Replace the local regex with `isUuid` from `@odudu/kernel`, which the test beside it already used.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/authn-flows`
Expected: PASS.

- [ ] **Step 5: Update `docs/NEXT.md`, then commit**

```bash
git add packages/authn-flows docs/NEXT.md
git commit -m "Use the kernel's isUuid in the session cookie parser"
```

### Increment 7 close

- [ ] `pnpm verify` green; push `p4c/7-sessions`; CI green; review answered; merge.

---

## Increment 8 — Roles, groups and client scopes

Three resource groups, one pattern, one increment: each is a small CRUD over a table that already exists with a repository that already works, and none has a decision in it that the earlier increments have not already settled.

### Task 8.1: `/roles` and `/groups`

**Files:** the resource pattern, for `roles` and for `groups`. **Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

Cover, for roles: create, list with cursor, read with `ETag`, amend `description`, delete; `POST /roles/{id}/composites` adds a child and the cycle refusal (`role_composite_cycle`) reaches the caller as a 409; a client-scoped role is created against a `client_id` and its qualified name is what appears in a token. For groups: the same, plus reparenting and its own cycle refusal, and `PUT /groups/{id}/roles`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/roles.int.test.ts packages/protocol-admin/tests/groups.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

Thin usecases over `roleRepository` and `groupRepository`. Every domain refusal those repositories already raise is mapped to a problem document rather than re-derived — the cycle checks in particular stay in the domain, where they are already tested.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/roles.int.test.ts packages/protocol-admin/tests/groups.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/roles.ts packages/contracts/admin/groups.ts
git commit -m "Manage roles and groups through the admin API"
```

### Task 8.2: `/scopes`

**Files:** the resource pattern, for `scopes`. **Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

Cover: create a client scope with `include_in_id_token` and `include_in_access_token`; assign it to a client as `default` or `optional` and see the assignment in the client read; `PUT /scopes/{id}/roles` maps roles to the scope; deleting an assigned scope is refused or cascades — assert whichever the existing foreign key does, and if it is neither, say so in the test's name.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/scopes.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

Thin usecases over `clientScopeRepository`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/scopes.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/scopes.ts
git commit -m "Manage client scopes through the admin API"
```

### Increment 8 close

- [ ] `pnpm verify` green; push `p4c/8-roles-groups-scopes`; CI green; review answered; merge.

---

## Increment 9 — Signing-key rotation

Run **Spike C** before Task 9.1: enumerate every caller of `signingKeyRepository.active()` and confirm none other than the default selection assumes there is exactly one usable key.

### Task 9.1: Signing selects by algorithm, falling back to active

**Files:**

- Modify: `packages/crypto/src/repository/signing-keys.ts`
- Modify: `packages/crypto/tests/signing-keys.int.test.ts`

**Interfaces:**

- Produces: `forAlg(alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord | null>` and `algorithmsAvailable(): Promise<readonly string[]>` — the algorithms of every non-retired key.

- [ ] **Step 1: Write the failing test**

```ts
describe('selecting a signing key', () => {
  it('prefers a non-retired key matching the algorithm asked for', async () => {
    await seedKey({ alg: 'RS256', status: 'active' });
    const rotating = await seedKey({ alg: 'ES256', status: 'rotating' });
    const chosen = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).forAlg('ES256'),
    );
    expect(chosen?.id).toBe(rotating.id);
  });

  it('never selects a retired key', async () => {
    await seedKey({ alg: 'ES256', status: 'retired' });
    const chosen = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).forAlg('ES256'),
    );
    expect(chosen).toBeNull();
  });

  it('reports every non-retired algorithm, so discovery can advertise them', async () => {
    await seedKey({ alg: 'RS256', status: 'active' });
    await seedKey({ alg: 'ES256', status: 'rotating' });
    await seedKey({ alg: 'ES256', status: 'retired' });
    const algs = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).algorithmsAvailable(),
    );
    expect([...algs].sort()).toEqual(['ES256', 'RS256']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/crypto/tests/signing-keys.int.test.ts`
Expected: FAIL — `forAlg` is not a function.

- [ ] **Step 3: Write minimal implementation**

`forAlg` selects `status != 'retired' AND alg = $1`, preferring `active` over `rotating` when both match, so the default does not move when a same-algorithm key is staged. `active()` stays, and stays the fallback. Update `resolveDiscoveryDocument` to advertise `algorithmsAvailable()` rather than `[key.alg, 'none']`, and `parseClientMetadata`'s algorithm check to accept any of them.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/crypto packages/protocol-oidc`
Expected: PASS, with no existing discovery test regressed.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto packages/protocol-oidc
git commit -m "Select a signing key by algorithm, defaulting to the active one"
```

### Task 9.2: Create, promote, retire

**Files:** the resource pattern, for `keys`. **Capability:** `manage-keys`.

- [ ] **Step 1: Write the failing test**

```ts
describe('key rotation', () => {
  it('stages a new key as rotating and publishes it in JWKS immediately', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: { alg: 'RS256' },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { status: string }).status).toBe('rotating');
    const jwks = await fixture.http.inject({
      method: 'GET',
      url: `/tenants/${t.name}/protocol/openid-connect/certs`,
    });
    expect((jwks.json() as { keys: { kid: string }[] }).keys).toHaveLength(2);
  });

  it('promotes atomically, leaving exactly one active key', async () => {
    const { tenant, staged, token } = await stageSecondKey();
    await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/keys/${staged.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
    });
    await withTenant(fixture.app.db, tenant.id, async (tx) => {
      const rows = await tx.select().from(signingKeys);
      expect(rows.filter((k) => k.status === 'active').map((k) => k.id)).toEqual([staged.id]);
    });
  });

  it('never returns the private half, encrypted or otherwise', async () => {
    const { tenant, token } = await stageSecondKey();
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${tenant.name}/keys`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.payload).not.toContain('privateJwk');
    expect(res.payload).not.toContain('private_jwk_encrypted');
  });

  it('refuses to retire a key whose algorithm a client still needs', async () => {
    const { tenant, old, token } = await promoteToDifferentAlgorithm();
    await fixture.registerClientWithUserinfoAlg(tenant.name, old.alg);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/keys/${old.id}/retire`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toContain('userinfo_signed_response_alg');
  });

  it('retires once the last client on that algorithm has moved', async () => {
    const { tenant, old, client, token } = await promoteToDifferentAlgorithm();
    await fixture.patchClient(tenant.name, client.id, { userinfo_signed_response_alg: 'ES256' });
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/keys/${old.id}/retire`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/keys.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`promote` runs both status changes in one transaction so no window has two actives or none — assert that by attempting a concurrent promote and expecting one of the two to fail on `signing_keys_one_active`. `retire` computes, for every client in the tenant, the algorithms it is registered against, and refuses while any of them would be left unproducible.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/keys.int.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/keys.ts
git commit -m "Stage, promote and retire a tenant's signing keys"
```

### Task 9.3: The overlap window, on a clock

**Files:** `packages/crypto/tests/rotation-overlap.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps publishing a rotating key past not_after until retirement is explicit', async () => {
  // Retiring early breaks every relying party holding an unexpired token
  // signed by that key, so the window ends when an operator says so, never
  // when a timestamp passes.
  const key = await seedKey({ alg: 'RS256', status: 'rotating', notAfter: clock.now() });
  clock.advance(365 * 24 * 3600 * 1000);
  const published = await withTenant(app.db, tenantId, (tx) =>
    signingKeyRepository(tx).publishable(),
  );
  expect(published.map((k) => k.id)).toContain(key.id);
});

it('stops publishing it once retired', async () => {
  const key = await seedKey({ alg: 'RS256', status: 'rotating' });
  await withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).retire(key.id));
  const published = await withTenant(app.db, tenantId, (tx) =>
    signingKeyRepository(tx).publishable(),
  );
  expect(published.map((k) => k.id)).not.toContain(key.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/crypto/tests/rotation-overlap.int.test.ts`
Expected: FAIL if anything filters on `not_after`.

- [ ] **Step 3: Write minimal implementation**

Whatever the previous tasks got wrong. `not_after` is documentation of intent, not a filter.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/crypto`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/tests/rotation-overlap.int.test.ts
git commit -m "Pin the overlap window against an advancing clock"
```

### Increment 9 close

- [ ] `pnpm verify` green; push `p4c/9-key-rotation`; CI green; review answered; merge.

---

## Increment 10 — The authentication flow

### Task 10.1: `required` and `conditional` made to differ

**Files:**

- Modify: `packages/authn-flows/src/service/requirements.ts`
- Modify: `packages/authn-flows/src/service/requirements.test.ts`
- Create: `packages/db/drizzle/0063_default_flow_conditional.sql`
- Create: `packages/authn-flows/tests/flow-unchanged.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/authn-flows/src/service/requirements.test.ts
describe('required versus conditional', () => {
  it('passes a conditional step the subject cannot satisfy', () => {
    const steps = [
      { authenticator: 'otp', requirement: 'conditional', applicable: false },
    ] as const;
    expect(nextStep([...steps], { satisfied: new Set() })).toEqual({ kind: 'complete' });
  });

  it('fails a required step the subject cannot satisfy', () => {
    const steps = [{ authenticator: 'otp', requirement: 'required', applicable: false }] as const;
    expect(nextStep([...steps], { satisfied: new Set() })).toEqual({ kind: 'fail' });
  });

  it('runs a required step the subject can satisfy', () => {
    const steps = [{ authenticator: 'otp', requirement: 'required', applicable: true }] as const;
    expect(nextStep([...steps], { satisfied: new Set() })).toEqual({
      kind: 'run',
      authenticator: 'otp',
    });
  });

  it('still treats a disabled step as absent', () => {
    const steps = [
      { authenticator: 'passkey', requirement: 'disabled', applicable: false },
      { authenticator: 'password', requirement: 'required', applicable: true },
    ] as const;
    expect(nextStep([...steps], { satisfied: new Set() })).toEqual({
      kind: 'run',
      authenticator: 'password',
    });
  });
});
```

and the migration's own guard:

```ts
// packages/authn-flows/tests/flow-unchanged.int.test.ts
it('leaves a default tenant login behaving exactly as before', async () => {
  // The split is a behaviour change on a login path. The seeded flow is
  // rewritten to conditional wherever it relied on the inapplicable-pass, so
  // a tenant that never touched its flow sees nothing.
  const t = await provisionDefaultTenant();
  for (const subject of [withPasswordOnly, withPasswordAndOtp, withPasskeyOnly]) {
    expect(await walkFlow(t, subject)).toEqual(EXPECTED_BEFORE_SPLIT[subject.name]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/authn-flows/src/service/requirements.test.ts`
Expected: FAIL on the second case — `required` currently passes when inapplicable, because `groupSteps` sends it to the `single` branch alongside `conditional`.

- [ ] **Step 3: Write minimal implementation**

`groupSteps` gains a third group kind, or `isGroupSatisfied` distinguishes the two requirements within `single`; either is fine, and the unit tests above pin the behaviour rather than the shape. The migration rewrites the seeded browser flow's rows from `required` to `conditional` wherever the step's applicability is subject-dependent — OTP, passkey and recovery code — leaving `password` as it is.

`EXPECTED_BEFORE_SPLIT` is captured by running `walkFlow` on the current build **before** the change and pasting the result, so the test compares against observed behaviour rather than against what the behaviour was believed to be.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/authn-flows`
Expected: PASS, and no existing login test regressed.

- [ ] **Step 5: Commit**

```bash
git add packages/authn-flows packages/db/drizzle/0063_default_flow_conditional.sql
git commit -m "Make required and conditional differ without moving any tenant"
```

### Task 10.2: The duplicated liveness predicate

**Files:** `packages/authn-flows/src/usecase/executor.ts` and its test.

- [ ] **Step 1: Write the failing test**

```ts
it('applies one liveness rule to both the pending and the authenticated session', () => {
  // The two conditions were inline and not identical, so they had to be kept
  // in sync by hand whenever liveness semantics changed.
  for (const session of [expiredPending, expiredAuthenticated]) {
    expect(sessionIsLive(session, clock.now())).toBe(false);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/authn-flows/src/usecase/executor.test.ts`
Expected: FAIL — `sessionIsLive` is not exported.

- [ ] **Step 3: Write minimal implementation**

Extract the predicate; call it from both `pendingSession` and `authenticatedSession`. Where the two were genuinely not identical, the difference becomes a parameter rather than a second copy, and the test names it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/authn-flows`
Expected: PASS.

- [ ] **Step 5: Update `docs/NEXT.md`, then commit**

```bash
git add packages/authn-flows docs/NEXT.md
git commit -m "Share one liveness predicate between the executor's two sessions"
```

### Task 10.3: `GET` and `PUT /flow/executions`

**Files:** the resource pattern, for `flow`. **Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

Cover: the read returns the ordered list with `index`, `authenticator` and `requirement`; a `PUT` replaces it and renumbers indices contiguously regardless of what the caller sent; an unresolvable authenticator name is a 400 naming the registry's known names; an empty list is a 400, because a tenant with no flow cannot be logged into; a `PUT` that disables every step is likewise a 400; and after a `PUT` that reorders passkey before password, a login offers passkey first.

The last one is the test that matters: it proves the configuration reaches the executor rather than only the table.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/flow.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

`executionRepository` gains a `replaceForTenant(tenantId, steps)` that deletes and re-inserts in one transaction. Validation lives in a leaf service so it is unit-tested without a database.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/flow.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/authn-flows packages/contracts/admin/flow.ts
git commit -m "Configure a tenant's authentication flow through the admin API"
```

### Increment 10 close

- [ ] `pnpm verify` green; push `p4c/10-authentication-flow`; CI green; review answered; merge.

---

## Increment 11 — Claim mapper bindings

### Task 11.1: The binding table, and the fallback that moves nobody

**Files:**

- Create: `packages/db/drizzle/0064_client_scope_mappers.sql`
- Create: `packages/protocol-admin/src/repository/scope-mappers.ts`
- Modify: `packages/protocol-oidc/src/service/claims.ts`
- Modify: `packages/domain-tenant/src/schema/client-scopes.ts` (the comment)
- Create: `packages/protocol-oidc/tests/scope-mappers.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('per-tenant claim mapper bindings', () => {
  it('changes nothing for a tenant with no bindings', async () => {
    // The fallback is what keeps this from being a migration of every
    // existing tenant: with no rows, a mapper's own declared scopes apply.
    const t = await fixture.createTenant('acme');
    const claims = await issueIdTokenClaims(t, 'openid profile email');
    expect(Object.keys(claims).sort()).toEqual(BASELINE_CLAIMS.sort());
  });

  it('honours a binding that removes a mapper from a scope', async () => {
    const t = await fixture.createTenant('acme');
    await bindMappers(t, 'profile', ['sub']);
    const claims = await issueIdTokenClaims(t, 'openid profile');
    expect(claims).not.toHaveProperty('name');
  });

  it('derives claims_supported from the tenant's bindings', async () => {
    const t = await fixture.createTenant('acme');
    await bindMappers(t, 'profile', ['sub']);
    const discovery = await fixture.http.inject({
      method: 'GET', url: `/tenants/${t.name}/.well-known/openid-configuration`,
    });
    expect((discovery.json() as { claims_supported: string[] }).claims_supported)
      .not.toContain('name');
  });

  it('keeps one tenant's bindings out of another's document', async () => {
    const narrowed = await fixture.createTenant('acme');
    const untouched = await fixture.createTenant('beta');
    await bindMappers(narrowed, 'profile', ['sub']);
    const discovery = await fixture.http.inject({
      method: 'GET', url: `/tenants/${untouched.name}/.well-known/openid-configuration`,
    });
    expect((discovery.json() as { claims_supported: string[] }).claims_supported)
      .toContain('name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-oidc/tests/scope-mappers.int.test.ts`
Expected: FAIL — no binding table, and `claims_supported` comes from the process singleton.

- [ ] **Step 3: Write minimal implementation**

`client_scope_mappers (tenant_id, client_scope_id, mapper_name)` with RLS and a primary key over all three. `assemble` reads the tenant's bindings once per issuance — alongside the roles and groups lookups it already does, never from inside a mapper, which is a leaf. With no rows for a scope, the mappers' declared scopes apply.

Amend `client-scopes.ts`'s comment in the same commit: the mapper still declares the scopes it reads, and a tenant may now override which of them a scope reaches. Leaving the comment as it stands would make its stated reason false, which is the defect this repository produces most often.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-oidc`
Expected: PASS, and no existing claims test regressed.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0064_client_scope_mappers.sql packages/protocol-oidc \
        packages/domain-tenant/src/schema/client-scopes.ts
git commit -m "Bind claim mappers to a scope per tenant, defaulting to today"
```

### Task 11.2: `GET` and `PUT /scopes/{id}/mappers`

**Files:** the resource pattern, for `scope-mappers`. **Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

Cover: the read lists the registry's available mapper names and which are bound; a `PUT` replaces the binding set; binding an unregistered mapper name is a 400 listing the known ones; a binding in one tenant is invisible in another.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/scope-mappers.int.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal implementation**

The available names come from the same `ClaimMapperRegistry` the issuance path uses, passed in as a dependency rather than re-instantiated, so the two cannot list different mappers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/scope-mappers.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin packages/contracts/admin/scope-mappers.ts
git commit -m "Manage a scope's claim mappers through the admin API"
```

### Increment 11 close

- [ ] `pnpm verify` green; push `p4c/11-claim-mappers`; CI green; review answered; merge.

---

## Increment 12 — Per-tenant SMTP

### Task 12.1: One key-encryption interface

**Files:**

- Modify: `packages/crypto/src/service/kek.ts`
- Modify: `packages/crypto/src/service/kek.test.ts`
- Modify: `packages/crypto/src/index.ts`

**Interfaces:**

- Produces: `wrapSecret(plaintext: string, kek: Uint8Array): string`, `unwrapSecret(wrapped: string, kek: Uint8Array): string`. `wrapPrivateJwk`/`unwrapPrivateJwk` become typed wrappers and keep their signatures.

- [ ] **Step 1: Write the failing test**

```ts
describe('wrapSecret', () => {
  it('round-trips an arbitrary string', () => {
    expect(unwrapSecret(wrapSecret('hunter2', KEK), KEK)).toBe('hunter2');
  });

  it('refuses a wrong key rather than returning rubbish', () => {
    const wrapped = wrapSecret('hunter2', KEK);
    expect(() => unwrapSecret(wrapped, OTHER_KEK)).toThrow();
  });

  it('is the same envelope a private JWK uses', () => {
    // "The same key-encryption interface as a signing key" has to mean one
    // implementation, or it is two implementations that agree for now.
    const jwk = { kty: 'oct', k: 'abc' };
    const viaJwk = wrapPrivateJwk(jwk, KEK);
    expect(JSON.parse(unwrapSecret(viaJwk, KEK))).toEqual(jwk);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/crypto/src/service/kek.test.ts`
Expected: FAIL — `wrapSecret` is not exported.

- [ ] **Step 3: Write minimal implementation**

Move the existing envelope into `wrapSecret`/`unwrapSecret` over a string; `wrapPrivateJwk` becomes `wrapSecret(JSON.stringify(jwk), kek)` and its inverse parses. No format change, so every stored key still unwraps — assert that with an existing fixture rather than assuming it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/crypto`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto
git commit -m "Generalise the key-encryption envelope beyond private JWKs"
```

### Task 12.2: The table, the resolution order, and the test send

**Files:**

- Create: `packages/db/drizzle/0065_tenant_smtp.sql`
- Create: `packages/protocol-admin/src/repository/tenant-smtp.ts`
- Modify: `apps/server/src/email.ts`
- The resource pattern, for `smtp`. **Capability:** `manage-tenant`.

- [ ] **Step 1: Write the failing test**

```ts
describe('per-tenant SMTP', () => {
  it('never returns the password, only whether one is set', async () => {
    const { tenant, token } = await configuredSmtp({ password: 'hunter2' });
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${tenant.name}/smtp`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.payload).not.toContain('hunter2');
    expect(res.json()).toMatchObject({ password_set: true });
  });

  it('stores the password encrypted, not in plaintext', async () => {
    const { tenant } = await configuredSmtp({ password: 'hunter2' });
    const [row] = await withTenant(fixture.app.db, tenant.id, (tx) => tx.select().from(tenantSmtp));
    expect(row?.passwordEncrypted).not.toContain('hunter2');
    expect(unwrapSecret(row!.passwordEncrypted, KEK)).toBe('hunter2');
  });

  it('prefers the tenant row over the environment sender', async () => {
    const { tenant } = await configuredSmtp({ host: 'tenant.smtp.example' });
    const sender = await resolveSender(tenant.id);
    expect(sender.host).toBe('tenant.smtp.example');
  });

  it('falls back to the environment sender, then to capturing', async () => {
    const bare = await fixture.createTenant('bare');
    expect((await resolveSender(bare.id)).kind).toBe('smtp');
    withoutEnvSmtp(() =>
      expect(resolveSender(bare.id)).resolves.toMatchObject({ kind: 'capturing' }),
    );
  });

  it('sends one message on POST /smtp/test and reports a failure as one', async () => {
    const { tenant, token } = await configuredSmtp({ host: 'unreachable.invalid' });
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/smtp/test`,
      headers: { authorization: `Bearer ${token}` },
      payload: { to: 'ops@example.test' },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { detail: string }).detail).toMatch(/unreachable\.invalid/u);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/smtp.int.test.ts`
Expected: FAIL — no table, no routes.

- [ ] **Step 3: Write minimal implementation**

`tenant_smtp (tenant_id PK, host, port, from_address, username, password_encrypted, starttls)` with RLS. The sender resolution moves into a function taking a tenant id: the row, else the `ODUDU_SMTP_*` sender, else capturing. ADR 0015 is unaffected — it governs where a deployment's own credentials live.

`POST /smtp/test` sends synchronously and reports the transport's failure, because its whole value is telling an operator now rather than when a user's verification mail silently fails.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/smtp.int.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0065_tenant_smtp.sql packages/protocol-admin \
        apps/server/src/email.ts packages/contracts/admin/smtp.ts
git commit -m "Configure a tenant's own SMTP, with its credential encrypted"
```

### Increment 12 close

- [ ] `pnpm verify` green; push `p4c/12-tenant-smtp`; CI green; review answered; merge.

---

## Increment 13 — Audit

The table is shaped for P4e from its first migration. Nothing here writes an authentication or token event; the columns that would carry one exist so that P4e adds rows rather than a schema.

### Task 13.1: The table

**Files:**

- Create: `packages/db/drizzle/0066_admin_audit.sql`
- Create: `packages/protocol-admin/src/schema/audit-events.ts`
- Create: `packages/protocol-admin/tests/audit-schema.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('audit_events', () => {
  it('isolates a tenant's events from another tenant', async () => {
    const a = await fixture.createTenant('alpha');
    const b = await fixture.createTenant('beta');
    await writeEvent(a.id, { action: 'client.create' });
    const seen = await withTenant(fixture.app.db, b.id, (tx) => tx.select().from(auditEvents));
    expect(seen).toHaveLength(0);
  });

  it('records the target tenant, not the actor's, as tenant_id', async () => {
    // A system admin changing tenant U writes a row U's own admins can read;
    // keying on the actor's tenant would hide it from exactly those people.
    const u = await fixture.createTenant('umbrella');
    await writeEventAsSystemAdmin(u.id, { action: 'tenant.settings.amend' });
    const seen = await withTenant(fixture.app.db, u.id, (tx) => tx.select().from(auditEvents));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.actorTenantId).not.toBe(u.id);
  });

  it('accepts a row with no actor, for the events P4e will add', async () => {
    const t = await fixture.createTenant('acme');
    await expect(writeEvent(t.id, { action: 'login.failure', actorSubjectId: null }))
      .resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/audit-schema.int.test.ts`
Expected: FAIL — the table does not exist.

- [ ] **Step 3: Write minimal implementation**

```sql
-- packages/db/drizzle/0066_admin_audit.sql

-- tenant_id is the tenant the event happened *to*. A system admin acting on
-- another tenant writes a row that tenant's own administrators can read;
-- keying on the actor's tenant would hide it from exactly those people.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  actor_tenant_id uuid,
  actor_subject_id uuid,
  actor_client_id uuid,
  resource_type text,
  resource_id text,
  request_id text,
  ip text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_outcome CHECK (outcome IN ('allowed', 'refused', 'failed'))
);

-- Nullable actor: an authentication event has no administrator behind it,
-- and those rows land in this table rather than in a second one.
CREATE INDEX audit_events_tenant_time ON audit_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_resource ON audit_events (tenant_id, resource_type, resource_id);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_isolation ON audit_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin/tests/audit-schema.int.test.ts packages/db/tests/schema-drift.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0066_admin_audit.sql packages/protocol-admin
git commit -m "Add the audit_events table, shaped for authentication events too"
```

### Task 13.2: Written in the mutating transaction, with a redacted diff

**Files:**

- Create: `packages/protocol-admin/src/service/audit-detail.ts`
- Create: `packages/protocol-admin/src/service/audit-detail.test.ts`
- Create: `packages/protocol-admin/src/repository/audit.ts`
- Modify: every `usecase/*.ts` from Increments 4 to 12
- Create: `packages/protocol-admin/tests/audit.int.test.ts`

**Interfaces:**

- Produces: `redactedDiff(resourceType: string, before: unknown, after: unknown): Record<string, unknown>` and `auditRepository(tx).record(event): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol-admin/src/service/audit-detail.test.ts
describe('redactedDiff', () => {
  it('records only the fields that changed', () => {
    expect(
      redactedDiff('client', { name: 'a', enabled: true }, { name: 'b', enabled: true }),
    ).toEqual({ name: { before: 'a', after: 'b' } });
  });

  it('never records a secret, a hash or a key, even if it changed', () => {
    const before = { name: 'a', secret_hash: 'x', password_encrypted: 'y', jwks: { k: 1 } };
    const after = { name: 'a', secret_hash: 'z', password_encrypted: 'w', jwks: { k: 2 } };
    const diff = redactedDiff('client', before, after);
    expect(JSON.stringify(diff)).not.toMatch(/[xyzw]/u);
    expect(diff).toEqual({
      secret_hash: { changed: true },
      password_encrypted: { changed: true },
      jwks: { changed: true },
    });
  });

  it('is allowlist-driven, so a field added later is absent rather than leaked', () => {
    expect(redactedDiff('client', { brand_new: 'a' }, { brand_new: 'b' })).toEqual({});
  });
});
```

and the transactional property:

```ts
// packages/protocol-admin/tests/audit.int.test.ts
it('writes exactly one row for a committed mutation', async () => {
  /* … */
});

it('writes no row when the mutation rolls back', async () => {
  // An audit log that can disagree with the database is worse than none.
  const t = await fixture.createTenant('acme');
  const token = await fixture.adminToken(t.name, ['manage-clients']);
  await fixture.failNextWriteAfterAudit();
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${t.name}/clients`,
    headers: { authorization: `Bearer ${token}` },
    payload: { client_id: 'doomed', name: 'D' },
  });
  expect(res.statusCode).toBe(500);
  const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
  expect(rows).toHaveLength(0);
});

it('records a refusal as well as a success', async () => {
  const t = await fixture.createTenant('acme');
  const token = await fixture.adminToken(t.name, ['view-audit']);
  await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${t.name}/clients`,
    headers: { authorization: `Bearer ${token}` },
    payload: { client_id: 'nope', name: 'N' },
  });
  const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ outcome: 'refused', action: 'client.create' });
});

it('records the cross-tenant refusal from Review Focus 1', async () => {
  /* … */
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin`
Expected: FAIL — `redactedDiff` is not defined and no usecase records anything.

- [ ] **Step 3: Write minimal implementation**

`redactedDiff` walks a per-resource-type allowlist; a field on the allowlist is diffed by value, a field on the **sensitive** list is diffed as `{ changed: true }`, and a field on neither is omitted. Omit-by-default is the whole point: a column added in a later phase is absent from the audit rather than printed into it.

Every usecase takes the `tx` it is already inside and records through it, so commit and audit are one atomic act. There is no `auditLater` and no queue.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin
git commit -m "Audit every admin mutation in the transaction that performs it"
```

### Task 13.3: Reading it, and reaping it

**Files:** the resource pattern, for `audit`; `apps/server/src/cli/reap.ts`; `packages/domain-tenant/src/service/tenant-settings.ts`.

**Capability:** `view-audit`.

- [ ] **Step 1: Write the failing test**

Cover: the list pages by cursor over `(occurred_at DESC, id DESC)` and its cursor is refused against another collection; filters on `actor_subject_id`, `resource_type`, `action`, `outcome` and a time range each narrow; a tenant-local admin sees a system admin's change to their tenant; `audit_retention_days` appears in `TENANT_SETTING_NAMES`; `odudu reap` deletes rows older than it, and `REAP_ORDER` covers `audit_events` — `validateReapOrder` throws unless it does, so the omission cannot ship.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/audit.int.test.ts apps/server/src/cli/reap.test.ts`
Expected: FAIL — `reap` refuses to run because `audit_events` has a retention rule and no place in `REAP_ORDER`.

- [ ] **Step 3: Write minimal implementation**

Add `audit_events` to `TableName`, `RETENTION_RULES` and `REAP_ORDER` — last, since nothing references it — and `audit_retention_days` to the settings map with a CHECK in the migration for its range. Bounding the table now is what keeps P4e from multiplying an unbounded one.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin apps/server`
Expected: PASS.

- [ ] **Step 5: Update `docs/request-paths.md`'s retention section, then commit**

Its retention transcript names every table `reap` removes, so re-run it rather than adding a row by hand.

```bash
git add packages/protocol-admin apps/server packages/domain-tenant docs/request-paths.md
git commit -m "Query the audit log and bound it with the retention pass"
```

### Increment 13 close

- [ ] `pnpm verify` green; push `p4c/13-audit`; CI green; review answered; merge.

---

## Increment 14 — The riders, the matrix and the ADR

### Task 14.1: `/introspect`'s two functions move to `service`

**Files:** `packages/protocol-oidc/src/usecase/introspection.ts` → `packages/protocol-oidc/src/service/introspection-audience.ts`, and their tests.

- [ ] **Step 1: Write the failing test**

Move the existing unit tests for `callerIsAddressed` and `audienceOf` to a new file importing from `#/service/introspection-audience`, unchanged in substance.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-oidc/src/service/introspection-audience.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Move both functions. They are pure domain decisions with no orchestration, which this package's convention puts in `service/`; the trigger recorded against them was "any task that next touches `introspection.ts`", and Increment 5 did.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-oidc && pnpm boundaries`
Expected: PASS — and `service-is-a-leaf` holds, since neither function imports anything.

- [ ] **Step 5: Update `docs/NEXT.md`, then commit**

```bash
git add packages/protocol-oidc docs/NEXT.md
git commit -m "Move introspection's audience decisions into the service layer"
```

### Task 14.2: The capability matrix, complete by construction

**Files:** `packages/protocol-admin/tests/capability-matrix.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('the capability matrix', () => {
  it.each(ADMIN_ROUTES)('$method $pattern admits only its own capability', async (route) => {
    const t = await fixture.createTenant(`m-${route.capability}`);
    for (const capability of TENANT_CAPABILITIES) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: route.method,
        url: route.pattern.replace(':tenant', t.name).replace(/:(\w+)/gu, 'placeholder'),
        headers: { authorization: `Bearer ${token}` },
      });
      const permitted =
        capability === route.capability || viewCounterpart(capability) === route.capability;
      expect(res.statusCode === 403, `${capability} at ${route.method} ${route.pattern}`).toBe(
        !permitted,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/protocol-admin/tests/capability-matrix.int.test.ts`
Expected: FAIL for any route wired to the wrong capability by copy-paste. If it passes first time, that is the earlier increments' per-task matrix rows having done their job, and the commit message says so.

- [ ] **Step 3: Fix whatever it names**

Correct the entry in `ADMIN_ROUTES`, not the test. The table is what the router registers from, so a correction reaches both.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/protocol-admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-admin/tests/capability-matrix.int.test.ts
git commit -m "Assert the whole capability matrix over every admin route"
```

### Task 14.3: The `/userinfo` claims-narrowing ADR

**Files:** `docs/adr/0036-userinfo-claims-narrowing.md`, `docs/NEXT.md`, `docs/superpowers/specs/2026-09-10-odudu-design.md`.

This task writes a document and changes no code. It is the one item on the spec's "does not do" list placed against an ADR rather than a phase, and P4c owns it because Increment 5 reopened `/userinfo`.

- [ ] **Step 1: State the question exactly**

OIDC Core §5.5 describes `claims` as requesting Claims _in addition to_ what `scope` grants. `/userinfo` intersects the requested set with granted scope and returns the intersection — a stricter reading, chosen in P3b and never written down. A `refresh_token` redemption mints from the rotated grant, which carries no `requested_userinfo_claims`, so the narrowing disappears on refresh.

- [ ] **Step 2: Gather what the ADR must cite**

Read `packages/protocol-oidc/src/service/claims-request.ts`, `usecase/userinfo.ts`'s narrowing, `repository/grants.ts` and `usecase/token-issuance.ts`'s `issueRefreshTokens`. Confirm by test, not by reading, that a refresh does widen: write a throwaway integration case, observe it, and delete it — the ADR asserts behaviour and must assert observed behaviour.

- [ ] **Step 3: Write the ADR**

Decide and record one of: narrowing is correct and the refresh gap is a defect, in which case the remedy is threading `requested_userinfo_claims` onto the rotated grant and it goes to **P4e**'s criterion; or narrowing is a misreading and it is removed, in which case the refresh gap disappears with it. Record the rejected alternative either way.

- [ ] **Step 4: Verify**

Run: `pnpm verify`
Expected: green — `tests/docs/references.test.ts` resolves the new ADR's citations.

- [ ] **Step 5: Update `docs/NEXT.md` and section 11, then commit**

Remove the open-decision entry; if the ADR keeps narrowing, add the follow-up to P4e's criterion in section 11.

```bash
git add docs/adr/0036-userinfo-claims-narrowing.md docs/NEXT.md \
        docs/superpowers/specs/2026-09-10-odudu-design.md
git commit -m "Decide whether /userinfo narrowing is the right reading of 5.5"
```

### Increment 14 close

- [ ] `pnpm verify` green; push `p4c/14-riders-and-matrix`; CI green; review answered; merge.

---

## Increment 15 — Documentation, the roadmap, and the pass that closes the phase

No new behaviour. This increment is where the documents are made true as a whole, which `CLAUDE.md` says is the only point at which anything reads them that way.

### Task 15.1: `docs/admin-paths.md`, executed end to end

**Files:** `docs/admin-paths.md`, `tests/docs/admin-paths.test.ts`

- [ ] **Step 1: Bring up a stack and capture the journeys**

Every command executed, every response real output. The journeys: bootstrap an admin and change the forced password; obtain an admin token; create a tenant; amend its settings; register, amend and disable a client; create a subject and give it a role; list and end a session; stage, promote and retire a signing key; reorder the authentication flow; bind a scope's mappers; configure and test SMTP; read the audit log; fetch the OpenAPI document.

Three rules, each learned from a way a transcript was false while looking fine:

- A fenced block holding a response **carries no language tag**. Prettier reformats a tagged one, so the bytes stop being the bytes served.
- A transcript whose output depends on what ran before it **says what that was, or scopes its query so it does not.** The audit-log listing is the sharp case here: it prints whatever the preceding sections left behind unless it is scoped or the stack is named.
- A precondition a refusal depends on is **shown, not asserted.** The 409 refusing to disable the built-in admin client and the 409 refusing to disable an ordinary one are told apart only by the client's `builtin_admin`, so display it beside them.

- [ ] **Step 2: Write the checks**

`tests/docs/admin-paths.test.ts` asserts, against a running server, that the document's endpoint list matches `ADMIN_ROUTES`, that every capability it names exists, and that every problem `type` it shows is one the code can emit. Pass the new path to `loadDocument`; the helpers below it already take a `Document`.

- [ ] **Step 3: Add the pointers**

The header of `admin-paths.md` states the three artifacts and their jobs — OpenAPI is the reference, this file is the narrative, `README.md` is the entry point — and says that the single "What is not implemented" list lives in `docs/request-paths.md`. Add the reciprocal pointer to `request-paths.md`'s "What to do next, from wherever you are".

- [ ] **Step 4: Verify**

Run: `pnpm verify`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add docs/admin-paths.md docs/request-paths.md tests/docs/admin-paths.test.ts
git commit -m "Add docs/admin-paths.md, every transcript executed"
```

### Task 15.2: `docs/request-paths.md` and `README.md` made true

- [ ] **Step 1: Rewrite every passage the admin API obsoletes**

Grep for `psql` and for "admin API" in `docs/request-paths.md`. Every site that reaches for SQL because no door existed — the five per-client columns, `token_exchange_impersonation_allowed`, and the aggregate under "Any admin API" — names the endpoint instead. The aggregate section is rewritten or removed; leaving it is how `README.md` came to claim no flag existed for `web_origins` long after `seed client --web-origin` shipped.

- [ ] **Step 2: Reconcile "What is not implemented" in both directions**

Every marker names a phase, a decision or an ADR — `tests/docs/not-implemented-placement.test.ts` checks presence, so read the section and ask whether each marker is still **true**. Then the other direction: every item the list sends to a phase appears in that phase's criterion in section 11. Section 11 already records five criteria that omitted work the list sent them, all found exactly this way.

- [ ] **Step 3: Grep the phase numbers this phase moved**

P4c split, so `P4c` and `P4e` citations both exist now. `tests/docs/phase-references.test.ts` reads `README.md` and `docs/request-paths.md`; it does **not** read `docs/NEXT.md`, `docs/adr/` or the archived specs. Grep those by hand:

```bash
grep -rn "\bP4\b\|\bP4c\b\|\bP4e\b" docs/NEXT.md docs/adr docs/superpowers/specs docs/protocols
```

- [ ] **Step 4: Read `docs/NEXT.md`'s headings against the phases that have closed**

A section addressed to a closed phase is overdue for a decision or a move, not another paragraph. P4c closes here; everything this phase answered comes out, and what it deferred is stated once, against P4e, P4d, P9 or P13.

Rewrite "Start here" for the new position: P4a and P4c complete, order **P4a → P4c → P4e → P4d → P4b**, and what P4e inherits — the `audit_events` table with `event_type` and a nullable actor, the retention rule already in `REAP_ORDER`, and the claims-narrowing follow-up if ADR 0036 kept narrowing.

- [ ] **Step 5: Verify and commit**

Run: `pnpm verify && pnpm trace`
Expected: green.

```bash
git add docs/request-paths.md README.md docs/NEXT.md
git commit -m "Make the documents true for what the admin API changed"
```

### Task 15.3: Section 11, and the phase note

- [ ] **Step 1: Rewrite the roadmap rows**

P4c's criterion becomes spec §23's. A **P4e** row is added — authentication and token audit events — with its own effort estimate and its criterion naming the follow-up from ADR 0036 if there is one. P13's criterion gains RFC 7592. P9's gains the per-audience scope model and `/introspect`'s entitlement check. The order is stated as **P4a → P4c → P4e → P4d → P4b**.

- [ ] **Step 2: Write `docs/phases/p4c.md`**

What turned out to be **wrong** while building it — not what was built, which the spec and this plan already record. Every spike whose assumption was false, every review finding that was right, every place the design met the code and lost.

- [ ] **Step 3: Verify**

Run: `pnpm verify`
Expected: green, including `tests/docs/phase-references.test.ts` against the new rows.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-10-odudu-design.md docs/phases/p4c.md docs/NEXT.md
git commit -m "Close P4c in the roadmap and record what it found"
```

### Increment 15 close and the phase close

- [ ] `pnpm verify` green; push `p4c/15-documentation`; CI green; review answered; merge.
- [ ] **Whole-branch review** of `p4c-admin-api` against the spec and for quality, with a fix loop until clean.
- [ ] Re-run the four-point pass above on the merged branch, because a whole-branch review changes documents too.
- [ ] `superpowers:finishing-a-development-branch`.
