// What the WWW-Authenticate header of a refusal says (RFC 6750 §3). A refused
// token is told `invalid_token` and nothing about which check refused it.
export function missingCredentials(): string {
  return 'Bearer';
}

export function invalidToken(): string {
  return 'Bearer error="invalid_token"';
}

export function insufficientScope(scope: string): string {
  return `Bearer error="insufficient_scope", scope="${scope}"`;
}
