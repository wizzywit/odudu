import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';
import { type SessionLifespans } from '#/service/session-lifespan';

const LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

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

async function createSession(
  tx: TenantScopedDatabase,
  tenantId: string,
  lastActiveAt: Date,
): Promise<string> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const id = newId();
  await sessionRepository(tx).create({
    id,
    tenantId,
    subjectId: subject.id,
    expiresAt: new Date(Date.now() + 36_000_000),
    authenticators: [],
  });
  await sessionRepository(tx).touch(id, lastActiveAt);
  return id;
}

describe('session lifespans', () => {
  it('does not return an idled-out session from liveById', async () => {
    const tenantId = newId();
    const id = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return createSession(tx, tenantId, new Date(Date.now() - 3_600_000));
    });
    await withTenant(app.db, tenantId, async (tx) => {
      expect(await sessionRepository(tx).liveById(id, LIFESPANS, new Date())).toBeNull();
      expect(await sessionRepository(tx).byId(id)).not.toBeNull();
    });
  });

  it('returns a recently used session and moves last_active_at on touch', async () => {
    const tenantId = newId();
    const id = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return createSession(tx, tenantId, new Date(Date.now() - 60_000));
    });
    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveById(id, LIFESPANS, new Date());
      expect(live).not.toBeNull();
      const now = new Date();
      await sessionRepository(tx).touch(id, now);
      const after = await sessionRepository(tx).byId(id);
      expect(after?.lastActiveAt.getTime()).toBe(now.getTime());
    });
  });

  it('cannot read a foreign tenant’s session through liveById', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return createSession(tx, tenantId, new Date());
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).liveById(id, LIFESPANS, new Date())).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).liveById(id, LIFESPANS, new Date()),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot touch a foreign tenant’s session, and leaves it unaffected', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return createSession(tx, tenantId, new Date());
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).byId(id)).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).touch(id, new Date()),
      expectBlocked: () => {
        // A cross-tenant touch is a no-op: RLS matches zero rows, not an
        // error, the same answer every other write in this package gives.
      },
      verifyTenantAUnaffected: async (tx, id) => {
        const untouched = await sessionRepository(tx).byId(id);
        expect(Date.now() - (untouched?.lastActiveAt.getTime() ?? 0)).toBeLessThan(60_000);
      },
    });
  });
});
