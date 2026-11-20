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
  // what the refresh throws.
  fresh(id: string, session: SignedInSession): Promise<SignedInSession>;
}

export function createSessionAccess(
  browser: Browser,
  sessions: Sessions,
  identity: IdentityProvider,
  now: () => number,
): SessionAccess {
  const once = createInFlight<SignedInSession>();

  // Reads the session again inside the flight: a caller that loaded it before
  // an earlier refresh finished must not spend the refresh token that refresh
  // already replaced.
  async function renew(id: string, loaded: SignedInSession): Promise<SignedInSession> {
    const current = (await sessions.loadSession(id)) ?? loaded;
    if (!needsRefresh(current.tokens, now())) return current;
    const next = { ...current, tokens: await identity.refresh(current.tokens) };
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
      needsRefresh(session.tokens, now())
        ? once(id, () => renew(id, session))
        : Promise.resolve(session),
  };
}
