import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAgentSettings } from '#/repository/agent-settings';
import { tenantSettingsRepository } from '#/repository/tenant-settings';

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

async function createTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name: `agents-${id.slice(-12)}` });
  });
  return id;
}

describe('readAgentSettings', () => {
  it('reads the defaults of a tenant that set nothing', async () => {
    const id = await createTenant();

    const settings = await withTenant(owner.db, id, (tx) => readAgentSettings(tx, id));

    expect(settings).toEqual({
      agentMaxDelegationDepth: 3,
      agentMaxChildren: 20,
      agentMaxLiveInstances: 1000,
      agentInstanceTtlSeconds: 900,
      agentInstanceIdleSeconds: 1800,
      agentApprovalTtlSeconds: 600,
      agentWritesPerGrant: 20,
      agentCreatesPerGrant: 10,
      agentWindowWrites: 200,
    });
  });

  it('reads what an administrator changed', async () => {
    const id = await createTenant();
    await withTenant(owner.db, id, (tx) =>
      tenantSettingsRepository(tx).amend(id, { agentMaxDelegationDepth: 5, agentWindowWrites: 7 }),
    );

    const settings = await withTenant(owner.db, id, (tx) => readAgentSettings(tx, id));

    expect(settings).toMatchObject({ agentMaxDelegationDepth: 5, agentWindowWrites: 7 });
  });

  it('refuses a tenant that does not exist', async () => {
    const id = newId();

    await expect(withTenant(owner.db, id, (tx) => readAgentSettings(tx, id))).rejects.toThrow(
      /not found/u,
    );
  });
});
