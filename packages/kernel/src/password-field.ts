/**
 * Counted in code points, as `password_min_length` is counted in
 * `evaluatePassword`, so one number describes both ends of the range.
 * ASVS 2.1.2 asks that at least 64 characters be permitted and allows
 * denying more than 128; this is double the point at which denial becomes
 * permissible, and still bounds the attacker-controlled input to the key
 * derivation at about a kilobyte of UTF-8. ADR 0023 says why the limit
 * lives here rather than in the realm's password policy.
 */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Shaped like `@odudu/domain-identity`'s `PolicyViolation` so a page can
 * list it beside the realm's own rules, without a domain package owning a
 * limit that exists to bound work rather than to shape passwords.
 */
export const PASSWORD_TOO_LONG = {
  rule: 'max-length',
  message: `Password must be at most ${String(MAX_PASSWORD_LENGTH)} characters long.`,
} as const;

export type PasswordField =
  | { readonly kind: 'present'; readonly password: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'too_long' };

/**
 * Every route that reads a password out of a form body reads it through
 * here, so a fifth reader cannot skip the maximum. A repeated field is
 * `absent` — `@fastify/formbody` parses one into an array, and a password
 * arrives once. An empty value is `present`: whether a blank field is an
 * attempt differs between the routes.
 */
export function readPasswordField(value: string | string[] | undefined): PasswordField {
  if (typeof value !== 'string') return { kind: 'absent' };
  // Array.from iterates by code point exactly as a spread would, without
  // tripping @typescript-eslint/no-misused-spread.
  if (Array.from(value).length > MAX_PASSWORD_LENGTH) return { kind: 'too_long' };
  return { kind: 'present', password: value };
}
