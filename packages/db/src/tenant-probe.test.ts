import { describe, expect, it } from 'vitest';
import { expectTenantIsolation } from '#/tenant-probe';
import { type Database } from '#/client';

describe('expectTenantIsolation', () => {
  it('rejects the tenants table before touching the database', async () => {
    // No real Database is needed: the rejection happens before `db` is
    // used, so a value that would fail loudly on any real query is enough
    // to prove the check runs first.
    const db = undefined as unknown as Database;

    await expect(
      expectTenantIsolation(db, { table: 'tenants', seed: () => Promise.resolve() }),
    ).rejects.toThrow(/tenants/);
  });
});
