import { callbackFailureStatus } from '#/services/session-policy';
import { newSessionId } from '#/services/session-id';
import type { Browser } from '#/repository/browser';
import type { IdentityProvider } from '#/repository/identity-provider';
import type { Sessions } from '#/repository/sessions';
import type { Handler } from '#/types';

// Finishes a sign-in: the login record is spent whatever happens, and a new
// session id is made every time, so no id the browser held before survives.
export function createCallback(
  browser: Browser,
  sessions: Sessions,
  identity: IdentityProvider,
  now: () => number,
): Handler {
  return async (request) => {
    const loginId = browser.loginIdOf(request);
    const login = loginId === undefined ? undefined : await sessions.takeLogin(loginId);
    if (login === undefined) return browser.signInFailed(400);
    try {
      const tokens = await identity.complete(request.url, login.pending);
      const previous = browser.sessionIdOf(request);
      if (previous !== undefined) await sessions.dropSession(previous);
      const sessionId = newSessionId();
      await sessions.saveSession(sessionId, { kind: 'session', tokens, createdAt: now() });
      return browser.signedIn(sessionId);
    } catch (error) {
      return browser.signInFailed(callbackFailureStatus(error));
    }
  };
}
