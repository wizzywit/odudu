import { unwrapSecret, wrapSecret } from '@odudu/crypto';
import { isLockNotAvailable, withTenant, type DatabaseHandle } from '@odudu/db';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { type OduduPort } from '#/service/odudu-port';
import { accessNeedsRefresh } from '#/service/session-lifetime';
import { type Semaphore } from '#/service/semaphore';
import { type SingleFlight } from '#/service/single-flight';

export type FreshToken =
  | { readonly kind: 'ok'; readonly accessToken: string }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable' };

export interface FreshTokenDeps {
  readonly database: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly odudu: OduduPort;
  /** One refresh per session at a time in this process, keyed by session id. */
  readonly refreshes: SingleFlight<string, FreshToken>;
  /** Bounds the refreshes holding a pooled connection at once, across sessions. */
  readonly refreshSlots: Semaphore;
}

// A refresh token is spent by its use, and presenting it twice revokes the
// grant. So the refresh runs holding the session's row lock, and whoever
// waited on that lock reads the row again and uses what it finds.
export async function freshAccessToken(
  deps: FreshTokenDeps,
  session: ConsoleSessionRecord,
  now: Date,
  ip: string,
): Promise<FreshToken> {
  if (!accessNeedsRefresh(session, now)) {
    return { kind: 'ok', accessToken: unwrapSecret(session.accessTokenWrapped, deps.kek) };
  }
  return deps.refreshes(session.id, () =>
    deps.refreshSlots(() => refreshOrGiveUp(deps, session, now, ip)),
  );
}

async function refreshOrGiveUp(
  deps: FreshTokenDeps,
  session: ConsoleSessionRecord,
  now: Date,
  ip: string,
): Promise<FreshToken> {
  try {
    return await refreshUnderLock(deps, session, now, ip);
  } catch (error: unknown) {
    if (isLockNotAvailable(error)) return { kind: 'unavailable' };
    throw error;
  }
}

async function refreshUnderLock(
  deps: FreshTokenDeps,
  session: ConsoleSessionRecord,
  now: Date,
  ip: string,
): Promise<FreshToken> {
  return withTenant(deps.database.db, session.tenantId, async (tx) => {
    const sessions = consoleSessionRepository(tx);
    const locked = await sessions.lockById(session.id);
    if (locked === null) return { kind: 'ended' };
    if (!accessNeedsRefresh(locked, now)) {
      return { kind: 'ok', accessToken: unwrapSecret(locked.accessTokenWrapped, deps.kek) };
    }

    const tenant = await tenantNameRepository(tx).nameOf(locked.tenantId);
    if (tenant === null) return { kind: 'ended' };
    const outcome = await deps.odudu.refresh(
      tenant,
      unwrapSecret(locked.refreshTokenWrapped, deps.kek),
      ip,
    );
    if (outcome.kind === 'refused') {
      await sessions.delete(locked.id);
      return { kind: 'ended' };
    }
    if (outcome.kind === 'failed') return { kind: 'unavailable' };

    const { tokens } = outcome;
    await sessions.replaceTokens(locked.id, {
      accessTokenWrapped: wrapSecret(tokens.accessToken, deps.kek),
      refreshTokenWrapped: wrapSecret(tokens.refreshToken, deps.kek),
      accessExpiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
    });
    return { kind: 'ok', accessToken: tokens.accessToken };
  });
}
