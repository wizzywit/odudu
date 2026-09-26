import { eq } from 'drizzle-orm';
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
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';
import { sessions } from '#/schema/sessions';
import { isSessionLive } from '#/service/session-liveness';
import { admitSession } from '#/usecase/session-admission';

const IDLE_SECONDS = 1800;
const TENANT_LIFESPANS = {
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function createSession(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
  expiresAt: Date,
): Promise<string> {
  const id = newId();
  await sessionRepository(tx).create({ id, tenantId, subjectId, expiresAt, authenticators: [] });
  return id;
}

describe('the live session set', () => {
  it('returns only the live sessions among the ids given, in no required order', async () => {
    const tenantId = newId();
    const now = new Date();
    const future = new Date(now.getTime() + 3_600_000);
    const past = new Date(now.getTime() - 3_600_000);

    const { liveId, deadId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return {
        liveId: await createSession(tx, tenantId, subject.id, future),
        deadId: await createSession(tx, tenantId, subject.id, past),
      };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const found = await sessionRepository(tx).liveByIds([liveId, deadId], TENANT_LIFESPANS, now);
      expect(found.map((s) => s.id)).toEqual([liveId]);
    });
  });

  it('ignores an id that names no row at all', async () => {
    const tenantId = newId();
    const now = new Date();
    const liveId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const found = await sessionRepository(tx).liveByIds([liveId, newId()], TENANT_LIFESPANS, now);
      expect(found.map((s) => s.id)).toEqual([liveId]);
    });
  });

  it('returns an empty list for no ids without touching the database', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      expect(await sessionRepository(tx).liveByIds([], TENANT_LIFESPANS, new Date())).toEqual([]);
    });
  });

  it('cannot see a live session belonging to another tenant', async () => {
    const tenantId = newId();
    const otherTenantId = newId();
    const now = new Date();
    const liveId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withTenant(app.db, otherTenantId, async (tx) => {
      await seedTenant(tx, otherTenantId);
      expect(await sessionRepository(tx).liveByIds([liveId], TENANT_LIFESPANS, now)).toEqual([]);
    });
  });

  it('ends several sessions at once, and ending an already-dead one is a no-op', async () => {
    const tenantId = newId();
    const now = new Date();
    const { liveId, deadId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return {
        liveId: await createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000)),
        deadId: await createSession(tx, tenantId, subject.id, new Date(now.getTime() - 3_600_000)),
      };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repo = sessionRepository(tx);
      await repo.endMany([liveId, deadId], now);
      expect(await repo.liveByIds([liveId, deadId], TENANT_LIFESPANS, now)).toEqual([]);
    });
  });

  it('reports from end whether the session was still unended', async () => {
    const tenantId = newId();
    const now = new Date();
    const { liveId, deadId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return {
        liveId: await createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000)),
        deadId: await createSession(tx, tenantId, subject.id, new Date(now.getTime() - 3_600_000)),
      };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repo = sessionRepository(tx);
      expect(await repo.end(liveId, now)).toBe(true);
      expect(await repo.end(liveId, new Date(now.getTime() + 60_000))).toBe(false);
      expect(await repo.end(deadId, now)).toBe(false);
      expect(await repo.end(newId(), now)).toBe(false);
    });
  });

  it('cannot end a foreign tenant’s session, and leaves it unaffected', async () => {
    const now = new Date();
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        return createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
      },
      verifySeeded: async (tx, id) => {
        expect(await sessionRepository(tx).liveByIds([id], TENANT_LIFESPANS, now)).toHaveLength(1);
      },
      attempt: async (tx, id) => {
        await sessionRepository(tx).endMany([id], now);
        return undefined;
      },
      expectBlocked: () => {
        // A cross-tenant end matches zero rows under RLS rather than
        // erroring — the same answer every other write in this package
        // gives to a foreign id.
      },
      verifyTenantAUnaffected: async (tx, id) => {
        expect(await sessionRepository(tx).liveByIds([id], TENANT_LIFESPANS, now)).toHaveLength(1);
      },
    });
  });

  it('converges to exactly the cap across sequential logins, with no evicted id left behind', async () => {
    const tenantId = newId();
    const cap = 2;
    const now = new Date();
    const clock = new FakeClock(now);

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
    });

    // What the browser's own cookie would hold after each login: the ids
    // admitSession reported as surviving, from its own answer, never a
    // fresh read — the cookie is exactly what the last response wrote.
    let browserSessionIds: readonly string[] = [];
    for (let i = 0; i < cap + 2; i++) {
      const admitted = await withTenant(app.db, tenantId, (tx) =>
        admitSession(
          tx,
          {
            tenantId,
            subjectId,
            authenticators: [],
            remembered: false,
            browserSessionIds,
            maxSessionsPerBrowser: cap,
            lifespans: TENANT_LIFESPANS,
          },
          clock,
        ),
      );
      browserSessionIds = await withTenant(app.db, tenantId, (tx) =>
        sessionRepository(tx).liveByIds(
          [...browserSessionIds, admitted.sessionId],
          TENANT_LIFESPANS,
          now,
        ),
      ).then((rows) => rows.map((row) => row.id));
    }

    expect(browserSessionIds).toHaveLength(cap);
    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(browserSessionIds, TENANT_LIFESPANS, now);
      expect(live.map((s) => s.id).sort()).toEqual([...browserSessionIds].sort());
    });
  });

  // Reads every live session row in the tenant — not the ids this test
  // already expects to see — so a broken eviction genuinely can push the
  // count past the bound below; a query restricted to a fixed set of
  // known ids can never exceed its own length regardless of what
  // admission does, which is a tautology, not a check.
  async function liveInTenant(tenantId: string, now: Date): Promise<number> {
    return withTenant(app.db, tenantId, async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.tenantId, tenantId));
      return rows.filter((row) => isSessionLive(row, IDLE_SECONDS, now)).length;
    });
  }

  // A fixed id list gathered before the tenant-row lock — the browser's own
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
      const tenantId = newId();
      const now = clock.now();

      const { subjectId, seeded } = await withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const ids: string[] = [];
        for (let i = 0; i < cap; i++) {
          ids.push(
            await createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000)),
          );
        }
        return { subjectId: subject.id, seeded: ids };
      });

      const admit = () =>
        withTenant(app.db, tenantId, (tx) =>
          admitSession(
            tx,
            {
              tenantId,
              subjectId,
              authenticators: [],
              remembered: false,
              browserSessionIds: seeded,
              maxSessionsPerBrowser: cap,
              lifespans: TENANT_LIFESPANS,
            },
            clock,
          ),
        );
      // Warms the two pool connections this race will use: a cold
      // connection's setup latency alone is enough to let the first
      // admission finish before the second even starts, which would pass
      // regardless of the lock or the id list.
      await Promise.all([
        withTenant(app.db, tenantId, (tx) =>
          sessionRepository(tx).liveByIds([], TENANT_LIFESPANS, now),
        ),
        withTenant(app.db, tenantId, (tx) =>
          sessionRepository(tx).liveByIds([], TENANT_LIFESPANS, now),
        ),
      ]);
      await Promise.all([admit(), admit()]);

      const live = await liveInTenant(tenantId, now);
      expect(live).toBeLessThanOrEqual(cap + 1);
    }
  });

  it('measures a remembered session against the remembered idle window', async () => {
    const tenantId = newId();
    const now = new Date();
    // Idle for two days: dead under sso_session_idle_seconds (1800s), live
    // under the remembered pair (604800s).
    const idledSince = new Date(now.getTime() - 2 * 24 * 3_600_000);

    const { rememberedId, ordinaryId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const far = new Date(now.getTime() + 30 * 24 * 3_600_000);
      const rememberedId = newId();
      await tx.insert(sessions).values({
        id: rememberedId,
        tenantId,
        subjectId: subject.id,
        expiresAt: far,
        authenticators: [],
        remembered: true,
      });
      await sessionRepository(tx).touch(rememberedId, idledSince);
      const ordinaryId = await createSession(tx, tenantId, subject.id, far);
      await sessionRepository(tx).touch(ordinaryId, idledSince);
      return { rememberedId, ordinaryId };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveByIds(
        [rememberedId, ordinaryId],
        TENANT_LIFESPANS,
        now,
      );
      expect(live.map((s) => s.id)).toEqual([rememberedId]);
    });
  });
});

