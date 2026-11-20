import { refreshWasRefused } from '#/services/session-policy';
import type { Browser } from '#/repository/browser';
import type { Sessions } from '#/repository/sessions';
import type { SessionAccess } from '#/use-cases/session-access';
import type { Handler } from '#/types';

// Says whether the browser is signed in and who it is. Never a token. A
// session whose refresh token the issuer refuses is over: it is deleted and
// the answer is 401.
export function createSession(
  browser: Browser,
  sessions: Sessions,
  access: SessionAccess,
): Handler {
  return async (request) => {
    const found = await access.load(request);
    if (found === undefined) return browser.anonymous();
    try {
      const session = await access.fresh(found.id, found.session);
      return browser.claims(session.tokens.claims);
    } catch (error) {
      if (!refreshWasRefused(error)) return browser.unavailable();
      await sessions.dropSession(found.id);
      return browser.sessionEnded();
    }
  };
}
