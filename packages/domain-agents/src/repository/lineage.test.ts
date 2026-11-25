import { RetryableTransactionError, type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { lockLineageRoots } from '#/repository/lineage';

// A transaction whose lineage walks always find a root it has not locked yet,
// as one does when grants are deleted faster than it can lock them.
function shifting(): TenantScopedDatabase {
  let walk = 0;
  return {
    execute: () => {
      walk += 1;
      return Promise.resolve(walk % 2 === 1 ? [{ roots: [`root-${String(walk)}`] }] : []);
    },
  } as unknown as TenantScopedDatabase;
}

describe('lockLineageRoots', () => {
  it('gives up with an error a transaction can be run again for', async () => {
    await expect(lockLineageRoots(shifting(), sql`select 1`)).rejects.toBeInstanceOf(
      RetryableTransactionError,
    );
  });
});
