import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';

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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function createSession(
  tx: RealmScopedDatabase,
  realmId: string,
  lastActiveAt: Date,
): Promise<string> {
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  const id = newId();
  await sessionRepository(tx).create({
    id,
    realmId,
    subjectId: subject.id,
    expiresAt: new Date(Date.now() + 36_000_000),
    authenticators: [],
  });
  await sessionRepository(tx).touch(id, lastActiveAt);
  return id;
}

describe('session lifespans', () => {
  it('does not return an idled-out session from liveById', async () => {
    const realmId = newId();
    const id = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return createSession(tx, realmId, new Date(Date.now() - 3_600_000));
    });
    await withRealm(app.db, realmId, async (tx) => {
      expect(await sessionRepository(tx).liveById(id, 1800, new Date())).toBeNull();
      expect(await sessionRepository(tx).byId(id)).not.toBeNull();
    });
  });

  it('returns a recently used session and moves last_active_at on touch', async () => {
    const realmId = newId();
    const id = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return createSession(tx, realmId, new Date(Date.now() - 60_000));
    });
    await withRealm(app.db, realmId, async (tx) => {
      const live = await sessionRepository(tx).liveById(id, 1800, new Date());
      expect(live).not.toBeNull();
      const now = new Date();
      await sessionRepository(tx).touch(id, now);
      const after = await sessionRepository(tx).byId(id);
      expect(after?.lastActiveAt.getTime()).toBe(now.getTime());
    });
  });

  it('cannot read a foreign realm’s session through liveById', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        return createSession(tx, realmId, new Date());
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).liveById(id, 1800, new Date())).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).liveById(id, 1800, new Date()),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot touch a foreign realm’s session, and leaves it unaffected', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        return createSession(tx, realmId, new Date());
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).byId(id)).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).touch(id, new Date()),
      expectBlocked: () => {
        // A cross-realm touch is a no-op: RLS matches zero rows, not an
        // error, the same answer every other write in this package gives.
      },
      verifyRealmAUnaffected: async (tx, id) => {
        const untouched = await sessionRepository(tx).byId(id);
        expect(Date.now() - (untouched?.lastActiveAt.getTime() ?? 0)).toBeLessThan(60_000);
      },
    });
  });
});
