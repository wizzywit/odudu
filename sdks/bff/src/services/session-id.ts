const ID_BYTES = 32;
const ID_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

// 256 random bits, base64url.
export function newSessionId(fill: (bytes: Uint8Array) => Uint8Array = fillRandom): string {
  const bytes = fill(new Uint8Array(ID_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function fillRandom(bytes: Uint8Array): Uint8Array {
  return crypto.getRandomValues(bytes);
}

// A cookie that is not an id this module could have made never reaches the
// store.
export function isSessionId(value: string | undefined): value is string {
  return value !== undefined && ID_SHAPE.test(value);
}

export const sessionKey = (id: string): string => `session:${id}`;
export const loginKey = (id: string): string => `login:${id}`;
export const lockKey = (id: string): string => `lock:${id}`;
