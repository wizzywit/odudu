import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, gt, sql } from 'drizzle-orm';
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

export function clientRegistrationTokenRepository(tx: TenantScopedDatabase) {
  return {
    async mint(input: MintClientRegistrationToken): Promise<{ token: string }> {
      const token = generateRegistrationToken();
      await tx.insert(clientRegistrationTokens).values({
        id: newId(),
        tenantId: input.tenantId,
        tokenHash: sha256Hex(token),
        remainingUses: input.uses,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      });
      return { token };
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
