import type { Browser } from '#/repository/browser';
import type { SessionAccess } from '#/use-cases/session-access';
import type { Handler } from '#/types';

// Says whether the browser is signed in and who it is. Never a token. A
// session whose refresh token the issuer refuses is over: it is deleted and
// the answer is 401.
export function createSession(browser: Browser, access: SessionAccess): Handler {
  return async (request) => {
    const usable = await access.usable(request);
    switch (usable.kind) {
      case 'session':
        return browser.claims(usable.session.tokens.claims);
      case 'ended':
        return browser.sessionEnded();
      case 'unavailable':
        return browser.unavailable();
      default:
        return browser.anonymous();
    }
  };
}
