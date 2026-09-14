// RFC 9068 §2.2.3.1 authorises a mapper to add `roles`/`groups` to the
// access token, not to override the envelope this registers itself —
// `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `client_id` and `scope`.
// Registered claims are spread last for exactly that reason.
export function withRegisteredClaimsWinning(
  mapped: Record<string, unknown>,
  registered: Record<string, unknown>,
): Record<string, unknown> {
  return { ...mapped, ...registered };
}
