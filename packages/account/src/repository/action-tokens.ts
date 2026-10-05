import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
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
// is an account-takeover window), so a caller states the value it means —
// the tenant's own, through `lifetimeOf`, rather than one inherited
// invisibly.
export interface IssueActionToken {
  tenantId: string;
  subjectId: string;
  type: ActionTokenType;
  email?: string;
  actions?: readonly string[];
  redirectUri?: string | null;
  ttlSeconds: number;
}

function toRecord(row: typeof actionTokens.$inferSelect): ActionTokenRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectId: row.subjectId,
    type: row.type as ActionTokenType,
    tokenHash: row.tokenHash,
    email: row.email,
    actions: row.actions,
    redirectUri: row.redirectUri,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

export function actionTokenRepository(tx: TenantScopedDatabase) {
  return {
    // The tenant's lifetime for a link of this type
    // (packages/db/drizzle/0082_tenant_lifetimes.sql). A link taking its
    // subject through required actions signs them in by their mailbox, as a
    // reset link does, so it takes the reset link's lifetime.
    async lifetimeOf(tenantId: string, type: ActionTokenType): Promise<number> {
      const rows = await tx
        .select({
          verifyEmail: tenants.verifyEmailTtlSeconds,
          resetPassword: tenants.resetPasswordTtlSeconds,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const row = rows[0];
      if (row === undefined) throw new Error(`tenant ${tenantId} is not visible here`);
      return type === 'verify_email' ? row.verifyEmail : row.resetPassword;
    },

    async issue(input: IssueActionToken): Promise<{ token: string }> {
      const token = generateActionToken();
      await tx.insert(actionTokens).values({
        id: newId(),
        tenantId: input.tenantId,
        subjectId: input.subjectId,
        type: input.type,
        tokenHash: sha256Hex(token),
        email: input.email ?? null,
        actions: input.actions === undefined ? null : [...input.actions],
        redirectUri: input.redirectUri ?? null,
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

    // Called alongside a successful consume, in the same transaction:
    // whatever sets a subject's password retires every other outstanding
    // link that could set it — each reset link, and each actions link naming
    // `update-password` — or a second mailed link stays redeemable after the
    // owner has regained the account. Rows already consumed are untouched.
    async invalidateOutstandingPasswordLinks(subjectId: string): Promise<void> {
      await tx
        .update(actionTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(actionTokens.subjectId, subjectId),
            isNull(actionTokens.consumedAt),
            or(
              eq(actionTokens.type, 'reset_password'),
              and(
                eq(actionTokens.type, 'execute_actions'),
                sql`'update-password' = ANY(${actionTokens.actions})`,
              ),
            ),
          ),
        );
    },
  };
}
