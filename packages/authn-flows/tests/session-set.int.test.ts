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
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';
import { sessions } from '#/schema/sessions';
import { admitSession } from '#/usecase/session-admission';

const IDLE_SECONDS = 1800;
const REALM_LIFESPANS = {
  ssoSessionIdleSeconds: IDLE_SECONDS,
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
      const found = await sessionRepository(tx).liveByIds([liveId, deadId], REALM_LIFESPANS, now);
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
      const found = await sessionRepository(tx).liveByIds([liveId, newId()], REALM_LIFESPANS, now);
      expect(found.map((s) => s.id)).toEqual([liveId]);
    });
  });

  it('returns an empty list for no ids without touching the database', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      expect(await sessionRepository(tx).liveByIds([], REALM_LIFESPANS, new Date())).toEqual([]);
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
      expect(await sessionRepository(tx).liveByIds([liveId], REALM_LIFESPANS, now)).toEqual([]);
    });
  });

  it('cannot see a live session by subject across a foreign realm', async () => {
    const realmId = newId();
    const otherRealmId = newId();
    const now = new Date();
    const { subjectId } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000));
      return { subjectId: subject.id };
    });

    await withRealm(app.db, otherRealmId, async (tx) => {
      await seedRealm(tx, otherRealmId);
      expect(await sessionRepository(tx).liveBySubject(subjectId, REALM_LIFESPANS, now)).toEqual(
        [],
      );
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
      expect(await repo.liveByIds([liveId, deadId], REALM_LIFESPANS, now)).toEqual([]);
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
        expect(await sessionRepository(tx).liveByIds([id], REALM_LIFESPANS, now)).toHaveLength(1);
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
        expect(await sessionRepository(tx).liveByIds([id], REALM_LIFESPANS, now)).toHaveLength(1);
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

    const clock = new FakeClock(now);
    const admit = () =>
      withRealm(app.db, realmId, (tx) =>
        admitSession(
          tx,
          {
            realmId,
            subjectId,
            authenticators: [],
            remembered: false,
            maxSessionsPerBrowser: cap,
            lifespans: REALM_LIFESPANS,
          },
          clock,
        ),
      );
    // Warms the two pool connections this race will use: a cold connection's
    // setup latency alone is enough to let the first admission finish before
    // the second even starts, which would pass whether or not the lock
    // works. Two harmless throwaway reads exercise the pool first.
    await Promise.all([
      withRealm(app.db, realmId, (tx) => sessionRepository(tx).liveByIds([], REALM_LIFESPANS, now)),
      withRealm(app.db, realmId, (tx) => sessionRepository(tx).liveByIds([], REALM_LIFESPANS, now)),
    ]);
    const [first, second] = await Promise.all([admit(), admit()]);

    await withRealm(app.db, realmId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(
        [...seeded, first.sessionId, second.sessionId],
        REALM_LIFESPANS,
        now,
      );
      expect(live.length).toBeLessThanOrEqual(cap);
      expect(live.map((s) => s.id)).toEqual(
        expect.arrayContaining([first.sessionId, second.sessionId]),
      );
    });
  });

  it('measures a remembered session against the remembered idle window', async () => {
    const realmId = newId();
    const now = new Date();
    // Idle for two days: dead under sso_session_idle_seconds (1800s), live
    // under the remembered pair (604800s).
    const idledSince = new Date(now.getTime() - 2 * 24 * 3_600_000);

    const { rememberedId, ordinaryId } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      const far = new Date(now.getTime() + 30 * 24 * 3_600_000);
      const rememberedId = newId();
      await tx.insert(sessions).values({
        id: rememberedId,
        realmId,
        subjectId: subject.id,
        expiresAt: far,
        authenticators: [],
        remembered: true,
      });
      await sessionRepository(tx).touch(rememberedId, idledSince);
      const ordinaryId = await createSession(tx, realmId, subject.id, far);
      await sessionRepository(tx).touch(ordinaryId, idledSince);
      return { rememberedId, ordinaryId };
    });

    await withRealm(app.db, realmId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(
        [rememberedId, ordinaryId],
        REALM_LIFESPANS,
        now,
      );
      expect(live.map((s) => s.id)).toEqual([rememberedId]);
    });
  });
});