describe('liveBySubject', () => {
  // The genuine orphan ADR 0033 describes: a session live in the database
  // but absent from the id list a browser's own cookie would present.
  // `liveByIds`, given only the cookie's list, cannot see it — `liveBySubject`
  // is the one reader that does not need the list to find it.
  it('sees a live session that a browser cookie omits, unlike liveByIds', async () => {
    const tenantId = newId();
    const now = new Date();
    const far = new Date(now.getTime() + 3_600_000);

    const { subjectId, cookieId, orphanId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const cookieId = await createSession(tx, tenantId, subject.id, far);
      const orphanId = await createSession(tx, tenantId, subject.id, far);
      return { subjectId: subject.id, cookieId, orphanId };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repo = sessionRepository(tx);
      const cookieView = await repo.liveByIds([cookieId], TENANT_LIFESPANS, now);
      expect(cookieView.map((s) => s.id)).toEqual([cookieId]);

      const subjectView = await repo.liveBySubject(subjectId, TENANT_LIFESPANS, now);
      expect(subjectView.map((s) => s.id).sort()).toEqual([cookieId, orphanId].sort());
    });
  });

  it('measures each session against its own lifespan pair', async () => {
    const tenantId = newId();
    const now = new Date();
    // Idle for two days: dead under sso_session_idle_seconds (1800s), live
    // under the remembered pair (604800s).
    const idledSince = new Date(now.getTime() - 2 * 24 * 3_600_000);
    const far = new Date(now.getTime() + 30 * 24 * 3_600_000);

    const { subjectId, rememberedId, ordinaryId } = await withTenant(
      app.db,
      tenantId,
      async (tx) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const rememberedId = newId();
        await tx.insert(sessions).values({
          id: rememberedId,
          tenantId,
          subjectId: subject.id,
          expiresAt: far,
          authenticators: [],
          remembered: true,
        });
        await sessionRepository(tx).touch(rememberedId, idledSince);
        const ordinaryId = await createSession(tx, tenantId, subject.id, far);
        await sessionRepository(tx).touch(ordinaryId, idledSince);
        return { subjectId: subject.id, rememberedId, ordinaryId };
      },
    );

    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveBySubject(subjectId, TENANT_LIFESPANS, now);
      expect(live.map((s) => s.id)).toEqual([rememberedId]);
      expect(live.map((s) => s.id)).not.toContain(ordinaryId);
    });
  });

  it('returns nothing for a subject in another tenant', async () => {
    const tenantId = newId();
    const otherTenantId = newId();
    const now = new Date();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
      return subject.id;
    });

    await withTenant(app.db, otherTenantId, async (tx) => {
      await seedTenant(tx, otherTenantId);
      const live = await sessionRepository(tx).liveBySubject(subjectId, TENANT_LIFESPANS, now);
      expect(live).toEqual([]);
    });
  });
});
