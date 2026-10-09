import { CONSOLE_LOGIN_SECONDS } from '#/service/session-lifetime';

const RESTART_SECONDS = 60;

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

// Set when a refused callback begins the sign-in again, so a second refusal
// inside its minute shows the page rather than looping through the provider.
export function restartCookieName(tls: boolean): string {
  return tls ? '__Host-odudu-console-restart' : 'odudu-console-restart';
}

export function restartCookie(tls: boolean): string {
  return cookie(
    restartCookieName(tls),
    '1',
    ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${String(RESTART_SECONDS)}`],
    tls,
  );
}

export function clearedRestartCookie(tls: boolean): string {
  return cookie(
    restartCookieName(tls),
    '',
    ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'],
    tls,
  );
}

export function sessionCookie(value: string, tls: boolean): string {
  return cookie(sessionCookieName(tls), value, ['HttpOnly', 'SameSite=Strict', 'Path=/'], tls);
}

export function clearedSessionCookie(tls: boolean): string {
  return cookie(
    sessionCookieName(tls),
    '',
    ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'],
    tls,
  );
}

// A name present twice answers nothing: a cookie planted beside ours, by a
// sibling subdomain or over plain HTTP, is indistinguishable from it here,
// and taking either one lets the planter choose which session is used.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  const values = header.split(';').flatMap((pair) => {
    const index = pair.indexOf('=');
    return index !== -1 && pair.slice(0, index).trim() === name
      ? [pair.slice(index + 1).trim()]
      : [];
  });
  const [value] = values;
  return values.length === 1 && value !== '' ? value : undefined;
}
