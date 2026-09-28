import { CONSOLE_LOGIN_SECONDS } from '#/service/session-lifetime';

// ADR 0020: a __Host- cookie needs Secure, which plain HTTP cannot carry,
// so the name follows TLS. __Host- also requires Path=/, which is why the
// login cookie is not scoped to /console/auth.
export function loginCookieName(tls: boolean): string {
  return tls ? '__Host-odudu-console-login' : 'odudu-console-login';
}

export function sessionCookieName(tls: boolean): string {
  return tls ? '__Host-odudu-console' : 'odudu-console';
}

function cookie(name: string, value: string, attributes: readonly string[], tls: boolean): string {
  return [`${name}=${value}`, ...attributes, ...(tls ? ['Secure'] : [])].join('; ');
}

// Lax rather than Strict: the callback that reads it arrives as a
// top-level redirect back from the authorization endpoint.
export function loginCookie(state: string, tls: boolean): string {
  return cookie(
    loginCookieName(tls),
    state,
    ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${String(CONSOLE_LOGIN_SECONDS)}`],
    tls,
  );
}

export function clearedLoginCookie(tls: boolean): string {
  return cookie(loginCookieName(tls), '', ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'], tls);
}

export function sessionCookie(value: string, tls: boolean): string {
  return cookie(sessionCookieName(tls), value, ['HttpOnly', 'SameSite=Strict', 'Path=/'], tls);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1 || pair.slice(0, index).trim() !== name) continue;
    const value = pair.slice(index + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}
