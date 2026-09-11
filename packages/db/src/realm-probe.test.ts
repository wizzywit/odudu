import { describe, expect, it } from 'vitest';
import { expectRealmIsolation } from '#/realm-probe';
import { type Database } from '#/client';

describe('expectRealmIsolation', () => {
  it('rejects the realms table before touching the database', async () => {
    // No real Database is needed: the rejection happens before `db` is
    // used, so a value that would fail loudly on any real query is enough
    // to prove the check runs first.
    const db = undefined as unknown as Database;

    await expect(
      expectRealmIsolation(db, { table: 'realms', seed: () => Promise.resolve() }),
    ).rejects.toThrow(/realms/);
  });
});
