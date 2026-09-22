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
import { assertionJtiRepository } from '#/repository/assertion-jti';

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
