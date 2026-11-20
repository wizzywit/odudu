import { cookieHeaderOf, empty, json, redirect, text } from '#/adapter/http';
import { clearCookie, readCookie, setCookie } from '#/services/cookies';
import { isSessionId } from '#/services/session-id';
import { LOGIN_TTL_MS } from '#/services/session-policy';
import type { BffConfig } from '#/services/config';
import type { Gate } from '#/services/gate';

// What the BFF reads from a request and writes to a response in the browser's
// terms: its two cookies and the answers to them.
export interface Browser {
  sessionIdOf(request: Request): string | undefined;
  loginIdOf(request: Request): string | undefined;
  refused(gate: Exclude<Gate, 'ok'>, allow: 'GET' | 'POST'): Response;
  redirectToIssuer(url: string, loginId: string): Response;
  signedIn(sessionId: string): Response;
  signInFailed(status: 400 | 502): Response;
  claims(claims: unknown): Response;
  anonymous(): Response;
  sessionEnded(): Response;
  loggedOut(redirectTo: string | undefined): Response;
  unavailable(): Response;
}

export function createBrowser(config: BffConfig): Browser {
  const clearSession = clearCookie(config.cookieName);
  const clearLogin = clearCookie(config.loginCookieName);
  const idIn = (request: Request, name: string): string | undefined => {
    const value = readCookie(cookieHeaderOf(request), name);
    return isSessionId(value) ? value : undefined;
  };
  return {
    sessionIdOf: (request) => idIn(request, config.cookieName),
    loginIdOf: (request) => idIn(request, config.loginCookieName),
    refused: (gate, allow) => (gate === 'forbidden' ? empty(403) : empty(405, [], { allow })),
    redirectToIssuer: (url, loginId) =>
      redirect(url, [
        setCookie({
          name: config.loginCookieName,
          value: loginId,
          maxAgeSeconds: LOGIN_TTL_MS / 1000,
        }),
      ]),
    signedIn: (sessionId) =>
      redirect(config.afterSignInPath, [
        setCookie({ name: config.cookieName, value: sessionId }),
        clearLogin,
      ]),
    signInFailed: (status) => text(status, 'Sign-in failed.', [clearLogin]),
    claims: (claims) => json(200, { authenticated: true, claims }),
    anonymous: () => json(200, { authenticated: false }),
    sessionEnded: () => json(401, { authenticated: false }, [clearSession]),
    loggedOut: (redirectTo) =>
      redirectTo === undefined
        ? empty(204, [clearSession])
        : json(200, { redirectTo }, [clearSession]),
    unavailable: () => empty(503, [], { 'retry-after': '5' }),
  };
}
