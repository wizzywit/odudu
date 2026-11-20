export function pathnameOf(request: Request): string {
  return new URL(request.url).pathname;
}

export function returnToOf(request: Request): string | null {
  return new URL(request.url).searchParams.get('returnTo');
}

export function cookieHeaderOf(request: Request): string | null {
  return request.headers.get('cookie');
}
