import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertionJtiRepository, jtiLockKey } from '#/repository/assertion-jti';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const expiresAt = new Date(NOW.getTime() + 60_000);
const past = new Date(NOW.getTime() - 60_000);

let tenantId: string;

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

async function seedTenant(tx: TenantScopedDatabase, id: string): Promise<void> {
  await tx.insert(tenants).values({ id, name: `tenant-${id}` });
}

beforeEach(async () => {
  tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
});

describe('assertionJtiRepository', () => {
  it('admits a jti the first time', async () => {
    const result = await assertionJtiRepository(app).claim(
      tenantId,
      'client-a',
      'jti-1',
      expiresAt,
    );
    expect(result).toBe(true);
  });

  it('refuses the same jti from the same client', async () => {
    await assertionJtiRepository(app).claim(tenantId, 'client-a', 'jti-1', expiresAt);
    const replay = await assertionJtiRepository(app).claim(
      tenantId,
      'client-a',
      'jti-1',
      expiresAt,
    );
    expect(replay).toBe(false);
  });

  // The boundary that makes the unique constraint composite: a jti is
  // unique per issuer, and two clients may pick the same one. Satisfied
  // only by the client dimension of the key — the tenant is the same
  // tenantId both calls run under — so this is the one test that fails if
  // the primary key drops oauth_client_id: narrowing it to
  // (tenant_id, jti) turns this `true` into a `false`.
  it('admits the same jti from a different client', async () => {
    await assertionJtiRepository(app).claim(tenantId, 'client-a', 'jti-1', expiresAt);
    const other = await assertionJtiRepository(app).claim(tenantId, 'client-b', 'jti-1', expiresAt);
    expect(other).toBe(true);
  });

  // The complement of the test above: client and jti are identical across
  // both calls, only tenantId differs, so this is satisfied by the tenant
  // dimension of the key alone.
  it('admits the same jti from a different tenant', async () => {
    await assertionJtiRepository(app).claim(tenantId, 'client-a', 'jti-1', expiresAt);

    const otherTenantId = newId();
    await withTenant(app.db, otherTenantId, (tx) => seedTenant(tx, otherTenantId));

    const admitted = await assertionJtiRepository(app).claim(
      otherTenantId,
      'client-a',
      'jti-1',
      expiresAt,
    );
    expect(admitted).toBe(true);
  });

  // `claim` opens its own transaction for the tenantId it is given, so
  // there is no longer a separable "the transaction's own tenant" for that
  // argument to disagree with — the two collapsed into one value by
  // construction (see assertion-jti.ts). What is still checkable is the
  // foreign key to tenants: a tenantId naming no row is refused.
  it('refuses to claim a jti under a tenant_id that names no tenant', async () => {
    const unseededTenantId = newId();
    await expect(
      assertionJtiRepository(app).claim(unseededTenantId, 'client-a', 'jti-1', expiresAt),
    ).rejects.toThrow();
  });

  // The property this guard exists for, made structural rather than
  // conventional: `claim` takes the pool handle and opens its own
  // transaction internally, so passing it the handle a real request
  // holds — the only way anything can call it — cannot smuggle the
  // request's own transaction in underneath. The outer `withTenant` here
  // stands in for the rest of a request's work; it throws after the
  // claim, and the claim survives that rollback because it was never
  // inside it.
  it('leaves a jti spent when the request that claimed it rolls back', async () => {
    await expect(
      withTenant(app.db, tenantId, async () => {
        await assertionJtiRepository(app).claim(tenantId, 'client-a', 'jti-1', expiresAt);
        throw new Error('the request failed for an unrelated reason');
      }),
    ).rejects.toThrow('the request failed for an unrelated reason');

    const replay = await assertionJtiRepository(app).claim(
      tenantId,
      'client-a',
      'jti-1',
      expiresAt,
    );
    expect(replay).toBe(false);
  });

  // The converse of the property above, stated as its own test: an
  // assertion is single-use, so a request that claims a jti and then fails
  // for a reason that has nothing to do with the assertion still leaves
  // that jti spent for good — a client cannot retry the same assertion
  // after an unrelated failure. Cleanup of an expired claim is the
  // retention pass's job (apps/server/src/cli/reap.ts), not `claim`'s: a
  // row past its own expires_at is still exactly as good at refusing a
  // replay as a fresh one, until something reaps it.
  it('keeps refusing a replay of a jti already past its own expiry', async () => {
    await assertionJtiRepository(app).claim(tenantId, 'client-a', 'jti-1', past);
    const replay = await assertionJtiRepository(app).claim(
      tenantId,
      'client-a',
      'jti-1',
      expiresAt,
    );
    expect(replay).toBe(false);
  });
});

