// An unsigned JWT for a test of what a reader makes of its claims. Nothing
// that verifies a signature may be given one.
export function jwtOf(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'at+jwt' })}.${part(claims)}.`;
}
