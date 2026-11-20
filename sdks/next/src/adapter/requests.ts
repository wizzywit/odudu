// The header the BFF requires on a read of the session, so that a page of
// another origin cannot make the browser send one.
const BFF_HEADER = 'x-odudu-bff';
// The BFF reads a request's headers and not its address for the session.
const SESSION_URL = 'http://odudu.invalid/session';

export function pathnameOf(request: Request): string {
  return new URL(request.url).pathname;
}

export function returnToOf(request: Request): string | null {
  return new URL(request.url).searchParams.get('returnTo');
}

export function cookieHeaderOf(request: Request): string | null {
  return request.headers.get('cookie');
}

// A read of the session as the browser's own request would make it.
export function sessionRequest(cookieHeader: string): Request {
  return new Request(SESSION_URL, { headers: { cookie: cookieHeader, [BFF_HEADER]: '1' } });
}
