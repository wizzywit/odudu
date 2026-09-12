import { type RealmScopedDatabase } from '@odudu/db';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';

export type RotationOutcome =
  | { readonly kind: 'rotated'; readonly grant: TokenGrantRecord; readonly next: string }
  | { readonly kind: 'reused'; readonly revokedFamily: string }
  | { readonly kind: 'unknown' };

// The single entry point for redeeming a refresh token. `consume` is one
// atomic UPDATE, so two concurrent presentations of the same token cannot
// both win — exactly like authorizationCodeRepository(tx).consume. Reuse
// detection and family revocation happen inside the same `tx` this function
// was called with, as one unit: a reuse detected but not revoked because a
// later statement failed would be worse than not detecting it at all.
//
// Whether the *caller* (the requesting client) actually owns this token —
// client match, subject enabled, requested scope — is not decided here, so
// that it can stay a pure, query-free function with its own direct unit
// tests (evaluateRefreshGrant). The usecase runs it on both sides of this
// call: once before, so a request that cannot succeed never marks a token
// used, and once after, against the grant this transaction read.
export async function rotateRefreshToken(
  tx: RealmScopedDatabase,
  presentedHash: string,
  now: Date,
  refreshTokenTtlSeconds: number,
): Promise<RotationOutcome> {
  const consumed = await refreshTokenRepository(tx).consume(presentedHash);

  if (consumed === null) {
    // Could be unknown, expired, or already used — the caller must not be
    // able to tell which (RFC 6749 §5.2). Only "already used" is reuse, and
    // only reuse has a family to revoke.
    const existing = await refreshTokenRepository(tx).byHash(presentedHash);
    if (existing === null) return { kind: 'unknown' };
    if (existing.usedAt === null) return { kind: 'unknown' };

    await tokenGrantRepository(tx).revoke(existing.grantId, now);
    return { kind: 'reused', revokedFamily: existing.grantId };
  }

  const grant = await tokenGrantRepository(tx).byId(consumed.grantId);
  if (grant === null) {
    throw new Error(`refresh token ${presentedHash} references a nonexistent grant`);
  }

  const next = generateRefreshToken();
  const nextHash = hashRefreshToken(next);
  await refreshTokenRepository(tx).create({
    tokenHash: nextHash,
    realmId: grant.realmId,
    grantId: grant.id,
    expiresAt: new Date(now.getTime() + refreshTokenTtlSeconds * 1000),
  });
  await refreshTokenRepository(tx).attachReplacement(presentedHash, nextHash);

  return { kind: 'rotated', grant, next };
}
