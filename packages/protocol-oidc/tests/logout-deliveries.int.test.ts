import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { clients } from '@odudu/domain-tenant';
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
const LEASE_SECONDS = 300;

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

let tenantId: string;
let clientId: string;

async function seedTenant(): Promise<string> {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `logout-deliveries-${id}` });
  return id;
}

// A row for the FK (tenant_id, client_id) -> clients(tenant_id, id) to
// point at. Inserted directly through the owner connection, the way this
// file already seeds tenants: RLS is not the thing under test here.
async function seedClient(tenantOf: string): Promise<string> {
  const id = newId();
  await owner.db.insert(clients).values({
    id,
    tenantId: tenantOf,
    clientId: `rp-${id}`,
    name: 'Relying party',
    type: 'public',
  });
  return id;
}

function delivery(overrides: Partial<EnqueueDelivery> = {}): EnqueueDelivery {
  return {
    id: newId(),
    tenantId,
    clientId,
    sessionId: newId(),
    endpoint: 'https://rp.example/backchannel-logout',
    logoutToken: 'signed-logout-token',
    nextAttemptAt: NOW,
    ...overrides,
  };
}

function claimAt(now: Date, limit = 10) {
  return { now, limit, leaseSeconds: LEASE_SECONDS };
}

beforeEach(async () => {
  tenantId = await seedTenant();
  clientId = await seedClient(tenantId);
});

describe('the backchannel logout delivery queue', () => {
  it('returns a due delivery and not one scheduled for later', async () => {
    const dueRow = delivery();
    const laterRow = delivery({ nextAttemptAt: new Date(NOW.getTime() + MINUTE) });

    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow, laterRow]);
      return repo.claimDue(claimAt(NOW));
    });

    expect(claimed.map((d) => d.id)).toEqual([dueRow.id]);
  });

  // What a session ending twice — sequentially, or racing itself across
  // two concurrent requests — must leave behind: one delivery per client,
  // not one per attempt to end it.
  it('enqueues the same session and client only once', async () => {
    const first = delivery();
    const second = delivery({
      id: newId(),
      sessionId: first.sessionId,
      logoutToken: 'second-signed-logout-token',
    });

    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([first]);
      await repo.enqueue([second]);
      return repo.claimDue(claimAt(NOW));
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.logoutToken).toBe(first.logoutToken);
  });

  it('does not return a delivery already marked delivered', async () => {
    const dueRow = delivery();

    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      await repo.markDelivered(dueRow.id, NOW);
      return repo.claimDue(claimAt(NOW));
    });

    expect(claimed).toEqual([]);
  });

  it('backs a failed delivery off rather than retrying it immediately', async () => {
    const dueRow = delivery();

    const { immediately, afterBackoff } = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      await repo.markFailed(dueRow.id, NOW, 'connect ECONNREFUSED');
      return {
        immediately: await repo.claimDue(claimAt(NOW)),
        afterBackoff: await repo.claimDue(claimAt(new Date(NOW.getTime() + MINUTE))),
      };
    });

    expect(immediately).toEqual([]);
    expect(afterBackoff).toHaveLength(1);
  });

  it('stops retrying after the attempt limit', async () => {
    const dueRow = delivery();
    const farFuture = new Date(NOW.getTime() + 365 * 24 * 60 * MINUTE);

    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      for (let attempt = 0; attempt < BACKCHANNEL_LOGOUT_MAX_ATTEMPTS; attempt += 1) {
        await repo.markFailed(dueRow.id, NOW, 'connect ECONNREFUSED');
      }
      return repo.claimDue(claimAt(farFuture));
    });

    expect(claimed).toEqual([]);
  });

  // §2.5's second SHOULD: a delivery the relying party rejected
  // deterministically is never offered again, not merely backed off — the
  // far future a mere backoff would have cleared still excludes it.
  it('never offers a delivery again once it is marked abandoned', async () => {
    const dueRow = delivery();
    const farFuture = new Date(NOW.getTime() + 365 * 24 * 60 * MINUTE);

    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      await repo.markAbandoned(dueRow.id, NOW, 'logout delivery refused with status 400');
      return repo.claimDue(claimAt(farFuture));
    });

    expect(claimed).toEqual([]);
  });

  // What FOR UPDATE SKIP LOCKED buys the lease over blocking behind one
  // lock: a claim's own UPDATE moves next_attempt_at forward immediately,
  // so a second claim on the same connection sees the row as not yet due
  // rather than as still locked.
  it('does not return a delivery it just leased', async () => {
    const dueRow = delivery();

    const { first, second } = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      return {
        first: await repo.claimDue(claimAt(NOW)),
        second: await repo.claimDue(claimAt(NOW)),
      };
    });

    expect(first.map((d) => d.id)).toEqual([dueRow.id]);
    expect(second).toEqual([]);
  });

  it('offers a leased delivery again once the lease has elapsed', async () => {
    const dueRow = delivery();

    const { leased, tooSoon, afterLease } = await withTenant(app.db, tenantId, async (tx) => {
      const repo = logoutDeliveryRepository(tx);
      await repo.enqueue([dueRow]);
      const claimed = await repo.claimDue(claimAt(NOW));
      return {
        leased: claimed,
        tooSoon: await repo.claimDue(claimAt(new Date(NOW.getTime() + (LEASE_SECONDS - 1) * 1000))),
        afterLease: await repo.claimDue(claimAt(new Date(NOW.getTime() + LEASE_SECONDS * 1000))),
      };
    });

    expect(leased).toHaveLength(1);
    expect(tooSoon).toEqual([]);
    expect(afterLease.map((d) => d.id)).toEqual([dueRow.id]);
  });

  it("cannot see another tenant's deliveries", async () => {
    const dueRow = delivery();
    await withTenant(app.db, tenantId, (tx) => logoutDeliveryRepository(tx).enqueue([dueRow]));

    const otherTenantId = await seedTenant();
    const claimed = await withTenant(app.db, otherTenantId, (tx) =>
      logoutDeliveryRepository(tx).claimDue(claimAt(NOW)),
    );

    expect(claimed).toEqual([]);
  });

  it('scopes its rows to the tenant that queued them', async () => {
    await expectTenantIsolation(app.db, {
      table: 'backchannel_logout_deliveries',
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const seededClientId = await seedClient(seededTenant);
        await logoutDeliveryRepository(tx).enqueue([
          delivery({ id: newId(), tenantId: seededTenant, clientId: seededClientId }),
        ]);
      },
    });
  });

  it('refuses to queue a delivery for a client that does not exist', async () => {
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        logoutDeliveryRepository(tx).enqueue([delivery({ clientId: newId() })]),
      ),
    ).rejects.toThrow();
  });

  it('is removed when the client it is for is deleted', async () => {
    const row = delivery();
    await withTenant(app.db, tenantId, (tx) => logoutDeliveryRepository(tx).enqueue([row]));

    await owner.db.delete(clients).where(eq(clients.id, clientId));

    const rows = await owner.db
      .select()
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.id, row.id));
    expect(rows).toEqual([]);
  });
});

