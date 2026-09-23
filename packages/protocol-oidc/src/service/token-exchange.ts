import { parseResource } from '#/service/resource-indicator';

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

function single(raw: string | string[] | undefined): string | undefined | 'many' {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw.length > 1 ? 'many' : raw[0];
  return raw;
}

export function resolveExchangeAudience(input: {
  resource: string | string[] | undefined;
  audience: string | string[] | undefined;
  ceiling: readonly string[];
  issuedType: ExchangeTokenType;
}): { kind: 'ok'; audience: readonly string[] } | { kind: 'invalid_target' } {
  const resource = single(input.resource);
  const audience = single(input.audience);
  if (resource === 'many' || audience === 'many') return { kind: 'invalid_target' };

  // An ID token is addressed to the client that asked for it; there is no
  // target to choose, so naming one is a mistake rather than a preference.
  if (input.issuedType === 'id_token') {
    return resource === undefined && audience === undefined
      ? { kind: 'ok', audience: [] }
      : { kind: 'invalid_target' };
  }

  if (resource !== undefined && audience !== undefined && resource !== audience) {
    return { kind: 'invalid_target' };
  }

  const named = resource ?? audience;
  if (named === undefined) return { kind: 'ok', audience: input.ceiling };
  if (resource !== undefined) {
    const outcome = parseResource(resource, input.ceiling);
    return outcome.kind === 'invalid_target' ? outcome : { kind: 'ok', audience: outcome.audience };
  }
  return input.ceiling.includes(named)
    ? { kind: 'ok', audience: [named] }
    : { kind: 'invalid_target' };
}
