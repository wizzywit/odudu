import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { consoleSessions } from '#/schema/console-sessions';

export type ConsoleSessionRecord = typeof consoleSessions.$inferSelect;

/** What a refresh replaces. A refresh response carries no ID token. */
export interface ConsoleSessionTokens {
  readonly accessTokenWrapped: string;
  readonly refreshTokenWrapped: string;
  readonly accessExpiresAt: Date;
}

/** `locked`: another transaction holds the row, so this touch was skipped. */
export type TouchOutcome = 'touched' | 'locked' | 'gone';

export interface NewConsoleSession {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly secretHash: Buffer;
  readonly tokens: ConsoleSessionTokens;
  readonly idTokenWrapped: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export function consoleSessionRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewConsoleSession): Promise<ConsoleSessionRecord> {
      const rows = await tx
        .insert(consoleSessions)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          secretHash: input.secretHash,
          ...input.tokens,
          idTokenWrapped: input.idTokenWrapped,
          createdAt: input.now,
          lastSeenAt: input.now,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error('console session insert returned no row');
      return row;
    },

    async bySecretHash(hash: Buffer): Promise<ConsoleSessionRecord | null> {
      const rows = await tx
        .select()
        .from(consoleSessions)
        .where(eq(consoleSessions.secretHash, hash));
      return rows[0] ?? null;
    },

    // Serialises refreshes of one session, so two tabs refreshing together
    // present its refresh token once rather than tripping reuse detection.
    // A wait past the timeout throws SQLSTATE 55P03 rather than holding a
    // pooled connection indefinitely.
    async lockById(id: string): Promise<ConsoleSessionRecord | null> {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const rows = await tx
        .select()
        .from(consoleSessions)
        .where(eq(consoleSessions.id, id))
        .for('update');
      return rows[0] ?? null;
    },

    // Never waits: a refresh holds the row's lock across a call that needs
    // a pooled connection, and a touch queued behind it would hold another.
    async touch(id: string, now: Date): Promise<TouchOutcome> {
      const free = await tx
        .select({ id: consoleSessions.id })
        .from(consoleSessions)
        .where(eq(consoleSessions.id, id))
        .for('update', { skipLocked: true });
      if (free.length === 0) {
        const exists = await tx
          .select({ id: consoleSessions.id })
          .from(consoleSessions)
          .where(eq(consoleSessions.id, id));
        return exists.length > 0 ? 'locked' : 'gone';
      }
      await tx.update(consoleSessions).set({ lastSeenAt: now }).where(eq(consoleSessions.id, id));
      return 'touched';
    },

    async replaceTokens(id: string, tokens: ConsoleSessionTokens): Promise<boolean> {
      const rows = await tx
        .update(consoleSessions)
        .set({ ...tokens })
        .where(eq(consoleSessions.id, id))
        .returning({ id: consoleSessions.id });
      return rows.length > 0;
    },

    async delete(id: string): Promise<boolean> {
      const rows = await tx
        .delete(consoleSessions)
        .where(eq(consoleSessions.id, id))
        .returning({ id: consoleSessions.id });
      return rows.length > 0;
    },
  };
}
