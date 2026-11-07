import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDLE_ACCOUNT_COUNT_CAP,
  IDLE_ACCOUNT_SAMPLE_LIMIT,
  idleServiceAccounts,
} from '#/repository/service-account-upgrade';
import { ensureServiceAccount, retireServiceAccount } from '#/usecase/service-account';

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
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function tenantWith(name: string, count: number, idle: number): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    for (let index = 0; index < count; index += 1) {
      const created = await clientRepository(tx).create({
        tenantId,
        clientId: `c-${String(index)}`,
        name: `c-${String(index)}`,
        type: 'confidential',
        secretHash: 'x',
      });
      await ensureServiceAccount(tx, created);
    }
  });
  await owner.sql`
    update clients set service_account_idle = true
     where id in (select id from clients where tenant_id = ${tenantId}
                   order by client_id limit ${idle})`;
  return tenantId;
}

describe('idleServiceAccounts', () => {
  it('lists the clients marked idle, across tenants, and no others', async () => {
    await tenantWith('idle-a', 3, 2);
    await tenantWith('idle-b', 1, 1);

    const found = await idleServiceAccounts(owner.db);

    expect(found.count).toBe(3);
    expect(found.sample.map((entry) => `${entry.tenant}/${entry.clientId}`).sort()).toEqual([
      'idle-a/c-0',
      'idle-a/c-1',
      'idle-b/c-0',
    ]);
  });

  it('stops listing a client once its account is retired', async () => {
    const tenantId = await tenantWith('idle-retire', 1, 1);
    await withTenant(app.db, tenantId, async (tx) => {
      const held = await clientRepository(tx).byClientId('c-0');
      if (held === null) throw new Error('fixture: client vanished');
      await retireServiceAccount(tx, held);
    });
    const found = await idleServiceAccounts(owner.db);
    expect(found.sample.map((entry) => `${entry.tenant}/${entry.clientId}`)).not.toContain(
      'idle-retire/c-0',
    );
  });

  it('names at most the sample limit and counts up to the cap', async () => {
    await tenantWith('idle-bulk', IDLE_ACCOUNT_SAMPLE_LIMIT + 5, IDLE_ACCOUNT_SAMPLE_LIMIT + 5);
    const found = await idleServiceAccounts(owner.db);
    expect(found.sample).toHaveLength(IDLE_ACCOUNT_SAMPLE_LIMIT);
    expect(found.count).toBeGreaterThanOrEqual(IDLE_ACCOUNT_SAMPLE_LIMIT + 5);
    expect(IDLE_ACCOUNT_COUNT_CAP).toBe(10_000);
  });
});

describe('the bound of the boot read', () => {
  it('is ended by the database when the read waits on a lock, freeing its connection', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = owner.sql.begin(async (tx) => {
      await tx`lock table clients in access exclusive mode`;
      await held;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const started = Date.now();
      await expect(idleServiceAccounts(app.db, 150)).rejects.toMatchObject({
        cause: { message: expect.stringContaining('statement timeout') as unknown },
      });
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      release();
      await locked;
    }
    const open = await owner.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database() and state like 'idle in transaction%'
         and usename <> current_user`;
    expect(open[0]?.n).toBe(0);
  });
});
