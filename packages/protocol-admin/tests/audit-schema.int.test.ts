import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(name: string): Promise<string> {
  const id = newId();
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name });
  });
  return id;
}

function writeEvent(
  tenantId: string,
  overrides: Partial<{
    action: string;
    actorSubjectId: string | null;
    actorTenantId: string | null;
  }>,
): Promise<void> {
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(auditEvents).values({
      id: newId(),
      tenantId,
      eventType: 'admin_mutation',
      action: overrides.action ?? 'client.create',
      outcome: 'allowed',
      actorSubjectId: overrides.actorSubjectId === undefined ? newId() : overrides.actorSubjectId,
      actorTenantId: overrides.actorTenantId ?? null,
    });
  });
}

describe('audit_events', () => {
  it('isolates a tenant from another tenant', async () => {
    const a = await seedTenant(`alpha-${newId()}`);
    const b = await seedTenant(`beta-${newId()}`);
    await writeEvent(a, {});

    const seen = await withTenant(app.db, b, (tx) => tx.select().from(auditEvents));

    expect(seen).toHaveLength(0);
  });

  it('records the target tenant, not the actor own, as tenant_id', async () => {
    // A system admin changing tenant U writes a row U's own admins can
    // read; keying on the actor's tenant would hide it from exactly them.
    const u = await seedTenant(`umbrella-${newId()}`);
    const systemTenantId = newId();
    await writeEvent(u, { action: 'tenant.settings.amend', actorTenantId: systemTenantId });

    const seen = await withTenant(app.db, u, (tx) => tx.select().from(auditEvents));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.actorTenantId).not.toBe(u);
  });

  it('accepts a row with no actor, for the events P4e will add', async () => {
    const t = await seedTenant(`acme-${newId()}`);

    await expect(
      writeEvent(t, { action: 'login.failure', actorSubjectId: null }),
    ).resolves.not.toThrow();
  });
});
