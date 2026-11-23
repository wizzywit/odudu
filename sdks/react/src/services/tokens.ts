import type { AudienceToken, TokenSet } from '@odudu-io/oidc';

export const SKEW_MS = 30_000;

// Where the token for `resource` is filed: by the audience, and by the issuer
// when the sign-in named none.
export function audienceKey(tokens: TokenSet, resource: string | undefined): string {
  return resource ?? tokens.issuer;
}

export function isFresh(entry: AudienceToken, now: number): boolean {
  return entry.expiresAt - SKEW_MS > now;
}
