import type { Change } from '#/services/return-plan';

// The answer with a new `Location` and more cookies, the rest as it was. A new
// response is made, so one a library handed back as read-only is no obstacle,
// and `Set-Cookie` lines stay separate.
export function applyChange(response: Response, change: Change): Response {
  if (change.location === undefined && change.cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  if (change.location !== undefined) headers.set('location', change.location);
  for (const cookie of change.cookies) headers.append('set-cookie', cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

export function setCookiesOf(response: Response): string[] {
  return response.headers.getSetCookie();
}
