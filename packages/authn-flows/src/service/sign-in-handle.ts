import { createHash, randomBytes } from 'node:crypto';
import { addressPath, isUuid, type TenantAddress } from '@odudu/kernel';

// What ties a browser to the sign-in it parked. The cookie is not a login
// credential and authorises no write: it only lets a mailed link find out
// that this browser is the one that started the sign-in it refers to.
// `Path` is the tenant's, so it cannot use the `__Host-` prefix, which
// requires `Path=/`; `__Secure-` is the strongest prefix that allows a path.
export function signInHandleName(tls: boolean): string {
  return tls ? '__Secure-odudu-sign-in' : 'odudu-sign-in';
}

// 32 random bytes: the 256 bits a bearer credential needs. The row holds only
// the hash, so a database read yields nothing a cookie can be forged from.
export function newSignInSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSignInSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function handleCookie(address: TenantAddress, tls: boolean, value: string, maxAge: number): string {
  return [
    `${signInHandleName(tls)}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=${addressPath(address, '/')}`,
    ...(tls ? ['Secure'] : []),
    `Max-Age=${String(maxAge)}`,
  ].join('; ');
}

export function signInHandleCookie(
  address: TenantAddress,
  tls: boolean,
  sessionId: string,
  secret: string,
  maxAgeSeconds: number,
): string {
  return handleCookie(address, tls, `${sessionId}.${secret}`, maxAgeSeconds);
}

// The same name, path and attributes with an expiry: a browser drops a cookie
// only when the clearing one matches how it was set.
export function clearedSignInHandleCookie(address: TenantAddress, tls: boolean): string {
  return handleCookie(address, tls, '', 0);
}

export interface SignInHandle {
  readonly sessionId: string;
  readonly secret: string;
}

const SECRET = /^[A-Za-z0-9_-]{1,128}$/u;

// A value that is not exactly `<uuid>.<secret>` is skipped, and every pair of
// the name is tried: a planted duplicate (another Domain or Path) must not
// hide the valid one, and each candidate is still checked against the row.
export function readSignInHandle(header: string | undefined, tls: boolean): SignInHandle | null {
  if (header === undefined) return null;
  const name = signInHandleName(tls);
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1 || pair.slice(0, index).trim() !== name) continue;
    const [sessionId, secret, ...rest] = pair
      .slice(index + 1)
      .trim()
      .split('.');
    if (rest.length > 0 || sessionId === undefined || secret === undefined) continue;
    if (isUuid(sessionId) && SECRET.test(secret)) return { sessionId, secret };
  }
  return null;
}
