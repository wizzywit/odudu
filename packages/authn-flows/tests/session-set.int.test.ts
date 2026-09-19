import { eq } from 'drizzle-orm';
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
import { sessions } from '#/schema/sessions';
import { chooseEvictions } from '#/service/session-set';
import { isSessionLive } from '#/service/session-liveness';

const IDLE_SECONDS = 1800;

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
  subjectId: string,
  expiresAt: Date,
): Promise<string> {
  const id = newId();
  await sessionRepository(tx).create({ id, realmId, subjectId, expiresAt, authenticators: [] });
  return id;
}

// Reads the live rows for one realm, evicts down to the cap via
// `chooseEvictions`, and inserts the new session, all inside the one
// transaction `withRealm` opened. Locks the realm's own row first: a
// `for update` lock on the session rows alone lets a blocked reader miss a
// row the other transaction inserted, since read-committed only re-checks
// the rows it already scanned. Test-only — a later task's usecase owns the
// realm's actual cap and lifespans.
async function admitSession(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  cap: number,
  now: Date,
): Promise<{ id: string }> {
  await tx.select().from(realms).where(eq(realms.id, realmId)).for('update');
  const rows = await tx.select().from(sessions).where(eq(sessions.realmId, realmId));
  const live = rows.filter((row) => isSessionLive(row, IDLE_SECONDS, now));

  const repo = sessionRepository(tx);
  await repo.endMany(chooseEvictions(live, cap), now);

  const id = newId();
  await repo.create({
    id,
    realmId,
    subjectId,
    expiresAt: new Date(now.getTime() + 3_600_000),
    authenticators: [],
  });
  return { id };
}

describe('the live session set', () => {
  it('returns only the live sessions among the ids given, in no required order', async () => {
    const realmId = newId();
    const now = new Date();
    const future = new Date(now.getTime() + 3_600_000);
    const past = new Date(now.getTime() - 3_600_000);

    const { liveId, deadId } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return {
        liveId: await createSession(tx, realmId, subject.id, future),
        deadId: await createSession(tx, realmId, subject.id, past),
      };
    });

    await withRealm(app.db, realmId, async (tx) => {
      const found = await sessionRepository(tx).liveByIds([liveId, deadId], IDLE_SECONDS, now);
      expect(found.map((s) => s.id)).toEqual([liveId]);
    });
  });

  it('ignores an id that names no row at all', async () => {
    const realmId = newId();
    const now = new Date();
    const liveId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withRealm(app.db, realmId, async (tx) => {
      const found = await sessionRepository(tx).liveByIds([liveId, newId()], IDLE_SECONDS, now);
      expect(found.map((s) => s.id)).toEqual([liveId]);
    });
  });

  it('returns an empty list for no ids without touching the database', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      expect(await sessionRepository(tx).liveByIds([], IDLE_SECONDS, new Date())).toEqual([]);
    });
  });

  it('cannot see a live session belonging to another realm', async () => {
    const realmId = newId();
    const otherRealmId = newId();
    const now = new Date();
    const liveId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withRealm(app.db, otherRealmId, async (tx) => {
      await seedRealm(tx, otherRealmId);
      expect(await sessionRepository(tx).liveByIds([liveId], IDLE_SECONDS, now)).toEqual([]);
    });
  });

  it('ends several sessions at once, and ending an already-dead one is a no-op', async () => {
    const realmId = newId();
    const now = new Date();
    const { liveId, deadId } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return {
        liveId: await createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000)),
        deadId: await createSession(tx, realmId, subject.id, new Date(now.getTime() - 3_600_000)),
      };
    });

    await withRealm(app.db, realmId, async (tx) => {
      const repo = sessionRepository(tx);
      await repo.endMany([liveId, deadId], now);
      expect(await repo.liveByIds([liveId, deadId], IDLE_SECONDS, now)).toEqual([]);
    });
  });

  it('cannot end a foreign realm’s session, and leaves it unaffected', async () => {
    const now = new Date();
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        return createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000));
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).liveByIds([id], IDLE_SECONDS, now)).toHaveLength(1);
      },
      attempt: async (tx, id) => {
        await sessionRepository(tx).endMany([id], now);
        return undefined;
      },
      expectBlocked: () => {
        // A cross-realm end matches zero rows under RLS rather than
        // erroring — the same answer every other write in this package
        // gives to a foreign id.
      },
      verifyRealmAUnaffected: async (tx, id) => {
        expect(await sessionRepository(tx).liveByIds([id], IDLE_SECONDS, now)).toHaveLength(1);
      },
    });
  });

  it('holds the cap when two logins arrive at once', async () => {
    const realmId = newId();
    const cap = 3;
    const now = new Date();

    const { subjectId, seeded } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      const ids: string[] = [];
      for (let i = 0; i < cap; i++) {
        ids.push(await createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000)));
      }
      return { subjectId: subject.id, seeded: ids };
    });

    const [first, second] = await Promise.all([
      withRealm(app.db, realmId, (tx) => admitSession(tx, realmId, subjectId, cap, now)),
      withRealm(app.db, realmId, (tx) => admitSession(tx, realmId, subjectId, cap, now)),
    ]);

    await withRealm(app.db, realmId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(
        [...seeded, first.id, second.id],
        IDLE_SECONDS,
        now,
      );
      expect(live.length).toBeLessThanOrEqual(cap);
      expect(live.map((s) => s.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    });
  });
});
