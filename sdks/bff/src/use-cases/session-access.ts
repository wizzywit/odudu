import { needsRefresh } from '#/services/session-policy';
import { createInFlight } from '#/repository/in-flight';
import type { Browser } from '#/repository/browser';
import type { IdentityProvider } from '#/repository/identity-provider';
import type { Sessions } from '#/repository/sessions';
import type { SignedInSession } from '#/types';

export interface SessionAccess {
  // The session the request's cookie names, when it names a live one.
  load(request: Request): Promise<{ id: string; session: SignedInSession } | undefined>;
  // The session with tokens that are good for use: renewed when they are about
  // to expire. Concurrent calls for one session make one refresh request. Throws
  // what the refresh throws. Undefined when the session ended meanwhile, in
  // which case nothing is written back.
  fresh(id: string, session: SignedInSession): Promise<SignedInSession | undefined>;
}

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

  return {
    async load(request) {
      const id = browser.sessionIdOf(request);
      const session = id === undefined ? undefined : await sessions.loadSession(id);
      return id === undefined || session === undefined ? undefined : { id, session };
    },
    fresh: (id, session) =>
      needsRefresh(session.tokens, now()) ? once(id, () => renew(id)) : Promise.resolve(session),
  };
}
