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

const MANY = Symbol('many');

function single(raw: string | string[] | undefined): string | undefined | typeof MANY {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw.length > 1 ? MANY : raw[0];
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
  if (resource === MANY || audience === MANY) return { kind: 'invalid_target' };

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

// RFC 8693 does not require the issued scope to be a subset of the subject
// token's; this server requires it as policy, because the agent layer's
// attenuation check is the consumer and a widening exchange would make that
// check unenforceable. Case-sensitive, per RFC 6749 §3.3.
export function attenuateScope(
  requested: string,
  granted: readonly string[],
): { kind: 'ok'; scope: readonly string[] } | { kind: 'widened' } {
  const asked = [...new Set(requested.split(' ').filter((entry) => entry !== ''))];
  if (asked.length === 0) return { kind: 'ok', scope: granted };
  const held = new Set(granted);
  return asked.every((entry) => held.has(entry))
    ? { kind: 'ok', scope: asked }
    : { kind: 'widened' };
}

export interface ActClaim {
  sub: string;
  act?: ActClaim;
}

// A cap rather than a tenant setting: the configurable form belongs with
// the agent layer's max_depth, which also owns the chain's other bounds.
export const MAX_DELEGATION_DEPTH = 8;

// `unknown`, not a cast: a prior `act` arrives from a verified token's
// payload, which jose types as JWTPayload's index signature.
function narrowAct(value: unknown, budget: number): ActClaim | 'malformed' | 'too_deep' {
  if (budget <= 0) return 'too_deep';
  if (typeof value !== 'object' || value === null) return 'malformed';
  const sub = (value as { sub?: unknown }).sub;
  if (typeof sub !== 'string' || sub === '') return 'malformed';
  const nested = (value as { act?: unknown }).act;
  if (nested === undefined) return { sub };
  const inner = narrowAct(nested, budget - 1);
  if (inner === 'malformed' || inner === 'too_deep') return inner;
  return { sub, act: inner };
}

export function buildActChain(
  actorSubject: string,
  priorAct: unknown,
): { kind: 'ok'; act: ActClaim } | { kind: 'too_deep' } | { kind: 'malformed' } {
  if (priorAct === undefined) return { kind: 'ok', act: { sub: actorSubject } };
  const inner = narrowAct(priorAct, MAX_DELEGATION_DEPTH - 1);
  if (inner === 'too_deep') return { kind: 'too_deep' };
  if (inner === 'malformed') return { kind: 'malformed' };
  return { kind: 'ok', act: { sub: actorSubject, act: inner } };
}

// The read side of a persisted `token_grants.act_chain` (jsonb, therefore
// unknown): a grant's own value, exactly as `buildActChain` produced it, or
// null for anything that does not parse as one — absent, malformed, or
// deeper than a chain this issuer ever mints.
export function narrowActClaim(value: unknown): ActClaim | null {
  if (value === null || value === undefined) return null;
  const inner = narrowAct(value, MAX_DELEGATION_DEPTH);
  return inner === 'malformed' || inner === 'too_deep' ? null : inner;
}

// RFC 8693 §4.4 authorises a party "to become the actor", so the comparison
// is against whoever the issued token will name in `act` — the actor
// token's subject under delegation, the requesting client under
// impersonation. Nothing mints this claim yet; a later increment does.
export function mayActPermits(mayAct: unknown, actorSubject: string): boolean {
  if (mayAct === undefined) return true;
  if (typeof mayAct !== 'object' || mayAct === null) return false;
  const sub = (mayAct as { sub?: unknown }).sub;
  return typeof sub === 'string' && sub === actorSubject;
}
