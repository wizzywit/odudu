import { StdioError } from '#/service/stdio-error';
import { z } from 'zod';

export interface TokenSet {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly refreshToken?: string;
  // What the token endpoint said it granted; the access token's own claim is
  // what is judged.
  readonly scope: readonly string[];
}

export interface TokenExpectation {
  readonly issuer: string;
  readonly audience: string;
  // The one MCP scope this run asked for.
  readonly scope: 'mcp:read' | 'mcp:write';
}

// No token is believed to live longer than this, whatever the server says.
const MAX_LIFETIME_SECONDS = 3600;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export function tokenSetFrom(body: unknown, now: Date): TokenSet {
  const parsed = tokenResponse.safeParse(body);
  if (!parsed.success) {
    throw new StdioError(
      'mcp_token_invalid',
      'the token endpoint answered with something that is not a token response',
    );
  }
  const response = parsed.data;
  if (response.token_type.toLowerCase() !== 'bearer') {
    throw new StdioError(
      'mcp_token_invalid',
      'the token endpoint issued a token that is not a bearer token',
    );
  }
  const stated = now.getTime() + Math.min(response.expires_in, MAX_LIFETIME_SECONDS) * 1000;
  const claimed = claimsOf(response.access_token).exp;
  const exp = typeof claimed === 'number' && Number.isFinite(claimed) ? claimed * 1000 : stated;
  return {
    accessToken: response.access_token,
    expiresAt: new Date(Math.min(stated, exp)),
    ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
    scope: response.scope === undefined ? [] : response.scope.split(' ').filter((s) => s !== ''),
  };
}

// The claims of a JWT access token, unverified: the admin API verifies the
// signature on every call, and this only decides whether a token is worth
// sending there at all.
function claimsOf(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (token.split('.').length !== 3 || payload === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

// The scopes the access token itself claims, which is what the admin API reads.
function claimedScopes(set: TokenSet): string[] {
  const claim = claimsOf(set.accessToken).scope;
  return typeof claim === 'string' ? claim.split(' ').filter((s) => s !== '') : [];
}

// Every scope the token holds, by its own claim and by the endpoint's say-so.
export function scopeOf(set: TokenSet): string[] {
  return [...new Set([...claimedScopes(set), ...set.scope])];
}

export function holdsWrite(set: TokenSet): boolean {
  return scopeOf(set).includes('mcp:write');
}

// Refuses a token the admin API of this tenant should never be sent: another
// issuer's, one not for the admin API, one whose own scope claim lacks what this run
// asked for, and in a read-only run one that carries the write scope. The messages
// name no token.
export function acceptTokenSet(set: TokenSet, expected: TokenExpectation): void {
  const claims = claimsOf(set.accessToken);
  if (claims.iss !== expected.issuer) {
    throw new StdioError(
      'mcp_token_refused',
      "the access token was not issued by this tenant's issuer",
    );
  }
  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(expected.audience)) {
    throw new StdioError(
      'mcp_token_refused',
      'the access token is not for the admin API (audience)',
    );
  }
  const held = scopeOf(set);
  if (!claimedScopes(set).includes(expected.scope)) {
    throw new StdioError(
      'mcp_token_refused',
      `the access token does not carry the scope ${expected.scope}`,
    );
  }
  if (expected.scope === 'mcp:read' && held.includes('mcp:write')) {
    throw new StdioError(
      'mcp_token_refused',
      'a read-only run was issued a token that carries mcp:write',
    );
  }
}
