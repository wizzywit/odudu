// Exact string comparison, deliberately. OAuth 2.1 requires it, and every
// normalization added here — trailing slashes, case folding, ignoring a
// query string — widens what an attacker can register into.
export function isRegisteredRedirectUri(presented: string, registered: readonly string[]): boolean {
  return registered.includes(presented);
}
