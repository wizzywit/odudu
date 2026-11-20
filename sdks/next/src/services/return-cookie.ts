import { safeReturnTo } from '#/services/return-to';

const FIXED = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const TEN_MINUTES_SECONDS = 600;

export function returnCookieName(cookieName: string): string {
  return `${cookieName}-return`;
}

export function setReturnCookie(name: string, target: string): string {
  return `${name}=${encodeURIComponent(target)}; ${FIXED}; Max-Age=${String(TEN_MINUTES_SECONDS)}`;
}

export function clearReturnCookie(name: string): string {
  return `${name}=; ${FIXED}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// The raw value of one cookie in a `Cookie` header. A name sent twice is
// ambiguous, so it reads as absent.
export function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 ? values[0] : undefined;
}

// The path the return cookie holds, checked again: the cookie is the browser's,
// so it is read as input however it came to be set.
export function returnTargetOf(
  header: string | null,
  name: string,
  mount: string,
): string | undefined {
  const raw = cookieValue(header, name);
  if (raw === undefined) return undefined;
  try {
    return safeReturnTo(decodeURIComponent(raw), mount);
  } catch {
    return undefined;
  }
}
