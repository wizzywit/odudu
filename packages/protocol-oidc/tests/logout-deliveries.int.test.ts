import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossRealmMethodProbe, expectRealmIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKCHANNEL_LOGOUT_MAX_ATTEMPTS,
  logoutDeliveryRepository,
  type EnqueueDelivery,
} from '#/repository/logout-deliveries';
import { backchannelLogoutDeliveries } from '#/schema/logout-deliveries';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const MINUTE = 60 * 1000;

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

let realmId: string;

async function seedRealm(): Promise<string> {
  const id = newId();
  await owner.db.insert(realms).values({ id, name: `logout-deliveries-${id}` });
  return id;
}

function delivery(into: string, overrides: Partial<EnqueueDelivery> = {}): EnqueueDelivery {
  return {
    id: newId(),
    realmId: into,
    clientId: newId(),
    endpoint: 'https://rp.example/backchannel-logout',
    logoutToken: 'signed-logout-token',
    nextAttemptAt: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  realmId = await seedRealm();
});

describe('the backchannel logout delivery queue', () => {
  it('returns a due delivery and not one scheduled for later', async () => {
    const dueRow = delivery(realmId);
    const laterRow = delivery(realmId, { nextAttemptAt: new Date(NOW.getTime() + MINUTE) });

    const claimed = await withRealm(app.db, realmId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow, laterRow]);
      return repo.claimDue(NOW, 10);
    });

    expect(claimed.map((d) => d.id)).toEqual([dueRow.id]);
  });

  it('does not return a delivery already marked delivered', async () => {
    const dueRow = delivery(realmId);

    const claimed = await withRealm(app.db, realmId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      await repo.markDelivered(dueRow.id, NOW);
      return repo.claimDue(NOW, 10);
    });

    expect(claimed).toEqual([]);
  });

  it('backs a failed delivery off rather than retrying it immediately', async () => {
    const dueRow = delivery(realmId);

    const { immediately, afterBackoff } = await withRealm(app.db, realmId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      await repo.markFailed(dueRow.id, NOW, 'connect ECONNREFUSED');
      return {
        immediately: await repo.claimDue(NOW, 10),
        afterBackoff: await repo.claimDue(new Date(NOW.getTime() + MINUTE), 10),
      };
    });

    expect(immediately).toEqual([]);
    expect(afterBackoff).toHaveLength(1);
  });

  it('stops retrying after the attempt limit', async () => {
    const dueRow = delivery(realmId);
    const farFuture = new Date(NOW.getTime() + 365 * 24 * 60 * MINUTE);

    const claimed = await withRealm(app.db, realmId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      for (let attempt = 0; attempt < BACKCHANNEL_LOGOUT_MAX_ATTEMPTS; attempt += 1) {
        await repo.markFailed(dueRow.id, NOW, 'connect ECONNREFUSED');
      }
      return repo.claimDue(farFuture, 10);
    });

    expect(claimed).toEqual([]);
  });

  it("cannot see another realm's deliveries", async () => {
    const dueRow = delivery(realmId);
    await withRealm(app.db, realmId, (tx) => logoutDeliveryRepository(tx).enqueue([dueRow]));

    const otherRealmId = await seedRealm();
    const claimed = await withRealm(app.db, otherRealmId, (tx) =>
      logoutDeliveryRepository(tx).claimDue(NOW, 10),
    );

    expect(claimed).toEqual([]);
  });

  it('scopes its rows to the realm that queued them', async () => {
    await expectRealmIsolation(app.db, {
      table: 'backchannel_logout_deliveries',
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        await logoutDeliveryRepository(tx).enqueue([delivery(seededRealm)]);
      },
    });
  });
});

describe('a foreign realm cannot reach a queued delivery', () => {
  it('refuses to queue a delivery for another realm', async () => {
    const foreignRealm = await seedRealm();

    // The policy declares no WITH CHECK, so its USING expression is what
    // refuses the insert: the row is not merely invisible afterwards, it
    // was never written.
    await expect(
      withRealm(app.db, realmId, (tx) =>
        logoutDeliveryRepository(tx).enqueue([delivery(foreignRealm)]),
      ),
    ).rejects.toThrow();

    const rows = await owner.db
      .select()
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.realmId, foreignRealm));
    expect(rows).toEqual([]);
  });

  it('cannot mark another realm’s delivery delivered', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        const row = delivery(seededRealm);
        await logoutDeliveryRepository(tx).enqueue([row]);
        return row.id;
      },
      verifySeeded: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.deliveredAt).toBeNull();
      },
      attempt: (tx, id) => logoutDeliveryRepository(tx).markDelivered(id, NOW),
      // It defaults rather than raising, so the probe asserts the
      // non-default: the foreign call reports it changed nothing.
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.deliveredAt).toBeNull();
      },
    });
  });

  it('cannot record a failure against another realm’s delivery', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        const row = delivery(seededRealm);
        await logoutDeliveryRepository(tx).enqueue([row]);
        return row.id;
      },
      verifySeeded: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.lastError).toBeNull();
      },
      attempt: (tx, id) =>
        logoutDeliveryRepository(tx).markFailed(id, NOW, 'written from the wrong realm'),
      expectBlocked: () => undefined,
      verifyRealmAUnaffected: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.lastError).toBeNull();
        expect(rows[0]?.attempts).toBe(0);
      },
    });
  });

  it('claims nothing of another realm, and leaves its attempt count alone', async () => {
    const foreignRealm = await seedRealm();
    const row = delivery(foreignRealm);
    await withRealm(app.db, foreignRealm, (tx) => logoutDeliveryRepository(tx).enqueue([row]));

    const claimed = await withRealm(app.db, realmId, (tx) =>
      logoutDeliveryRepository(tx).claimDue(NOW, 10),
    );

    expect(claimed).toEqual([]);
    const rows = await owner.db
      .select()
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.id, row.id));
    expect(rows[0]?.attempts).toBe(0);
  });
});
