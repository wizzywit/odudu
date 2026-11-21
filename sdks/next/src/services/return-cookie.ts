import { clearCookie, readCookie, setCookie } from '@odudu-io/bff/shared';
import { safeReturnTo } from '#/services/return-to';

const TEN_MINUTES_SECONDS = 600;

export function returnCookieName(cookieName: string): string {
  return `${cookieName}-return`;
}

export function setReturnCookie(name: string, target: string): string {
  return setCookie({ name, value: encodeURIComponent(target), maxAgeSeconds: TEN_MINUTES_SECONDS });
}

export function clearReturnCookie(name: string): string {
  return clearCookie(name);
}

// The path the return cookie holds, checked again: the cookie is the browser's,
// so it is read as input however it came to be set.
export function returnTargetOf(
  header: string | null,
  name: string,
  mount: string,
): string | undefined {
  const raw = readCookie(header, name);
  if (raw === undefined) return undefined;
  try {
    return safeReturnTo(decodeURIComponent(raw), mount);
  } catch {
    return undefined;
  }
}
