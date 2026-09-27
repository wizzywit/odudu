import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { clientRegistrationTokens } from '#/schema/client-registration-tokens';

// Copied from action-tokens.ts: 32 random bytes, base64url-encoded to 43
// characters of 256 bits, comfortably above what a mailed or pasted
// single-use credential needs to resist guessing.
function generateRegistrationToken(): string {
  return randomBytes(32).toString('base64url');
}

// Not a slow hash: the input already carries 256 bits of entropy, so this
// exists only to keep the plaintext out of storage, and the value must be
// findable by its digest rather than compared against a stored secret.
function sha256Hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface MintClientRegistrationToken {
  tenantId: string;
  // RFC 7591 §3 permits a multi-use token; remaining_uses has no default in
  // the schema, so a caller that omits this is refused rather than guessed
  // at.
  uses: number;
  ttlSeconds: number;
}

export interface MintedClientRegistrationToken {
  id: string;
  token: string;
  remainingUses: number;
  expiresAt: Date;
}

// The admin console's own representation of a minted token: never the hash,
// and never the plaintext once mint() has answered it.
export interface RegistrationTokenRecord {
  id: string;
  remainingUses: number;
  createdAt: Date;
  expiresAt: Date;
}

export function clientRegistrationTokenRepository(tx: TenantScopedDatabase) {
  return {
    async mint(input: MintClientRegistrationToken): Promise<MintedClientRegistrationToken> {
      const id = newId();
      const token = generateRegistrationToken();
      const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
      await tx.insert(clientRegistrationTokens).values({
        id,
        tenantId: input.tenantId,
        tokenHash: sha256Hex(token),
        remainingUses: input.uses,
        expiresAt,
      });
      return { id, token, remainingUses: input.uses, expiresAt };
    },

    // Excludes a spent or expired token — the admin console's list is a
    // list of what still redeems, not an archive of everything ever minted.
    // Paged in SQL like every sibling list (`listKeys`,
    // #/usecase/keys.ts in @odudu/protocol-admin): `after` is the last id
    // of the previous page, never an id this method requires still exist —
    // a page anchored on a token that has since expired, been spent out or
    // been revoked still resumes correctly, since `gt(id, after)` reads
    // only the ordering, not the row itself.
    async list(input: {
      after?: string | undefined;
      limit: number;
    }): Promise<RegistrationTokenRecord[]> {
      return tx
        .select({
          id: clientRegistrationTokens.id,
          remainingUses: clientRegistrationTokens.remainingUses,
          createdAt: clientRegistrationTokens.createdAt,
          expiresAt: clientRegistrationTokens.expiresAt,
        })
        .from(clientRegistrationTokens)
        .where(
          and(
            gt(clientRegistrationTokens.remainingUses, 0),
            gt(clientRegistrationTokens.expiresAt, new Date()),
            ...(input.after === undefined ? [] : [gt(clientRegistrationTokens.id, input.after)]),
          ),
        )
        .orderBy(asc(clientRegistrationTokens.id))
        .limit(input.limit);
    },

    // Live rows only: a token already spent to zero uses or expired is
    // already unusable, and `list()` would already have hidden it — a
    // revoke of one answers `not_found` (mapped to `404` by the route) the
    // same way revoking an id nothing ever minted does, rather than a
    // hollow `204` for a row `DELETE ... RETURNING` still finds and
    // removes but that no longer redeemed anything.
    async revoke(id: string): Promise<RegistrationTokenRecord | null> {
      const rows = await tx
        .delete(clientRegistrationTokens)
        .where(
          and(
            eq(clientRegistrationTokens.id, id),
            gt(clientRegistrationTokens.remainingUses, 0),
            gt(clientRegistrationTokens.expiresAt, new Date()),
          ),
        )
        .returning({
          id: clientRegistrationTokens.id,
          remainingUses: clientRegistrationTokens.remainingUses,
          createdAt: clientRegistrationTokens.createdAt,
          expiresAt: clientRegistrationTokens.expiresAt,
        });
      return rows[0] ?? null;
    },

    // One UPDATE decides the winner between concurrent registrations
    // against the same token: two transactions racing a one-use token can
    // each only see remaining_uses > 0 once, since the second sees the
    // first's decrement as soon as it commits. `tenantId` is carried in the
    // WHERE alongside the token hash, but the isolation this method
    // actually depends on is client_registration_tokens_isolation, applied
    // by Postgres to the UPDATE itself — a caller-supplied tenantId is not
    // what stops a token minted in another tenant from being spent here.
    async spend(tenantId: string, token: string): Promise<boolean> {
      const hash = sha256Hex(token);
      const rows = await tx
        .update(clientRegistrationTokens)
        .set({ remainingUses: sql`${clientRegistrationTokens.remainingUses} - 1` })
        .where(
          and(
            eq(clientRegistrationTokens.tenantId, tenantId),
            eq(clientRegistrationTokens.tokenHash, hash),
            gt(clientRegistrationTokens.remainingUses, 0),
            gt(clientRegistrationTokens.expiresAt, new Date()),
          ),
        )
        .returning({ id: clientRegistrationTokens.id });
      return rows.length > 0;
    },
  };
}
