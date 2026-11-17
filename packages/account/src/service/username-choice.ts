// The three values of the tenant setting `registration_username`
// (REGISTRATION_USERNAME_CHOICES in @odudu/contracts, which this package does
// not depend on).
export type RegistrationUsernameMode = 'required' | 'optional' | 'generated';

export type UsernameChoice =
  | { readonly kind: 'use'; readonly username: string }
  | { readonly kind: 'generate' }
  | { readonly kind: 'missing' };

/** How often a registration retries a generated handle that collides. */
export const HANDLE_ATTEMPTS = 3;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const HANDLE_CHARACTERS = 10;

/** `u-` and ten base32 characters (50 bits) from the first ten bytes, five bits each. */
export function generateHandle(bytes: Uint8Array): string {
  if (bytes.length < HANDLE_CHARACTERS) {
    throw new RangeError(`a handle needs ${String(HANDLE_CHARACTERS)} random bytes`);
  }
  let handle = 'u-';
  for (let i = 0; i < HANDLE_CHARACTERS; i += 1) {
    handle += ALPHABET.charAt((bytes[i] ?? 0) & 31);
  }
  return handle;
}

export function chooseUsername(
  mode: RegistrationUsernameMode,
  posted: string | undefined,
): UsernameChoice {
  if (mode === 'generated') return { kind: 'generate' };
  if (mode === 'required') {
    return posted === undefined || posted === ''
      ? { kind: 'missing' }
      : { kind: 'use', username: posted };
  }
  return posted === undefined || posted.trim() === ''
    ? { kind: 'generate' }
    : { kind: 'use', username: posted };
}
