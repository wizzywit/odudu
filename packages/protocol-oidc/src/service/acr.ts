// IANA Authentication Method Reference Values registry (RFC 8176 §2),
// consulted 2026-09-15 — see docs/protocols/oidc-core.md's reading note for
// what was checked and why `recovery-code` has no entry here. `passkey`
// maps to both `hwk` (possession of the private key) and `user` (the
// platform authenticator's own presence/verification step), matching how
// WebAuthn assertions are commonly reported under this claim.
const AMR_VALUES: Readonly<Record<string, readonly string[]>> = {
  password: ['pwd'],
  otp: ['otp'],
  passkey: ['hwk', 'user'],
};

// Sorted so the result is stable regardless of which order the underlying
// authenticators ran in, the same guarantee `roles`/`groups` already give
// their claims.
export function amrFor(authenticators: readonly string[]): string[] {
  const values = new Set<string>();
  for (const name of authenticators) {
    for (const value of AMR_VALUES[name] ?? []) values.add(value);
  }
  return [...values].sort();
}

// A passkey assertion is itself two factors — possession of the key plus
// the platform's own user verification — so it counts as two here even
// when it is the only authenticator the login ran.
const FACTOR_COUNT: Readonly<Record<string, number>> = {
  passkey: 2,
};

export function acrFor(authenticators: readonly string[]): string {
  const factors = authenticators.reduce((sum, name) => sum + (FACTOR_COUNT[name] ?? 1), 0);
  return factors >= 2 ? '2' : '1';
}
