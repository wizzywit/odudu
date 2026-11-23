export interface CookieSpec {
  name: string;
  value: string;
  // Omitted for a session cookie that ends with the browser.
  maxAgeSeconds?: number;
}

// Every cookie the BFF sets has the attributes `__Host-` demands (Secure,
// Path=/, no Domain) and is HttpOnly. SameSite=Lax rather than Strict because
// the sign-in comes back from the issuer as a cross-site navigation that must
// still carry the login cookie.
const FIXED = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export function setCookie(spec: CookieSpec): string {
  const age = spec.maxAgeSeconds === undefined ? '' : `; Max-Age=${String(spec.maxAgeSeconds)}`;
  return `${spec.name}=${spec.value}; ${FIXED}${age}`;
}

export function clearCookie(name: string): string {
  return `${name}=; ${FIXED}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// The value of one cookie from a `Cookie` header. A name sent twice is
// ambiguous, so it reads as absent.
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 ? values[0] : undefined;
}
