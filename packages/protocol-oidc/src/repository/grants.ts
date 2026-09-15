import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { tokenGrants, type TokenGrantRecord } from '#/schema/token-grants';

export type { TokenGrantRecord } from '#/schema/token-grants';

function toRecord(row: typeof tokenGrants.$inferSelect): TokenGrantRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    clientId: row.clientId,
    subjectId: row.subjectId,
    scope: row.scope,
    audience: row.audience,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    sessionId: row.sessionId,
  };
}

export interface NewTokenGrant {
  realmId: string;
  clientId: string;
  subjectId: string;
  scope: string;
  audience: string[];
  sessionId?: string | null;
}

export function tokenGrantRepository(tx: RealmScopedDatabase) {
  return {
    async create(input: NewTokenGrant): Promise<TokenGrantRecord> {
      const rows = await tx
        .insert(tokenGrants)
        .values({
          id: newId(),
          realmId: input.realmId,
          clientId: input.clientId,
          subjectId: input.subjectId,
          scope: input.scope,
          audience: input.audience,
          sessionId: input.sessionId ?? null,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into token_grants returned no row');
      }
      return toRecord(row);
    },

    // RFC 6749 §4.1.2: on detected authorization-code reuse, the tokens
    // issued from the first (legitimate) redemption are revoked, not just
    // the replay rejected. Idempotent — revoking an already-revoked grant
    // is a no-op, not an error.
    async revoke(id: string, revokedAt: Date): Promise<void> {
      await tx.update(tokenGrants).set({ revokedAt }).where(eq(tokenGrants.id, id));
    },

    async byId(id: string): Promise<TokenGrantRecord | null> {
      const rows = await tx.select().from(tokenGrants).where(eq(tokenGrants.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Logout's whole write. Returns the number revoked so a caller can tell
    // "ended a session that had grants" from "ended one that had none"
    // without a second query; an already-revoked grant is matched again and
    // simply re-stamped, which keeps this idempotent.
    async revokeForSession(sessionId: string, revokedAt: Date): Promise<number> {
      const rows = await tx
        .update(tokenGrants)
        .set({ revokedAt })
        .where(eq(tokenGrants.sessionId, sessionId))
        .returning({ id: tokenGrants.id });
      return rows.length;
    },

    async bySession(sessionId: string): Promise<TokenGrantRecord[]> {
      const rows = await tx.select().from(tokenGrants).where(eq(tokenGrants.sessionId, sessionId));
      return rows.map(toRecord);
    },
  };
}
