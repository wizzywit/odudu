import { narrowActClaim } from '@odudu/protocol-oidc';

// What a verified "me" access token stands for, read from its claims.
export interface MeTokenClaims {
  readonly subjectId: string;
  readonly clientId: string;
  // Absent when the grant has no session (an `offline_access` grant).
  readonly sessionId: string | null;
  readonly scopes: string[];
  // The RFC 8693 `act` claim marks a token minted for an agent.
  readonly isAgent: boolean;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// The issuer a JWT names, read before its signature is checked and trusted for
// nothing but choosing which of the tenant's issuers to verify against.
export function unverifiedIssuer(token: string): string | undefined {
  const segments = token.split('.');
  const segment = segments[1];
  if (segments.length !== 3 || segment === undefined || segment.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return nonEmpty((parsed as Record<string, unknown>).iss);
  } catch {
    return undefined;
  }
}

// Null when a claim the door stands on is missing or unreadable. A present but
// malformed `act` is refused, never read as absent: it would turn an agent's
// token into a person's.
export function meTokenClaims(payload: Record<string, unknown>): MeTokenClaims | null {
  const subjectId = nonEmpty(payload.sub);
  const clientId = nonEmpty(payload.client_id);
  if (subjectId === undefined || clientId === undefined) return null;
  if (payload.scope !== undefined && typeof payload.scope !== 'string') return null;
  if (payload.act !== undefined && narrowActClaim(payload.act) === null) return null;
  return {
    subjectId,
    clientId,
    sessionId: nonEmpty(payload.sid) ?? null,
    scopes: (payload.scope ?? '').split(' ').filter((s) => s.length > 0),
    isAgent: payload.act !== undefined,
  };
}
