import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRepository } from '#/repository/audit';
import { type AuditEventInput } from '#/service/vocabulary';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

describe('record and list', () => {
  it('round-trips a token/token.issue row', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await auditRepository(tx).record({
        eventType: 'token',
        action: 'token.issue',
        outcome: 'allowed',
        detail: { grant_type: 'authorization_code', scope: 'openid' },
      });
    });

    const rows = await withTenant(app.db, tenantId, (tx) =>
      auditRepository(tx).list({ limit: 10 }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'token',
      action: 'token.issue',
      outcome: 'allowed',
      detail: { grant_type: 'authorization_code', scope: 'openid' },
    });
  });

  it('filters by eventType', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await auditRepository(tx).record({
        eventType: 'token',
        action: 'token.issue',
        outcome: 'allowed',
        detail: { grant_type: 'authorization_code', scope: 'openid' },
      });
    });

    const tokenRows = await withTenant(app.db, tenantId, (tx) =>
      auditRepository(tx).list({ eventType: 'token', limit: 10 }),
    );
    const sessionRows = await withTenant(app.db, tenantId, (tx) =>
      auditRepository(tx).list({ eventType: 'session', limit: 10 }),
    );

    expect(tokenRows).toHaveLength(1);
    expect(sessionRows).toHaveLength(0);
  });

  it('rejects a disallowed detail key and writes nothing', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));

    // A cast, not a plain literal: assertDetailAllowed is what has to catch
    // this, since the type-level union already refuses `client_secret` on
    // `token.issue` at compile time.
    const disallowed = {
      eventType: 'token',
      action: 'token.issue',
      outcome: 'allowed',
      detail: { grant_type: 'authorization_code', scope: 'openid', client_secret: 's' },
    } as unknown as AuditEventInput;

    await expect(
      withTenant(app.db, tenantId, (tx) => auditRepository(tx).record(disallowed)),
    ).rejects.toThrow(/client_secret/);

    const rows = await withTenant(app.db, tenantId, (tx) =>
      auditRepository(tx).list({ limit: 10 }),
    );
    expect(rows).toHaveLength(0);
  });

  it('does not let a foreign tenant read a row record wrote for another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await auditRepository(tx).record({
          eventType: 'token',
          action: 'token.issue',
          outcome: 'allowed',
          detail: { grant_type: 'authorization_code', scope: 'openid' },
        });
      },
      verifySeeded: async (tx) => {
        const rows = await auditRepository(tx).list({ limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.action).toBe('token.issue');
      },
      attempt: async (tx) => auditRepository(tx).list({ limit: 10 }),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});
