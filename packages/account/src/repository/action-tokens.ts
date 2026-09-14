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

// No realm setting supplies a default for this column — every insert states
// it, the same as authorizationCodeRepository.create does.
export interface IssueActionToken {
  realmId: string;
  subjectId: string;
  type: ActionTokenType;
  email?: string;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

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
      const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
      await tx.insert(actionTokens).values({
        id: newId(),
        realmId: input.realmId,
        subjectId: input.subjectId,
        type: input.type,
        tokenHash: sha256Hex(token),
        email: input.email ?? null,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
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
  };
}
