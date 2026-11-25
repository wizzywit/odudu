import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { readAgentSettings } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_DEFAULTS } from '#/service/defaults';

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

describe('AGENT_DEFAULTS', () => {
  it('are the values a tenant that set nothing reads back', async () => {
    const id = newId();
    const settings = await withTenant(owner.db, id, async (tx) => {
      await tx.insert(tenants).values({ id, name: `defaults-${id.slice(-12)}` });
      return readAgentSettings(tx, id);
    });

    expect(settings).toEqual({
      agentMaxDelegationDepth: AGENT_DEFAULTS.maxDepth,
      agentMaxChildren: AGENT_DEFAULTS.maxChildren,
      agentMaxLiveInstances: AGENT_DEFAULTS.maxLiveInstances,
      agentInstanceTtlSeconds: AGENT_DEFAULTS.instanceTtlSeconds,
      agentInstanceIdleSeconds: AGENT_DEFAULTS.idleTtlSeconds,
      agentApprovalTtlSeconds: AGENT_DEFAULTS.approvalTtlSeconds,
      agentWritesPerGrant: AGENT_DEFAULTS.writesPerGrant,
      agentCreatesPerGrant: AGENT_DEFAULTS.createsPerGrant,
      agentWindowWrites: AGENT_DEFAULTS.windowWrites,
    });
  });
});
