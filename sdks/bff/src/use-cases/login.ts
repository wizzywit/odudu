import { newSessionId } from '#/services/session-id';
import type { Browser } from '#/repository/browser';
import type { IdentityProvider } from '#/repository/identity-provider';
import type { Sessions } from '#/repository/sessions';
import type { Handler } from '#/types';

// Starts a sign-in. The only GET that writes anything: a login record, kept
// ten minutes and bound to this browser by the login cookie.
export function createLogin(
  browser: Browser,
  sessions: Sessions,
  identity: IdentityProvider,
  now: () => number,
): Handler {
  return async () => {
    const { url, pending } = await identity.begin();
    const loginId = newSessionId();
    await sessions.saveLogin(loginId, { kind: 'login', pending, createdAt: now() });
    return browser.redirectToIssuer(url, loginId);
  };
}
