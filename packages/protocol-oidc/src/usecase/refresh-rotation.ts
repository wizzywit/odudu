import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type RealmScopedDatabase } from '@odudu/db';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';

export type RotationOutcome =
  | { readonly kind: 'rotated'; readonly grant: TokenGrantRecord; readonly next: string }
  | { readonly kind: 'reused'; readonly revokedFamily: string }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'unknown' };

// The single entry point for redeeming a refresh token. `consume` is one
// atomic UPDATE, so two concurrent presentations cannot both win — exactly
// like authorizationCodeRepository(tx).consume. Reuse detection and family
// revocation happen inside the caller's `tx` as one unit: a reuse detected
// but not revoked because a later statement failed would be worse than not
// detecting it at all. Whether the requesting client owns this token is
// decided by evaluateRefreshGrant, on both sides of this call — ADR 0019.
export async function rotateRefreshToken(
  tx: RealmScopedDatabase,
  presentedHash: string,
  now: Date,
  refreshTokenTtlSeconds: number,
  lifespans: SessionLifespans,
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
  // A revoked family issues nothing further. The presented token was
  // consumed above and stays consumed: a logout or a detected reuse ends
  // the family, and rotating one more token out of it would undo that.
  if (grant.revokedAt !== null) {
    return { kind: 'revoked' };
  }

  // A session-bound family lives exactly as long as its session: an idle
  // timeout that a refresh could out-live would not be an idle timeout. An
  // offline family has no session and is therefore bounded only by its own
  // TTL and by retention.
  if (grant.sessionId !== null) {
    const session = await sessionRepository(tx).liveById(grant.sessionId, lifespans, now);
    if (session === null) return { kind: 'revoked' };
    await sessionRepository(tx).touch(grant.sessionId, now);
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
