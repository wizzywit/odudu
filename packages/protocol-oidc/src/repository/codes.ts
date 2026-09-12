import { type RealmScopedDatabase } from '@odudu/db';
import { eq, sql } from 'drizzle-orm';
import { authorizationCodes, type AuthorizationCodeRecord } from '#/schema/authorization-codes';

// The shape a raw `tx.execute(sql\`...\`)` returns: driver rows keyed by
// their actual (snake_case) column names, not drizzle's mapped camelCase —
// unlike `.select()`, a raw statement bypasses that mapping.
// `auth_time`/`expires_at`/`consumed_at` are typed `string` here, not
// `Date`: a raw `tx.execute(sql\`...\`)` bypasses whatever type parsing
// `.select()` gets from drizzle, and postgres-js hands a raw statement's
// timestamptz columns back as ISO strings — confirmed against the real
// container (an unconverted value fails `.getTime()` downstream).
interface RawAuthorizationCodeRow {
  code_hash: string;
  realm_id: string;
  client_id: string;
  subject_id: string;
  redirect_uri: string;
  scope: string;
  nonce: string | null;
  code_challenge: string;
  code_challenge_method: string;
  auth_time: string;
  expires_at: string;
  consumed_at: string | null;
  grant_id: string | null;
}

function toRecord(row: RawAuthorizationCodeRow): AuthorizationCodeRecord {
  return {
    codeHash: row.code_hash,
    realmId: row.realm_id,
    clientId: row.client_id,
    subjectId: row.subject_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    nonce: row.nonce,
    codeChallenge: row.code_challenge,
    codeChallengeMethod:
      row.code_challenge_method as AuthorizationCodeRecord['codeChallengeMethod'],
    authTime: new Date(row.auth_time),
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at === null ? null : new Date(row.consumed_at),
    grantId: row.grant_id,
  };
}

export interface NewAuthorizationCode {
  codeHash: string;
  realmId: string;
  clientId: string;
  subjectId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authTime: Date;
  expiresAt: Date;
}

export function authorizationCodeRepository(tx: RealmScopedDatabase) {
  return {
    async create(input: NewAuthorizationCode): Promise<void> {
      await tx.insert(authorizationCodes).values({
        ...input,
        consumedAt: null,
        grantId: null,
      });
    },

    // One statement, not check-then-set: the database picks the winner and
    // the loser gets zero rows. Two statements here — "is it consumed?" then
    // "mark it consumed" — is a race a mocked database would never show.
    async consume(codeHash: string): Promise<AuthorizationCodeRecord | null> {
      const rows = await tx.execute(sql`
        UPDATE authorization_codes
           SET consumed_at = now()
         WHERE code_hash = ${codeHash}
           AND consumed_at IS NULL
           AND expires_at > now()
        RETURNING *
      `);
      const row = (rows as unknown as RawAuthorizationCodeRow[])[0];
      return row === undefined ? null : toRecord(row);
    },

    // Binds the row to the grant it was redeemed into, so a later reader
    // can trace a code back to the tokens it produced (and, on replay,
    // which grant to revoke).
    async attachGrant(codeHash: string, grantId: string): Promise<void> {
      await tx.execute(sql`
        UPDATE authorization_codes SET grant_id = ${grantId} WHERE code_hash = ${codeHash}
      `);
    },

    // Read-only, and never part of the redemption decision itself: consumed
    // reuse detection reaches for this only after `consume` has already
    // returned null, to find the grant a replayed code points at so it can
    // be revoked. Ordinary `.select()`, so drizzle maps the columns back to
    // camelCase itself — unlike `consume`'s raw `RETURNING *`.
    async byHash(codeHash: string): Promise<AuthorizationCodeRecord | null> {
      const rows = await tx
        .select()
        .from(authorizationCodes)
        .where(eq(authorizationCodes.codeHash, codeHash));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        ...row,
        codeChallengeMethod:
          row.codeChallengeMethod as AuthorizationCodeRecord['codeChallengeMethod'],
      };
    },
  };
}

// Standalone export of the redemption contract —
// `consumeAuthorizationCode(tx, codeHash)` — for callers that do not need
// the rest of the repository, e.g. the concurrency test that redeems
// directly against a transaction.
export async function consumeAuthorizationCode(
  tx: RealmScopedDatabase,
  codeHash: string,
): Promise<AuthorizationCodeRecord | null> {
  return authorizationCodeRepository(tx).consume(codeHash);
}
