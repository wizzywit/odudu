import { answerAccess } from '#/repository/access-response';
import { createSignedInCheck } from '#/repository/signed-in';
import { decideAccess, loginRedirectPath } from '#/services/auth-gate';
import { resolveAuthConfig } from '#/services/config';
import type { WithAuthOptions } from '#/types';
import type { NextRequest, NextResponse } from 'next/server.js';

// The function for a `proxy.ts` (`middleware.ts` before Next 16): it sends a
// request for a protected path that has no session to the BFF's login route,
// with the page it asked for as `returnTo`.
//
// Without a `store` this is a gate for the page, not authorization: anyone can
// send a cookie shaped like a session id. Authorize with `getSession()` in the
// server component or handler. A `store` also looks the id up, nothing more.
export function withAuth(
  options: WithAuthOptions,
): (request: NextRequest) => Promise<NextResponse> {
  const config = resolveAuthConfig(options);
  const signedIn = createSignedInCheck(config.cookieName, options.store);

  return async (request) => {
    const { pathname, search } = request.nextUrl;
    const verdict = await decideAccess({
      pathname,
      paths: options.paths,
      mountPath: config.mountPath,
      signedIn: signedIn(request),
    });
    return answerAccess(verdict, request, () =>
      loginRedirectPath(config.loginPath, pathname, search),
    );
  };
}
