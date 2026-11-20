const NO_STORE = { 'cache-control': 'no-store' };

function withCookies(headers: Record<string, string>, cookies: string[]): Headers {
  const result = new Headers(headers);
  for (const cookie of cookies) result.append('set-cookie', cookie);
  return result;
}

export function cookieHeaderOf(request: Request): string | null {
  return request.headers.get('cookie');
}

export function redirect(location: string, cookies: string[]): Response {
  return new Response(null, {
    status: 302,
    headers: withCookies({ location, ...NO_STORE }, cookies),
  });
}

export function json(status: number, body: unknown, cookies: string[] = []): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCookies({ 'content-type': 'application/json', ...NO_STORE }, cookies),
  });
}

export function text(status: number, body: string, cookies: string[] = []): Response {
  return new Response(body, {
    status,
    headers: withCookies({ 'content-type': 'text/plain; charset=utf-8', ...NO_STORE }, cookies),
  });
}

export function empty(
  status: number,
  cookies: string[] = [],
  extra: Record<string, string> = {},
): Response {
  const headers = withCookies({ ...NO_STORE }, cookies);
  Object.entries(extra).forEach(([name, value]) => {
    headers.set(name, value);
  });
  return new Response(null, { status, headers });
}
