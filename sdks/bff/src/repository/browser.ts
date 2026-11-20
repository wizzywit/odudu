import type { UpstreamOutcome } from '#/adapter/upstream';
import { cookieHeaderOf, empty, json, redirect, text } from '#/adapter/http';
import { clearCookie, readCookie, setCookie } from '#/services/cookies';
import { isSessionId } from '#/services/session-id';
import { LOGIN_TTL_MS } from '#/services/session-policy';
import type { BffConfig } from '#/services/config';
import type { Gate } from '#/services/gate';
import type { Route } from '#/services/proxy-route';

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
  // The answers of the proxy that no other route gives.
  proxyRefused(route: ProxyRefusal): Response;
  // Why a proxied call has no session to run under.
  noSession(kind: 'anonymous' | 'ended' | 'unavailable'): Response;
  // Why a session's tokens cannot serve the upstream called.
  noToken(kind: 'not-granted' | 'expired'): Response;
  // What the browser is told of the upstream's answer or of its failure.
  upstreamAnswer(outcome: UpstreamOutcome): Response;
}

export type ProxyRefusal = Exclude<Route, { kind: 'target' }>;

const UPSTREAM_FAILURES = {
  'too-large': { status: 413, message: 'The body is too large.' },
  'answer-too-large': { status: 502, message: 'The upstream answer is too large.' },
  timeout: { status: 504, message: 'The upstream did not answer in time.' },
  failed: { status: 502, message: 'The upstream could not be reached.' },
} as const;

function upstreamFailure(kind: keyof typeof UPSTREAM_FAILURES): Response {
  return text(UPSTREAM_FAILURES[kind].status, UPSTREAM_FAILURES[kind].message);
}

const NOT_AUTHENTICATED = (): Response => json(401, { authenticated: false });

export function createBrowser(config: BffConfig): Browser {
  const clearSession = clearCookie(config.cookieName);
  const NO_SESSION = {
    anonymous: NOT_AUTHENTICATED,
    ended: () => json(401, { authenticated: false }, [clearSession]),
    unavailable: () => empty(503, [], { 'retry-after': '5' }),
  };
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
    proxyRefused: (route) =>
      route.kind === 'method-not-allowed'
        ? empty(405, [], { allow: route.allow })
        : empty(route.kind === 'forbidden' ? 403 : 404),
    noSession: (kind) => NO_SESSION[kind](),
    noToken: (kind) => (kind === 'expired' ? NOT_AUTHENTICATED() : upstreamFailure('failed')),
    upstreamAnswer: (outcome) =>
      outcome.kind === 'response' ? outcome.response : upstreamFailure(outcome.kind),
  };
}
