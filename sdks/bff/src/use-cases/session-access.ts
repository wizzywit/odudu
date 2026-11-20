import { isExpiredForGood, needsRefresh, refreshWasRefused } from '#/services/session-policy';
import { createInFlight } from '#/repository/in-flight';
import type { Browser } from '#/repository/browser';
import type { IdentityProvider } from '#/repository/identity-provider';
import type { Sessions } from '#/repository/sessions';
import type { SignedInSession } from '#/types';

export interface SessionAccess {
  // The session of the request with tokens good for use, renewed when they are
  // about to expire; concurrent calls for one session make one refresh request.
  // When there is none, why: `anonymous` (no live session, or one that ended
  // meanwhile), `ended` (the issuer refused the refresh token, so the session
  // is deleted) or `unavailable` (the refresh failed for a reason that says
  // nothing about the grant, so the session is kept).
  usable(request: Request): Promise<Usable>;
}

export type Usable =
  { kind: 'session'; session: SignedInSession } | { kind: 'anonymous' | 'ended' | 'unavailable' };

export function createSessionAccess(
  browser: Browser,
  sessions: Sessions,
  identity: IdentityProvider,
  now: () => number,
): SessionAccess {
  const once = createInFlight<SignedInSession | undefined>();

  // Reads the session again inside the flight: a caller that loaded it before
  // an earlier refresh finished must not spend the refresh token that refresh
  // already replaced. It reads once more after the refresh, because a logout
  // that ran meanwhile must not be undone by writing the session back.
  async function renew(id: string): Promise<SignedInSession | undefined> {
    const current = await sessions.loadSession(id);
    if (current === undefined || !needsRefresh(current.tokens, now())) return current;
    const tokens = await identity.refresh(current.tokens);
    const stillThere = await sessions.loadSession(id);
    if (stillThere === undefined) return undefined;
    const next = { ...stillThere, tokens };
    await sessions.saveSession(id, next);
    return next;
  }

  async function fresh(id: string, session: SignedInSession): Promise<SignedInSession | undefined> {
    return needsRefresh(session.tokens, now()) ? once(id, () => renew(id)) : session;
  }

  return {
    async usable(request) {
      const id = browser.sessionIdOf(request);
      const found = id === undefined ? undefined : await sessions.loadSession(id);
      if (id === undefined || found === undefined) return { kind: 'anonymous' };
      try {
        const session = await fresh(id, found);
        if (session === undefined) return { kind: 'anonymous' };
        if (!isExpiredForGood(session.tokens, now())) return { kind: 'session', session };
        await sessions.dropSession(id);
        return { kind: 'ended' };
      } catch (error) {
        if (!refreshWasRefused(error)) return { kind: 'unavailable' };
        await sessions.dropSession(id);
        return { kind: 'ended' };
      }
    },
  };
}