describe('assertionJtiRepository.claimWithin', () => {
  it('claims on the transaction it is given, and refuses the same jti afterwards', async () => {
    const first = await withTenant(app.db, tenantId, (tx) =>
      assertionJtiRepository(app).claimWithin(tx, tenantId, 'client', 'jti-within', expiresAt),
    );
    expect(first).toBe(true);
    const second = await assertionJtiRepository(app).claim(
      tenantId,
      'client',
      'jti-within',
      expiresAt,
    );
    expect(second).toBe(false);
  });

  it('leaves the jti unspent when that transaction rolls back', async () => {
    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await assertionJtiRepository(app).claimWithin(
          tx,
          tenantId,
          'client',
          'jti-gone',
          expiresAt,
        );
        throw new Error('the request failed');
      }),
    ).rejects.toThrow();
    expect(await assertionJtiRepository(app).claim(tenantId, 'client', 'jti-gone', expiresAt)).toBe(
      true,
    );
  });

  it("cannot spend a jti under another tenant's id: row-level security refuses the write", async () => {
    const other = newId();
    await withTenant(app.db, other, (tx) => seedTenant(tx, other));
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        assertionJtiRepository(app).claimWithin(tx, other, 'client', 'jti-foreign', expiresAt),
      ),
    ).rejects.toThrow();
    expect(
      await withTenant(app.db, other, (tx) =>
        assertionJtiRepository(app).spentWithin(tx, other, 'client', 'jti-foreign'),
      ),
    ).toBe(false);
  });

  it("does not see another tenant's spent jti", async () => {
    const other = newId();
    await withTenant(app.db, other, (tx) => seedTenant(tx, other));
    await withTenant(app.db, other, (tx) =>
      assertionJtiRepository(app).claimWithin(tx, other, 'client', 'jti-shared', expiresAt),
    );
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        assertionJtiRepository(app).spentWithin(tx, tenantId, 'client', 'jti-shared'),
      ),
    ).toBe(false);
  });
});

describe('assertionJtiRepository.tryLock', () => {
  it('is refused, not waited for, while another transaction holds the same jti', async () => {
    const repository = assertionJtiRepository(app);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = withTenant(app.db, tenantId, async (tx) => {
      expect(await repository.tryLock(tx, tenantId, 'client', 'jti-locked')).toBe(true);
      locked();
      await held;
    });
    await lockTaken;
    const contender = await withTenant(app.db, tenantId, (tx) =>
      repository.tryLock(tx, tenantId, 'client', 'jti-locked'),
    );
    const other = await withTenant(app.db, tenantId, (tx) =>
      repository.tryLock(tx, tenantId, 'client', 'jti-another'),
    );
    release();
    await holder;
    expect(contender).toBe(false);
    expect(other).toBe(true);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        repository.tryLock(tx, tenantId, 'client', 'jti-locked'),
      ),
    ).toBe(true);
  });
});

describe('the advisory lock key', () => {
  it('differs for tuples a naive join would alias, and is stable', () => {
    expect(jtiLockKey('t', 'a:b', 'c')).not.toBe(jtiLockKey('t', 'a', 'b:c'));
    expect(jtiLockKey('t:a', 'b', 'c')).not.toBe(jtiLockKey('t', 'a:b', 'c'));
    expect(jtiLockKey('t', 'a', 'c')).toBe(jtiLockKey('t', 'a', 'c'));
    expect(typeof jtiLockKey('t', 'a', 'c')).toBe('bigint');
  });

  it('does not let a client_id holding a colon take another client’s lock', async () => {
    const repository = assertionJtiRepository(app);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = withTenant(app.db, tenantId, async (tx) => {
      await repository.tryLock(tx, tenantId, 'a:b', 'c');
      locked();
      await held;
    });
    await lockTaken;
    const aliased = await withTenant(app.db, tenantId, (tx) =>
      repository.tryLock(tx, tenantId, 'a', 'b:c'),
    );
    release();
    await holder;
    expect(aliased).toBe(true);
  });
});
