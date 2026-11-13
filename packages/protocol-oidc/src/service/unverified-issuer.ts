// The issuer a JWT names, read before its signature is checked: trusted only to
// choose which tenant's keys to verify against, and re-read from the verified
// payload afterwards.
export function unverifiedIssuer(token: string): string | undefined {
  const segments = token.split('.');
  const segment = segments[1];
  if (segments.length !== 3 || segment === undefined || segment.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const iss = (parsed as Record<string, unknown>).iss;
  return typeof iss === 'string' && iss.length > 0 ? iss : undefined;
}
