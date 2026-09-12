import { type RealmScopedDatabase } from '@odudu/db';
import { eq, sql } from 'drizzle-orm';
import { refreshTokens, type RefreshTokenRecord } from '#/schema/refresh-tokens';

export type { RefreshTokenRecord } from '#/schema/refresh-tokens';

// The shape a raw `tx.execute(sql\`...\`)` returns: driver rows keyed by
// their actual (snake_case) column names, not drizzle's mapped camelCase —
// see codes.ts's RawAuthorizationCodeRow for why, and why the timestamp
// columns are typed `string` here rather than `Date`.
interface RawRefreshTokenRow {
  token_hash: string;
  realm_id: string;
  grant_id: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  replaced_by: string | null;
}

function toRecord(row: RawRefreshTokenRow): RefreshTokenRecord {
  return {
    tokenHash: row.token_hash,
    realmId: row.realm_id,
    grantId: row.grant_id,
    issuedAt: new Date(row.issued_at),
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at === null ? null : new Date(row.used_at),
    replacedBy: row.replaced_by,
  };
}

export interface NewRefreshToken {
  tokenHash: string;
  realmId: string;
  grantId: string;
  expiresAt: Date;
}

export function refreshTokenRepository(tx: RealmScopedDatabase) {
  return {
    async create(input: NewRefreshToken): Promise<RefreshTokenRecord> {
      const rows = await tx
        .insert(refreshTokens)
        .values({
          tokenHash: input.tokenHash,
          realmId: input.realmId,
          grantId: input.grantId,
          expiresAt: input.expiresAt,
          usedAt: null,
          replacedBy: null,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into refresh_tokens returned no row');
      }
      return {
        tokenHash: row.tokenHash,
        realmId: row.realmId,
        grantId: row.grantId,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        replacedBy: row.replacedBy,
      };
    },

    // One statement, not check-then-set: the database picks the winner of
    // two concurrent redemptions of the same token, exactly like
    // authorizationCodeRepository(tx).consume. Returns the row as it stood
    // the instant it was marked used, or null if it was already used,
    // expired, or never existed — the caller cannot tell which from this
    // alone, which is `byHash`'s job.
    async consume(tokenHash: string): Promise<RefreshTokenRecord | null> {
      const rows = await tx.execute(sql`
        UPDATE refresh_tokens
           SET used_at = now()
         WHERE token_hash = ${tokenHash}
           AND used_at IS NULL
           AND expires_at > now()
        RETURNING *
      `);
      const row = (rows as unknown as RawRefreshTokenRow[])[0];
      return row === undefined ? null : toRecord(row);
    },

    // Read-only, and never the thing that marks a token spent — that is
    // `consume`'s single UPDATE alone. Two callers read it. The grant gate
    // in usecase/token-issuance.ts reads it *before* rotation, to decide
    // from the presented token whether the request can succeed at all, so
    // that one which cannot never consumes anything. Reuse detection reads
    // it *after* `consume` has returned null, to tell an already-used token
    // (reuse — revoke the family) from one that never existed or already
    // expired (unknown).
    async byHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      const rows = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash));
      return rows[0] ?? null;
    },

    // Bookkeeping only, set after a successful rotation — nothing in the
    // rotation decision reads it back.
    async attachReplacement(tokenHash: string, replacedBy: string): Promise<void> {
      await tx
        .update(refreshTokens)
        .set({ replacedBy })
        .where(eq(refreshTokens.tokenHash, tokenHash));
    },
  };
}
