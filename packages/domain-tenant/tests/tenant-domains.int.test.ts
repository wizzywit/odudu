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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalHostOf,
  DomainConflictError,
  lookupHost,
  MAX_DOMAINS_PER_TENANT,
  tenantDomainRepository,
} from '#/repository/tenant-domains';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date('2026-11-04T12:00:00Z');
const HOUR = 3_600_000;

async function newTenant(): Promise<{ id: string; name: string }> {
  const id = newId();
  const name = `t-${id.slice(-12)}`;
  await withTenant(app.db, id, (tx) => tx.insert(tenants).values({ id, name }));
  return { id, name };
}

let counter = 0;
const freshHost = (): string => `login${String((counter += 1))}.example.com`;

function register(tenantId: string, host = freshHost()) {
  return withTenant(app.db, tenantId, (tx) =>
    tenantDomainRepository(tx).insert({ tenantId, host, challenge: `challenge-${host}` }),
  );
}

async function verify(tenantId: string, id: string) {
  return withTenant(app.db, tenantId, (tx) =>
    tenantDomainRepository(tx).markVerified(tenantId, id, NOW),
  );
}

async function verified(tenantId: string, host = freshHost()) {
  const row = await register(tenantId, host);
  const done = await verify(tenantId, row.id);
  if (done === null) throw new Error('the row vanished');
  return done;
}

async function canonicalise(tenantId: string, id: string) {
  return withTenant(app.db, tenantId, (tx) =>
    tenantDomainRepository(tx).setCanonical(tenantId, id),
  );
}

const lookup = (host: string, now = NOW) => lookupHost(owner.db, host, now);

describe('insert, list and get', () => {
  it('stores a pending row with a zero failure count and reads it back', async () => {
    const { id: tenantId } = await newTenant();
    const row = await register(tenantId, 'a.example.com');
    expect(row).toMatchObject({
      tenantId,
      host: 'a.example.com',
      state: 'pending',
      challenge: 'challenge-a.example.com',
      verifiedAt: null,
      lastCheckedAt: null,
      failedChecks: 0,
      canonical: false,
    });
    const listed = await withTenant(app.db, tenantId, (tx) =>
      tenantDomainRepository(tx).list(tenantId),
    );
    expect(listed.map((r) => r.id)).toEqual([row.id]);
    const got = await withTenant(app.db, tenantId, (tx) =>
      tenantDomainRepository(tx).get(tenantId, row.id),
    );
    expect(got).toEqual(row);
  });

  it('refuses the same host twice in one tenant', async () => {
    const { id: tenantId } = await newTenant();
    await register(tenantId, 'twice.example.com');
    await expect(register(tenantId, 'twice.example.com')).rejects.toMatchObject({
      name: 'DomainConflictError',
      reason: 'already_registered',
    });
  });
});

describe('a host held by several tenants', () => {
  it('lets two tenants hold a pending row for one host', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await register(a.id, 'shared.example.com');
    await register(b.id, 'shared.example.com');
  });

  it('lets the first to verify win and refuses the second with the conflict', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const first = await register(a.id, 'race.example.com');
    const second = await register(b.id, 'race.example.com');
    expect(await verify(a.id, first.id)).toMatchObject({ state: 'verified' });
    await expect(verify(b.id, second.id)).rejects.toMatchObject({
      name: 'DomainConflictError',
      reason: 'host_verified_elsewhere',
    });
  });

  it('lets a failed row block nobody', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const stale = await register(a.id, 'lost.example.com');
    await withTenant(app.db, a.id, (tx) => tenantDomainRepository(tx).markFailed(a.id, stale.id));
    await verified(b.id, 'lost.example.com');
    const again = await register(a.id, 'lost2.example.com');
    expect(again.state).toBe('pending');
  });

  it('frees the host when the tenant is deleted', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await verified(a.id, 'freed.example.com');
    await owner.db.delete(tenants).where(eq(tenants.id, a.id));
    const mine = await verified(b.id, 'freed.example.com');
    expect(mine.state).toBe('verified');
    const remaining = await owner.sql`select 1 from tenant_domains where tenant_id = ${a.id}`;
    expect(remaining).toHaveLength(0);
  });
});

