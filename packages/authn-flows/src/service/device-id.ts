import { createHash } from 'node:crypto';

const ID_BYTES = 16;
const ID_SHAPE = /^[A-Za-z0-9_-]{22}$/u;
// The longest lifetime a browser keeps a cookie for.
const MAX_AGE_SECONDS = 34_560_000;

// The value of a browser's device cookie: random and opaque, so it groups
// sessions and authorises nothing. A forged value only names a group of the
// forger's own sessions, because admission reads it for the subject signing
// in and the lists show a digest of it, never the value.
export function newDeviceId(random: () => Uint8Array): string {
  const bytes = random();
  if (bytes.length < ID_BYTES) {
    throw new RangeError(`a device id needs ${String(ID_BYTES)} random bytes`);
  }
  return Buffer.from(bytes.subarray(0, ID_BYTES)).toString('base64url');
}

// What a session row stores and a list shows: the cookie value cannot be
// recovered from it, so reading a list never yields a value a browser sends.
export function deviceDigest(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export function deviceCookieName(tenant: string, tls: boolean): string {
  return tls ? `__Host-${tenant}-device` : `${tenant}-device`;
}

export function deviceCookie(tenant: string, tls: boolean, id: string): string {
  return [
    `${deviceCookieName(tenant, tls)}=${id}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    ...(tls ? ['Secure'] : []),
    `Max-Age=${String(MAX_AGE_SECONDS)}`,
  ].join('; ');
}

// Every pair of the name is tried, so a planted duplicate of the wrong shape
// cannot hide the one the server set.
export function readDeviceId(
  header: string | undefined,
  tenant: string,
  tls: boolean,
): string | null {
  if (header === undefined) return null;
  const name = deviceCookieName(tenant, tls);
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1 || pair.slice(0, index).trim() !== name) continue;
    const value = pair.slice(index + 1).trim();
    if (ID_SHAPE.test(value)) return value;
  }
  return null;
}
