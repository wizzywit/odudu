import { eq } from 'drizzle-orm';
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
  };
}

// Read-only access to the parked-request row, independent of the executor's
// own state-machine flow — for callers (logging, admin inspection, a future
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
  };
}
