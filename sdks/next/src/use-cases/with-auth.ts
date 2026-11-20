import { answerAccess } from '#/repository/access-response';
import { createSignedInCheck } from '#/repository/signed-in';
import { decideAccess, loginRedirectPath } from '#/services/auth-gate';
import { checkLocalPath, checkMountPath, DEFAULT_COOKIE_NAME } from '#/services/config';
import type { WithAuthOptions } from '#/types';
import type { NextRequest, NextResponse } from 'next/server.js';

const DEFAULT_MOUNT_PATH = '/api/auth';

// The function for a `proxy.ts` (`middleware.ts` before Next 16): it sends a
// request for a protected path that has no session to the BFF's login route,
// with the page it asked for as `returnTo`.
export function withAuth(
  options: WithAuthOptions,
): (request: NextRequest) => Promise<NextResponse> {
  const mountPath = checkMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  const loginPath = checkLocalPath(options.loginPath ?? `${mountPath}/login`, 'loginPath');
  const signedIn = createSignedInCheck(options.cookieName ?? DEFAULT_COOKIE_NAME, options.store);

  return async (request) => {
    const { pathname, search } = request.nextUrl;
    const verdict = await decideAccess({
      pathname,
      paths: options.paths,
      mountPath,
      signedIn: signedIn(request),
    });
    return answerAccess(verdict, request, () => loginRedirectPath(loginPath, pathname, search));
  };
}
