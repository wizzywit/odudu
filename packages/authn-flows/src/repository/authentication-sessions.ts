import { and, eq, isNull } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import {
  authenticationSessions,
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';

function toRecord(row: typeof authenticationSessions.$inferSelect): AuthenticationSessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    pendingRequest: row.pendingRequest as PendingRequest,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

export interface NewAuthenticationSession {
  id: string;
  realmId: string;
  pendingRequest: PendingRequest;
  expiresAt: Date;
}

// All persistence for the parked-request row, both for the executor's own
// state-machine flow and for callers (logging, admin inspection, a future
// "resend" path) that want the row without driving `advance`.
export function authenticationSessionRepository(tx: RealmScopedDatabase) {
  return {
    async byId(id: string): Promise<AuthenticationSessionRecord | null> {
      const rows = await tx
        .select()
        .from(authenticationSessions)
        .where(eq(authenticationSessions.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async create(values: NewAuthenticationSession): Promise<void> {
      await tx.insert(authenticationSessions).values(values);
    },

    // A single conditional UPDATE, not read-then-write: the WHERE clause is
    // the only thing standing between one successful login and two, so it
    // has to be the same statement that flips the flag. Returns whether
    // this call is the one that consumed the session — false means either
    // it never existed or a previous call (possibly racing this one) already
    // did, and the caller must not proceed as though it owns the session.
    async consume(id: string, consumedAt: Date): Promise<boolean> {
      const rows = await tx
        .update(authenticationSessions)
        .set({ consumedAt })
        .where(and(eq(authenticationSessions.id, id), isNull(authenticationSessions.consumedAt)))
        .returning({ id: authenticationSessions.id });
      return rows.length > 0;
    },
  };
}
