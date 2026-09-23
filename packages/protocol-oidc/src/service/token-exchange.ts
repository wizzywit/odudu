export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

export type ExchangeTokenType = 'access_token' | 'refresh_token' | 'id_token';

export type TokenTypeOutcome = ExchangeTokenType | 'refused' | 'deferred' | 'unknown';

const ACCEPTED: Record<string, ExchangeTokenType> = {
  'urn:ietf:params:oauth:token-type:access_token': 'access_token',
  'urn:ietf:params:oauth:token-type:refresh_token': 'refresh_token',
  'urn:ietf:params:oauth:token-type:id_token': 'id_token',
};

const DEFERRED = new Set([
  'urn:ietf:params:oauth:token-type:saml1',
  'urn:ietf:params:oauth:token-type:saml2',
]);

// `:jwt` is refused rather than unimplemented: this issuer signs four kinds
// of JWT (at+jwt, logout+jwt, userinfo+jwt, and typ-absent ID tokens), and a
// type meaning "any JWT this issuer signed" would accept all four
// interchangeably.
export function parseTokenType(raw: string): TokenTypeOutcome {
  const accepted = ACCEPTED[raw];
  if (accepted !== undefined) return accepted;
  if (raw === 'urn:ietf:params:oauth:token-type:jwt') return 'refused';
  if (DEFERRED.has(raw)) return 'deferred';
  return 'unknown';
}