describe('a foreign tenant cannot reach a queued delivery', () => {
  it('refuses to queue a delivery for another tenant', async () => {
    const foreignTenant = await seedTenant();
    const foreignClientId = await seedClient(foreignTenant);

    // The policy declares no WITH CHECK, so its USING expression is what
    // refuses the insert: the row is not merely invisible afterwards, it
    // was never written.
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        logoutDeliveryRepository(tx).enqueue([
          delivery({ id: newId(), tenantId: foreignTenant, clientId: foreignClientId }),
        ]),
      ),
    ).rejects.toThrow();

    const rows = await owner.db
      .select()
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.tenantId, foreignTenant));
    expect(rows).toEqual([]);
  });

  it('cannot mark another tenant’s delivery delivered', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const seededClientId = await seedClient(seededTenant);
        const row = delivery({ id: newId(), tenantId: seededTenant, clientId: seededClientId });
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
      verifyTenantAUnaffected: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.deliveredAt).toBeNull();
      },
    });
  });

  it('cannot record a failure against another tenant’s delivery', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const seededClientId = await seedClient(seededTenant);
        const row = delivery({ id: newId(), tenantId: seededTenant, clientId: seededClientId });
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
        logoutDeliveryRepository(tx).markFailed(id, NOW, 'written from the wrong tenant'),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.lastError).toBeNull();
        expect(rows[0]?.attempts).toBe(0);
      },
    });
  });

  it('cannot abandon another tenant’s delivery', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const seededClientId = await seedClient(seededTenant);
        const row = delivery({ id: newId(), tenantId: seededTenant, clientId: seededClientId });
        await logoutDeliveryRepository(tx).enqueue([row]);
        return row.id;
      },
      verifySeeded: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.attempts).toBe(0);
      },
      attempt: (tx, id) =>
        logoutDeliveryRepository(tx).markAbandoned(id, NOW, 'written from the wrong tenant'),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, id) => {
        const rows = await tx
          .select()
          .from(backchannelLogoutDeliveries)
          .where(eq(backchannelLogoutDeliveries.id, id));
        expect(rows[0]?.lastError).toBeNull();
        expect(rows[0]?.attempts).toBe(0);
      },
    });
  });

  it('claims nothing of another tenant, and leaves its attempt count alone', async () => {
    const foreignTenant = await seedTenant();
    const foreignClientId = await seedClient(foreignTenant);
    const row = delivery({ id: newId(), tenantId: foreignTenant, clientId: foreignClientId });
    await withTenant(app.db, foreignTenant, (tx) => logoutDeliveryRepository(tx).enqueue([row]));

    const claimed = await withTenant(app.db, tenantId, (tx) =>
      logoutDeliveryRepository(tx).claimDue(claimAt(NOW)),
    );

    expect(claimed).toEqual([]);
    const rows = await owner.db
      .select()
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.id, row.id));
    expect(rows[0]?.attempts).toBe(0);
  });
});
