import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, gt } from 'drizzle-orm';
import { consoleLogins } from '#/schema/console-sessions';

export type ConsoleLoginRecord = typeof consoleLogins.$inferSelect;

export type NewConsoleLogin = Omit<ConsoleLoginRecord, 'id'>;

export function consoleLoginRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewConsoleLogin): Promise<ConsoleLoginRecord> {
      const rows = await tx
        .insert(consoleLogins)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          stateHash: input.stateHash,
          verifierWrapped: input.verifierWrapped,
          nonce: input.nonce,
          returnTo: input.returnTo,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error('console login insert returned no row');
      return row;
    },

    // One statement, so two callbacks racing the same state cannot both
    // take it. An expired row is left for the reaper rather than returned.
    async takeByStateHash(hash: Buffer, now: Date): Promise<ConsoleLoginRecord | null> {
      const rows = await tx
        .delete(consoleLogins)
        .where(and(eq(consoleLogins.stateHash, hash), gt(consoleLogins.expiresAt, now)))
        .returning();
      return rows[0] ?? null;
    },
  };
}
