import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { actionTokens, type ActionTokenRecord, type ActionTokenType } from '#/schema/action-tokens';

// 32 random bytes, base64url-encoded to 43 characters: 256 bits of entropy,
// comfortably above what a mailed, single-use credential needs to resist
// guessing.
function generateActionToken(): string {
  return randomBytes(32).toString('base64url');
}

// Not a slow/comparison-safe hash: the input already carries 256 bits of
// entropy, so this exists only to keep the plaintext out of storage (a
// backup, a log, or a SQL injection elsewhere yields nothing redeemable),
// not to survive a brute-force search over a small keyspace.
function sha256Hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ttlSeconds carries no default: `verify_email` and `reset_password` tokens
// have very different exposure profiles (a day-long password-reset window
// is an account-takeover window), so a caller states the value it means
// rather than inheriting one invisibly. See VERIFY_EMAIL_TTL_SECONDS and
// RESET_PASSWORD_TTL_SECONDS in #/usecase/verify-email.
export interface IssueActionToken {
  realmId: string;
  subjectId: string;
  type: ActionTokenType;
  email?: string;
  ttlSeconds: number;
}

function toRecord(row: typeof actionTokens.$inferSelect): ActionTokenRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    type: row.type as ActionTokenType,
    tokenHash: row.tokenHash,
    email: row.email,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

export function actionTokenRepository(tx: RealmScopedDatabase) {
  return {
    async issue(input: IssueActionToken): Promise<{ token: string }> {
      const token = generateActionToken();
      await tx.insert(actionTokens).values({
        id: newId(),
        realmId: input.realmId,
        subjectId: input.subjectId,
        type: input.type,
        tokenHash: sha256Hex(token),
        email: input.email ?? null,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
        consumedAt: null,
      });
      return { token };
    },

    // One UPDATE decides the winner between two concurrent redemptions.
    // The row is kept afterwards: nothing in this codebase deletes expired
    // state, and retention is decided once for every table that has it
    // (ADR 0021).
    async consume(token: string, type: ActionTokenType): Promise<ActionTokenRecord | null> {
      const hash = sha256Hex(token);
      const rows = await tx
        .update(actionTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(actionTokens.tokenHash, hash),
            eq(actionTokens.type, type),
            isNull(actionTokens.consumedAt),
            gt(actionTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // A read, never a write: the action-token route uses this to learn
    // what kind of link a redeemer is holding — a reset-password link needs
    // a form shown before anything is consumed, unlike a verify-email link,
    // which consumes on the same GET. Not filtered by type, since the
    // caller does not know the type yet; still excludes an already-consumed
    // or expired row, so a peek never reports a link as usable when a
    // redemption attempt would refuse it.
    async peek(token: string): Promise<ActionTokenRecord | null> {
      const hash = sha256Hex(token);
      const rows = await tx
        .select()
        .from(actionTokens)
        .where(
          and(
            eq(actionTokens.tokenHash, hash),
            isNull(actionTokens.consumedAt),
            gt(actionTokens.expiresAt, new Date()),
          ),
        );
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },
  };
}