describe('a caught conflict', () => {
  it('leaves the transaction usable after a duplicate insert and after a refused verification', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await verified(a.id, 'held.example.com');
    const mine = await register(b.id, 'held.example.com');
    const outcome = await withTenant(app.db, b.id, async (tx) => {
      const repo = tenantDomainRepository(tx);
      const caught: string[] = [];
      for (const attempt of [
        () => repo.insert({ tenantId: b.id, host: 'held.example.com', challenge: 'c' }),
        () => repo.markVerified(b.id, mine.id, NOW),
      ]) {
        try {
          await attempt();
        } catch (error) {
          if (error instanceof DomainConflictError) caught.push(error.reason);
        }
      }
      return { caught, failed: await repo.markFailed(b.id, mine.id) };
    });
    expect(outcome.caught).toEqual(['already_registered', 'host_verified_elsewhere']);
    expect(outcome.failed).toMatchObject({ state: 'failed' });
  });
});

describe('the canonical row', () => {
  it('is at most one per tenant, at the database', async () => {
    const { id: tenantId } = await newTenant();
    const one = await verified(tenantId);
    const two = await verified(tenantId);
    await canonicalise(tenantId, one.id);
    await expect(
      owner.sql`update tenant_domains set canonical = true where id = ${two.id}`,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('moves with setCanonical, which leaves exactly one', async () => {
    const { id: tenantId } = await newTenant();
    const one = await verified(tenantId);
    const two = await verified(tenantId);
    await canonicalise(tenantId, one.id);
    expect(await canonicalise(tenantId, two.id)).toMatchObject({ canonical: true });
    const rows = await withTenant(app.db, tenantId, (tx) =>
      tenantDomainRepository(tx).list(tenantId),
    );
    expect(rows.filter((r) => r.canonical).map((r) => r.id)).toEqual([two.id]);
  });

  it('refuses a row that is not verified', async () => {
    const { id: tenantId } = await newTenant();
    const pending = await register(tenantId);
    expect(await canonicalise(tenantId, pending.id)).toBeNull();
    await expect(
      owner.sql`update tenant_domains set canonical = true where id = ${pending.id}`,
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('is cleared by clearCanonical, and canonicalHostOf follows', async () => {
    const { id: tenantId } = await newTenant();
    const row = await verified(tenantId, 'canon.example.com');
    const host = () => withTenant(app.db, tenantId, (tx) => canonicalHostOf(tx, tenantId));
    expect(await host()).toBeNull();
    await canonicalise(tenantId, row.id);
    expect(await host()).toBe('canon.example.com');
    await withTenant(app.db, tenantId, (tx) => tenantDomainRepository(tx).clearCanonical(tenantId));
    expect(await host()).toBeNull();
  });
});

describe('the stored form of a host', () => {
  it.each([
    'Login.Example.com',
    'login.example.com.',
    'login.example.com:8443',
    'localhost',
    '203.0.113.7',
    '[::1]',
    'a b.example.com',
    '-a.example.com',
    'a..example.com',
    '',
    `${'a'.repeat(64)}.example.com`,
    `${'a.'.repeat(130)}com`,
  ])('is refused by a CHECK: %j', async (host) => {
    const { id: tenantId } = await newTenant();
    await expect(register(tenantId, host)).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it.each(['login.example.com', 'xn--bcher-kva.example', 'a-b.c-d.example.co.uk', 'a1.b2.io'])(
    'accepts %j',
    async (host) => {
      const { id: tenantId } = await newTenant();
      await register(tenantId, host);
    },
  );
});

describe('the cap', () => {
  it('holds a tenant to MAX_DOMAINS_PER_TENANT rows and refuses the next with the conflict', async () => {
    expect(MAX_DOMAINS_PER_TENANT).toBe(20);
    const { id: tenantId } = await newTenant();
    for (let i = 0; i < MAX_DOMAINS_PER_TENANT; i += 1) await register(tenantId);
    const refused = register(tenantId);
    await expect(refused).rejects.toBeInstanceOf(DomainConflictError);
    await expect(refused).rejects.toMatchObject({ reason: 'limit' });
    const other = await newTenant();
    await register(other.id);
  });

  it('counts concurrent registrations against one cap', async () => {
    const { id: tenantId } = await newTenant();
    for (let i = 0; i < MAX_DOMAINS_PER_TENANT - 1; i += 1) await register(tenantId);
    const outcomes = await Promise.allSettled([register(tenantId), register(tenantId)]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rows = await owner.sql`select 1 from tenant_domains where tenant_id = ${tenantId}`;
    expect(rows).toHaveLength(MAX_DOMAINS_PER_TENANT);
  });
});

describe('checks', () => {
  it('records a passed check, which clears the count, and a failed one, which adds to it', async () => {
    const { id: tenantId } = await newTenant();
    const row = await verified(tenantId);
    const record = (ok: boolean, at: Date) =>
      withTenant(app.db, tenantId, (tx) =>
        tenantDomainRepository(tx).recordCheck(tenantId, row.id, ok, at),
      );
    expect(await record(false, NOW)).toMatchObject({ failedChecks: 1, lastCheckedAt: NOW });
    expect(await record(false, NOW)).toMatchObject({ failedChecks: 2 });
    expect(await record(true, new Date(NOW.getTime() + HOUR))).toMatchObject({
      failedChecks: 0,
      lastCheckedAt: new Date(NOW.getTime() + HOUR),
    });
  });
});

describe('issuer retirements', () => {
  it('lists the live ones, keeps the later expiry on a repeat and forgets on clear', async () => {
    const { id: tenantId } = await newTenant();
    const run = <T>(f: (r: ReturnType<typeof tenantDomainRepository>) => Promise<T>) =>
      withTenant(app.db, tenantId, (tx) => f(tenantDomainRepository(tx)));
    const soon = new Date(NOW.getTime() + HOUR);
    const later = new Date(NOW.getTime() + 2 * HOUR);
    await run((r) => r.retireIssuer(tenantId, 'https://id.example.com/tenants/x', soon));
    await run((r) => r.retireIssuer(tenantId, 'https://id.example.com/tenants/x', later));
    await run((r) => r.retireIssuer(tenantId, 'https://old.example.com', soon));
    await run((r) =>
      r.retireIssuer(tenantId, 'https://gone.example.com', new Date(NOW.getTime() - 1)),
    );
    const live = await run((r) => r.listRetired(tenantId, NOW));
    expect(live).toEqual([
      { issuer: 'https://id.example.com/tenants/x', expiresAt: later },
      { issuer: 'https://old.example.com', expiresAt: soon },
    ]);
    await run((r) => r.clearRetirement(tenantId, 'https://old.example.com'));
    expect((await run((r) => r.listRetired(tenantId, NOW))).map((x) => x.issuer)).toEqual([
      'https://id.example.com/tenants/x',
    ]);
  });
});

describe('lookupHost', () => {
  it('returns exactly the four fields for a verified canonical host', async () => {
    const t = await newTenant();
    const row = await verified(t.id, 'canon-a.example.com');
    await canonicalise(t.id, row.id);
    const found = await lookup('canon-a.example.com');
    expect(found).toEqual({
      tenantId: t.id,
      tenantName: t.name,
      canonical: true,
      retiredUntil: null,
    });
  });

  it('returns null for an unknown, a pending and a failed host', async () => {
    const t = await newTenant();
    expect(await lookup('nobody.example.com')).toBeNull();
    const pending = await register(t.id, 'pending-a.example.com');
    expect(await lookup('pending-a.example.com')).toBeNull();
    await withTenant(app.db, t.id, (tx) => tenantDomainRepository(tx).markFailed(t.id, pending.id));
    expect(await lookup('pending-a.example.com')).toBeNull();
  });

  it('returns null for a verified host that is neither canonical nor retired', async () => {
    const t = await newTenant();
    await verified(t.id, 'idle-a.example.com');
    expect(await lookup('idle-a.example.com')).toBeNull();
  });

  it('returns a retired host until its window closes, with that instant', async () => {
    const t = await newTenant();
    await verified(t.id, 'retired-a.example.com');
    const until = new Date(NOW.getTime() + HOUR);
    await withTenant(app.db, t.id, (tx) =>
      tenantDomainRepository(tx).retireIssuer(t.id, 'https://retired-a.example.com', until),
    );
    expect(await lookup('retired-a.example.com')).toEqual({
      tenantId: t.id,
      tenantName: t.name,
      canonical: false,
      retiredUntil: until,
    });
    expect(await lookup('retired-a.example.com', new Date(until.getTime() + 1))).toBeNull();
  });

  it('returns null for a host of a disabled tenant', async () => {
    const t = await newTenant();
    const row = await verified(t.id, 'off-a.example.com');
    await canonicalise(t.id, row.id);
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, t.id));
    expect(await lookup('off-a.example.com')).toBeNull();
  });

  it('answers for a host that only the serving role could not read', async () => {
    const t = await newTenant();
    const row = await verified(t.id, 'owner-a.example.com');
    await canonicalise(t.id, row.id);
    expect(await lookupHost(app.db, 'owner-a.example.com', NOW)).toBeNull();
    expect(await lookup('owner-a.example.com')).not.toBeNull();
  });
});

describe('a foreign tenant', () => {
  interface Seeded {
    tenantA: string;
    id: string;
    host: string;
  }

  const probe = (
    attempt: (tx: TenantScopedDatabase, seeded: Seeded) => Promise<unknown>,
    expectBlocked: (result: unknown) => void,
    verifyTenantAUnaffected?: (tx: TenantScopedDatabase, seeded: Seeded) => Promise<void>,
  ) =>
    expectCrossTenantMethodProbe<Seeded>(app.db, {
      seed: async (tx, tenantA) => {
        await tx.insert(tenants).values({ id: tenantA, name: `t-${tenantA.slice(0, 8)}` });
        const repo = tenantDomainRepository(tx);
        const row = await repo.insert({ tenantId: tenantA, host: freshHost(), challenge: 'c' });
        await repo.markVerified(tenantA, row.id, NOW);
        await repo.retireIssuer(tenantA, 'https://r.example.com', new Date(NOW.getTime() + HOUR));
        return { tenantA, id: row.id, host: row.host };
      },
      verifySeeded: async (tx, seeded) => {
        const repo = tenantDomainRepository(tx);
        expect(await repo.get(seeded.tenantA, seeded.id)).toMatchObject({ state: 'verified' });
        expect(await repo.listRetired(seeded.tenantA, NOW)).toHaveLength(1);
      },
      attempt,
      expectBlocked,
      ...(verifyTenantAUnaffected === undefined ? {} : { verifyTenantAUnaffected }),
    });

  it('cannot list, get, find by host or read the retirements, naming tenant A or another', async () => {
    await probe(
      async (tx, seeded) => {
        const repo = tenantDomainRepository(tx);
        return {
          listed: await repo.list(seeded.tenantA),
          got: await repo.get(seeded.tenantA, seeded.id),
          byHost: await repo.getByHost(seeded.tenantA, seeded.host),
          retired: await repo.listRetired(seeded.tenantA, NOW),
          canonical: await canonicalHostOf(tx, seeded.tenantA),
        };
      },
      (result) => {
        expect(result).toEqual({
          listed: [],
          got: null,
          byHost: null,
          retired: [],
          canonical: null,
        });
      },
    );
  });

  it('cannot delete, verify, fail, check, canonicalise or clear tenant A rows', async () => {
    await probe(
      async (tx, seeded) => {
        const repo = tenantDomainRepository(tx);
        return {
          deleted: await repo.delete(seeded.tenantA, seeded.id),
          verified: await repo.markVerified(seeded.tenantA, seeded.id, NOW),
          failed: await repo.markFailed(seeded.tenantA, seeded.id),
          checked: await repo.recordCheck(seeded.tenantA, seeded.id, false, NOW),
          canonical: await repo.setCanonical(seeded.tenantA, seeded.id),
          cleared: await repo.clearCanonical(seeded.tenantA),
          unretired: await repo.clearRetirement(seeded.tenantA, 'https://r.example.com'),
        };
      },
      (result) => {
        expect(result).toEqual({
          deleted: false,
          verified: null,
          failed: null,
          checked: null,
          canonical: null,
          cleared: 0,
          unretired: false,
        });
      },
      async (tx, seeded) => {
        const repo = tenantDomainRepository(tx);
        expect(await repo.get(seeded.tenantA, seeded.id)).toMatchObject({
          state: 'verified',
          failedChecks: 0,
          canonical: false,
        });
        expect(await repo.listRetired(seeded.tenantA, NOW)).toHaveLength(1);
      },
    );
  });

  it('cannot write a row for tenant A, or retire an issuer for it', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const forged = () =>
      withTenant(app.db, b.id, (tx) =>
        tenantDomainRepository(tx).insert({
          tenantId: a.id,
          host: 'forged.example.com',
          challenge: 'x',
        }),
      );
    await expect(forged()).rejects.toThrow();
    await expect(
      withTenant(app.db, b.id, (tx) =>
        tenantDomainRepository(tx).retireIssuer(a.id, 'https://x.example.com', NOW),
      ),
    ).rejects.toThrow();
    expect(await owner.sql`select 1 from tenant_domains where tenant_id = ${a.id}`).toHaveLength(0);
  });
});
