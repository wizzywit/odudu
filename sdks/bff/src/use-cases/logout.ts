import type { Browser } from '#/repository/browser';
import type { IdentityProvider } from '#/repository/identity-provider';
import type { Sessions } from '#/repository/sessions';
import type { Handler } from '#/types';

// Ends the session here, then hands the browser the address that ends it at
// the issuer. The address holds no token. The session is gone even when it
// cannot be made.
export function createLogout(
  browser: Browser,
  sessions: Sessions,
  identity: IdentityProvider,
): Handler {
  return async (request) => {
    const id = browser.sessionIdOf(request);
    const session = id === undefined ? undefined : await sessions.loadSession(id);
    if (id !== undefined) await sessions.dropSession(id);
    if (session === undefined) return browser.loggedOut(undefined);
    return browser.loggedOut(await identity.signOut().catch(() => undefined));
  };
}
