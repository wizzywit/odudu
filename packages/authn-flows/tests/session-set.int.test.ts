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
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';
import { sessions } from '#/schema/sessions';
import { isSessionLive } from '#/service/session-liveness';
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

  it('converges to exactly the cap across sequential logins, with no evicted id left behind', async () => {
    const realmId = newId();
    const cap = 2;
    const now = new Date();
    const clock = new FakeClock(now);

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return (await subjectRepository(tx).create({ realmId, type: 'user' })).id;
    });

    // What the browser's own cookie would hold after each login: the ids
    // admitSession reported as surviving, from its own answer, never a
    // fresh read — the cookie is exactly what the last response wrote.
    let browserSessionIds: readonly string[] = [];
    for (let i = 0; i < cap + 2; i++) {
      const admitted = await withRealm(app.db, realmId, (tx) =>
        admitSession(
          tx,
          {
            realmId,
            subjectId,
            authenticators: [],
            remembered: false,
            browserSessionIds,
            maxSessionsPerBrowser: cap,
            lifespans: REALM_LIFESPANS,
          },
          clock,
        ),
      );
      browserSessionIds = await withRealm(app.db, realmId, (tx) =>
        sessionRepository(tx).liveByIds(
          [...browserSessionIds, admitted.sessionId],
          REALM_LIFESPANS,
          now,
        ),
      ).then((rows) => rows.map((row) => row.id));
    }

    expect(browserSessionIds).toHaveLength(cap);
    await withRealm(app.db, realmId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(browserSessionIds, REALM_LIFESPANS, now);
      expect(live.map((s) => s.id).sort()).toEqual([...browserSessionIds].sort());
    });
  });

  // Reads every live session row in the realm — not the ids this test
  // already expects to see — so a broken eviction genuinely can push the
  // count past the bound below; a query restricted to a fixed set of
  // known ids can never exceed its own length regardless of what
  // admission does, which is a tautology, not a check.
  async function liveInRealm(realmId: string, now: Date): Promise<number> {
    return withRealm(app.db, realmId, async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.realmId, realmId));
      return rows.filter((row) => isSessionLive(row, IDLE_SECONDS, now)).length;
    });
  }

  // A fixed id list gathered before the realm-row lock — the browser's own
  // cookie, read once — can never contain a session a concurrent admission
  // inserts while it waits, however fresh the read against that list is
  // once unblocked. The lock still stops the two admissions interleaving
  // their evictions, but cannot make a list-based cap exact: `cap + 1` is
  // the measured, deterministic residual for two racers (ADR 0033's
  // amendment), repeated below rather than trusted from one run.
  it('bounds two concurrent logins at cap plus one, over several races', async () => {
    const cap = 3;
    const clock = new FakeClock(new Date());

    for (let trial = 0; trial < 5; trial++) {
      const realmId = newId();
      const now = clock.now();

      const { subjectId, seeded } = await withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        const ids: string[] = [];
        for (let i = 0; i < cap; i++) {
          ids.push(
            await createSession(tx, realmId, subject.id, new Date(now.getTime() + 3_600_000)),
          );
        }
        return { subjectId: subject.id, seeded: ids };
      });

      const admit = () =>
        withRealm(app.db, realmId, (tx) =>
          admitSession(
            tx,
            {
              realmId,
              subjectId,
              authenticators: [],
              remembered: false,
              browserSessionIds: seeded,
              maxSessionsPerBrowser: cap,
              lifespans: REALM_LIFESPANS,
            },
            clock,
          ),
        );
      // Warms the two pool connections this race will use: a cold
      // connection's setup latency alone is enough to let the first
      // admission finish before the second even starts, which would pass
      // regardless of the lock or the id list.
      await Promise.all([
        withRealm(app.db, realmId, (tx) =>
          sessionRepository(tx).liveByIds([], REALM_LIFESPANS, now),
        ),
        withRealm(app.db, realmId, (tx) =>
          sessionRepository(tx).liveByIds([], REALM_LIFESPANS, now),
        ),
      ]);
      await Promise.all([admit(), admit()]);

      const live = await liveInRealm(realmId, now);
      expect(live).toBeLessThanOrEqual(cap + 1);
    }
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
