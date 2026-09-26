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
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { sessionRepository } from '#/repository/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { sessions } from '#/schema/sessions';
import { SessionEntry } from '#/service/session-entry';
import { isSessionLive } from '#/service/session-liveness';
import { admitSession } from '#/usecase/session-admission';

const IDLE_SECONDS = 1800;
const TENANT_LIFESPANS = {
  ssoSessionIdleSeconds: IDLE_SECONDS,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

const PENDING_REQUEST: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
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
  remembered = false,
): Promise<SessionEntry> {
  const entry = SessionEntry.issue(newId());
  await sessionRepository(tx).create({
    id: entry.id,
    tenantId,
    subjectId,
    expiresAt,
    authenticators: [],
    remembered,
    secretHash: entry.secretHash(),
  });
  return entry;
}

// The same session's id with a secret the server never issued for it.
function forged(entry: SessionEntry): SessionEntry {
  return SessionEntry.issue(entry.id);
}

describe('the live session set', () => {
  it('returns only the live sessions among the entries given, in no required order', async () => {
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
      const found = await sessionRepository(tx).liveByEntries(
        [liveId, deadId],
        TENANT_LIFESPANS,
        now,
      );
      expect(found.map((s) => s.id)).toEqual([liveId.id]);
      expect(found[0]?.entry).toBe(liveId);
    });
  });

  it('ignores an entry whose id names no row at all', async () => {
    const tenantId = newId();
    const now = new Date();
    const liveId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const found = await sessionRepository(tx).liveByEntries(
        [liveId, SessionEntry.issue(newId())],
        TENANT_LIFESPANS,
        now,
      );
      expect(found.map((s) => s.id)).toEqual([liveId.id]);
    });
  });

  it('treats a live session’s id with the wrong secret as absent', async () => {
    const tenantId = newId();
    const now = new Date();
    const live = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return createSession(tx, tenantId, subject.id, new Date(now.getTime() + 3_600_000));
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repo = sessionRepository(tx);
      expect(await repo.liveByEntries([forged(live)], TENANT_LIFESPANS, now)).toEqual([]);
      const both = await repo.liveByEntries([forged(live), live], TENANT_LIFESPANS, now);
      expect(both.map((s) => s.entry)).toEqual([live]);
    });
  });

  it('never treats a row with no secret hash as live, by entry, id or subject', async () => {
    const tenantId = newId();
    const now = new Date();
    const far = new Date(now.getTime() + 3_600_000);
    const { subjectId, entry } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const entry = await createSession(tx, tenantId, subject.id, far);
      await tx.update(sessions).set({ secretHash: null }).where(eq(sessions.id, entry.id));
      return { subjectId: subject.id, entry };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repo = sessionRepository(tx);
      expect(await repo.liveByEntries([entry], TENANT_LIFESPANS, now)).toEqual([]);
      expect(await repo.liveById(entry.id, TENANT_LIFESPANS, now)).toBeNull();
      expect(await repo.liveBySubject(subjectId, TENANT_LIFESPANS, now)).toEqual([]);
    });
  });

  it('returns an empty list for no entries without touching the database', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      expect(await sessionRepository(tx).liveByEntries([], TENANT_LIFESPANS, new Date())).toEqual(
        [],
      );
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
      expect(await sessionRepository(tx).liveByEntries([liveId], TENANT_LIFESPANS, now)).toEqual(
        [],
      );
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
      await repo.endMany([liveId.id, deadId.id], now);
      expect(await repo.liveByEntries([liveId, deadId], TENANT_LIFESPANS, now)).toEqual([]);
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
      expect(await repo.end(liveId.id, now)).toBe(true);
      expect(await repo.end(liveId.id, new Date(now.getTime() + 60_000))).toBe(false);
      expect(await repo.end(deadId.id, now)).toBe(false);
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
      verifySeeded: async (tx, entry) => {
        expect(
          await sessionRepository(tx).liveByEntries([entry], TENANT_LIFESPANS, now),
        ).toHaveLength(1);
      },
      attempt: async (tx, entry) => {
        await sessionRepository(tx).endMany([entry.id], now);
        return undefined;
      },
      expectBlocked: () => {
        // A cross-tenant end matches zero rows under RLS rather than
        // erroring — the same answer every other write in this package
        // gives to a foreign id.
      },
      verifyTenantAUnaffected: async (tx, entry) => {
        expect(
          await sessionRepository(tx).liveByEntries([entry], TENANT_LIFESPANS, now),
        ).toHaveLength(1);
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

    // What the browser's own cookie would hold after each login: the
    // entries it presented that are still live, plus the one just issued.
    let browserSessions: readonly SessionEntry[] = [];
    for (let i = 0; i < cap + 2; i++) {
      const admitted = await withTenant(app.db, tenantId, (tx) =>
        admitSession(
          tx,
          {
            tenantId,
            subjectId,
            authenticators: [],
            remembered: false,
            browserSessions,
            maxSessionsPerBrowser: cap,
            lifespans: TENANT_LIFESPANS,
          },
          clock,
        ),
      );
      browserSessions = await withTenant(app.db, tenantId, (tx) =>
        sessionRepository(tx).liveByEntries(
          [...browserSessions, admitted.entry],
          TENANT_LIFESPANS,
          now,
        ),
      ).then((rows) => rows.map((row) => row.entry));
    }

    expect(browserSessions).toHaveLength(cap);
    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveByEntries(
        browserSessions,
        TENANT_LIFESPANS,
        now,
      );
      expect(live.map((s) => s.id).sort()).toEqual(browserSessions.map((e) => e.id).sort());
    });
  });

  it('neither counts nor evicts a session presented with the wrong secret', async () => {
    const tenantId = newId();
    const now = new Date();
    const { subjectId, held, other } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const far = new Date(now.getTime() + 3_600_000);
      return {
        subjectId: subject.id,
        held: await createSession(tx, tenantId, subject.id, far),
        other: await createSession(tx, tenantId, subject.id, far),
      };
    });

    await withTenant(app.db, tenantId, (tx) =>
      admitSession(
        tx,
        {
          tenantId,
          subjectId,
          authenticators: [],
          remembered: false,
          browserSessions: [held, forged(other)],
          maxSessionsPerBrowser: 2,
          lifespans: TENANT_LIFESPANS,
        },
        new FakeClock(now),
      ),
    );

    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveByEntries([held, other], TENANT_LIFESPANS, now);
      expect(live.map((s) => s.id).sort()).toEqual([held.id, other.id].sort());
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
        const ids: SessionEntry[] = [];
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
              browserSessions: seeded,
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
          sessionRepository(tx).liveByEntries([], TENANT_LIFESPANS, now),
        ),
        withTenant(app.db, tenantId, (tx) =>
          sessionRepository(tx).liveByEntries([], TENANT_LIFESPANS, now),
        ),
      ]);
      await Promise.all([admit(), admit()]);

      const live = await liveInTenant(tenantId, now);
      expect(live).toBeLessThanOrEqual(cap + 1);
    }
  });

  // Two submissions of one login form: the loser has written a login-step
  // row (whose foreign key share-locks the tenant row) and is about to bind
  // the authentication session the winner has just consumed. The winner's
  // admission must not wait on that share lock, or each waits on the other.
  it('admits while another transaction holds a row referencing the tenant', async () => {
    const tenantId = newId();
    const authSessionId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await authenticationSessionRepository(tx).create({
        id: authSessionId,
        tenantId,
        pendingRequest: PENDING_REQUEST,
        expiresAt: new Date(Date.now() + 600_000),
      });
      return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
    });

    let markLoserWrote!: () => void;
    const loserWrote = new Promise<void>((resolve) => {
      markLoserWrote = resolve;
    });
    let markWinnerConsumed!: () => void;
    const winnerConsumed = new Promise<void>((resolve) => {
      markWinnerConsumed = resolve;
    });
    const loser = withTenant(app.db, tenantId, async (tx) => {
      await auditRepository(tx).record({
        eventType: 'authentication',
        action: 'login.password',
        outcome: 'allowed',
        actorSubjectId: subjectId,
        resourceType: 'authentication_session',
        resourceId: authSessionId,
        detail: { factor: 'password' },
      });
      markLoserWrote();
      await winnerConsumed;
      await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);
    });
    const winner = withTenant(app.db, tenantId, async (tx) => {
      await loserWrote;
      expect(await authenticationSessionRepository(tx).consume(authSessionId, new Date())).toBe(
        true,
      );
      markWinnerConsumed();
      return admitSession(tx, {
        tenantId,
        subjectId,
        authenticators: [],
        remembered: false,
        browserSessions: [],
        maxSessionsPerBrowser: 3,
        lifespans: TENANT_LIFESPANS,
      });
    });

    await expect(Promise.all([loser, winner])).resolves.toBeDefined();
    expect(await liveInTenant(tenantId, new Date())).toBe(1);
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
      const rememberedId = await createSession(tx, tenantId, subject.id, far, true);
      await sessionRepository(tx).touch(rememberedId.id, idledSince);
      const ordinaryId = await createSession(tx, tenantId, subject.id, far);
      await sessionRepository(tx).touch(ordinaryId.id, idledSince);
      return { rememberedId, ordinaryId };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const live = await sessionRepository(tx).liveByEntries(
        [rememberedId, ordinaryId],
        TENANT_LIFESPANS,
        now,
      );
      expect(live.map((s) => s.id)).toEqual([rememberedId.id]);
    });
  });
});

describe('liveBySubject', () => {
  // The genuine orphan ADR 0033 describes: a session live in the database
  // but absent from the entries a browser's own cookie would present.
  // `liveByEntries`, given only the cookie's list, cannot see it —
  // `liveBySubject` is the one reader that does not need the list to find it.
  it('sees a live session that a browser cookie omits, unlike liveByEntries', async () => {
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
      const cookieView = await repo.liveByEntries([cookieId], TENANT_LIFESPANS, now);
      expect(cookieView.map((s) => s.id)).toEqual([cookieId.id]);

      const subjectView = await repo.liveBySubject(subjectId, TENANT_LIFESPANS, now);
      expect(subjectView.map((s) => s.id).sort()).toEqual([cookieId.id, orphanId.id].sort());
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
        const rememberedId = (await createSession(tx, tenantId, subject.id, far, true)).id;
        await sessionRepository(tx).touch(rememberedId, idledSince);
        const ordinaryId = (await createSession(tx, tenantId, subject.id, far)).id;
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
