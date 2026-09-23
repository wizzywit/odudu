import { describe, expect, it } from 'vitest';
import {
  attenuateScope,
  buildActChain,
  MAX_DELEGATION_DEPTH,
  mayActPermits,
  narrowActClaim,
  parseTokenType,
  resolveExchangeAudience,
} from '#/service/token-exchange';

describe('[ODUDU-TOKEN-EXCHANGE-TYPES-01] RFC 8693 §3 token type identifiers', () => {
  it.each([
    ['urn:ietf:params:oauth:token-type:access_token', 'access_token'],
    ['urn:ietf:params:oauth:token-type:refresh_token', 'refresh_token'],
    ['urn:ietf:params:oauth:token-type:id_token', 'id_token'],
  ])('accepts %s', (urn, expected) => {
    expect(parseTokenType(urn)).toBe(expected);
  });

  // Refused on purpose, not unimplemented: this server signs at+jwt,
  // logout+jwt, userinfo+jwt and typ-absent ID tokens, and a type meaning
  // "any JWT this issuer signed" would accept all four interchangeably.
  it('refuses the generic jwt type', () => {
    expect(parseTokenType('urn:ietf:params:oauth:token-type:jwt')).toBe('refused');
  });

  it.each(['urn:ietf:params:oauth:token-type:saml1', 'urn:ietf:params:oauth:token-type:saml2'])(
    'defers %s until SAML assertions exist',
    (urn) => {
      expect(parseTokenType(urn)).toBe('deferred');
    },
  );

  it('treats anything else as unknown', () => {
    expect(parseTokenType('https://example.test/token-type')).toBe('unknown');
    expect(parseTokenType('')).toBe('unknown');
  });

  it('does not accept a type by suffix alone', () => {
    expect(parseTokenType('urn:evil:token-type:access_token')).toBe('unknown');
  });

  it.each(['toString', 'constructor', '__proto__', 'valueOf'])(
    'does not resolve %s from the prototype chain',
    (name) => {
      expect(parseTokenType(name)).toBe('unknown');
    },
  );
});

const CEILING = ['https://api.example', 'https://other.example'];

describe('[ODUDU-TOKEN-EXCHANGE-AUD-01] the exchange audience', () => {
  it('narrows to a named resource inside the ceiling', () => {
    const out = resolveExchangeAudience({
      resource: 'https://api.example',
      audience: undefined,
      ceiling: CEILING,
      issuedType: 'access_token',
    });
    expect(out).toEqual({ kind: 'ok', audience: ['https://api.example'] });
  });

  it('accepts a logical audience without URI parsing', () => {
    const out = resolveExchangeAudience({
      resource: undefined,
      audience: 'https://other.example',
      ceiling: CEILING,
      issuedType: 'access_token',
    });
    expect(out).toEqual({ kind: 'ok', audience: ['https://other.example'] });
  });

  it('refuses a target outside the ceiling', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://elsewhere.example',
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  // RFC 8693 §2.1 permits several; this server issues single-audience
  // tokens, a decision RFC 8707 already made.
  it('refuses more than one target', () => {
    expect(
      resolveExchangeAudience({
        resource: ['https://api.example', 'https://other.example'],
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('refuses resource and audience naming different targets', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: 'https://other.example',
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('accepts resource and audience naming the same target', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: 'https://api.example',
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'ok', audience: ['https://api.example'] });
  });

  // An ID token's aud is the requesting client, fixed by OIDC Core, so
  // naming a target for one is refused rather than ignored.
  it('refuses a target named for an id_token', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'id_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('allows an id_token with no target named', () => {
    expect(
      resolveExchangeAudience({
        resource: undefined,
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'id_token',
      }),
    ).toEqual({ kind: 'ok', audience: [] });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-SCOPE-01] scope never widens', () => {
  const GRANTED = ['openid', 'profile', 'reports:read'];

  it('carries the granted scope when none is requested', () => {
    expect(attenuateScope('', GRANTED)).toEqual({ kind: 'ok', scope: GRANTED });
  });

  it('narrows to a requested subset', () => {
    expect(attenuateScope('openid reports:read', GRANTED)).toEqual({
      kind: 'ok',
      scope: ['openid', 'reports:read'],
    });
  });

  it('refuses a scope the subject never held', () => {
    expect(attenuateScope('reports:write', GRANTED)).toEqual({ kind: 'widened' });
  });

  // The failure modes a real caller produces, none of which may widen.
  it('tolerates repeated and padded separators without widening', () => {
    expect(attenuateScope('  openid   openid  ', GRANTED)).toEqual({
      kind: 'ok',
      scope: ['openid'],
    });
  });

  it('refuses a near-miss rather than matching loosely', () => {
    expect(attenuateScope('Reports:read', GRANTED)).toEqual({ kind: 'widened' });
    expect(attenuateScope('reports:read2', GRANTED)).toEqual({ kind: 'widened' });
  });

  it('refuses when one of several requested scopes is not held', () => {
    expect(attenuateScope('openid reports:write', GRANTED)).toEqual({ kind: 'widened' });
  });

  // '' means the parameter was omitted (readField's convention for an
  // absent field) and carries the granted scope forward. A non-empty
  // value that names no token — RFC 6749 §3.3 defines a scope value as
  // one or more non-empty scope tokens — is malformed input, not an
  // omitted parameter, and is refused rather than reinterpreted.
  it('refuses a whitespace-only scope rather than treating it as omitted', () => {
    expect(attenuateScope('   ', GRANTED)).toEqual({ kind: 'widened' });
  });

  it('still treats a genuinely empty scope as omitted', () => {
    expect(attenuateScope('', GRANTED)).toEqual({ kind: 'ok', scope: GRANTED });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-ACT-01] the delegation chain', () => {
  it('names the actor when there is no prior chain', () => {
    expect(buildActChain('actor-1', undefined)).toEqual({ kind: 'ok', act: { sub: 'actor-1' } });
  });

  // RFC 8693 §4.1: the outermost act is the current actor, and a consumer
  // MUST consider only that one for access control.
  it('nests a prior chain beneath the current actor', () => {
    expect(buildActChain('actor-2', { sub: 'actor-1' })).toEqual({
      kind: 'ok',
      act: { sub: 'actor-2', act: { sub: 'actor-1' } },
    });
  });

  it('refuses a chain deeper than the cap', () => {
    let act: unknown = { sub: 'root' };
    for (let i = 0; i < MAX_DELEGATION_DEPTH; i += 1) act = { sub: `a${String(i)}`, act };
    expect(buildActChain('one-more', act)).toEqual({ kind: 'too_deep' });
  });

  it('refuses a prior act that is not shaped like one', () => {
    expect(buildActChain('actor', { notSub: 1 })).toEqual({ kind: 'malformed' });
    expect(buildActChain('actor', 'actor-1')).toEqual({ kind: 'malformed' });
    expect(buildActChain('actor', { sub: 'a', act: { notSub: 1 } })).toEqual({ kind: 'malformed' });
  });

  it('refuses a self-referential chain rather than looping', () => {
    const looped: Record<string, unknown> = { sub: 'a' };
    looped.act = looped;
    expect(buildActChain('actor', looped)).toEqual({ kind: 'too_deep' });
  });
});

// The read side of a persisted token_grants.act_chain — reuses narrowAct,
// so this is deliberately a thinner suite than ACT-01's, not a second copy
// of it. A single-level chain passes whether or not nesting round-trips at
// all, so the case that matters here is the one with a level beneath it.
describe('[ODUDU-TOKEN-EXCHANGE-ACT-02] narrowing a persisted act chain', () => {
  it('round-trips a nested chain, not just a single level', () => {
    expect(narrowActClaim({ sub: 'a', act: { sub: 'b' } })).toEqual({
      sub: 'a',
      act: { sub: 'b' },
    });
  });

  it('treats absent, malformed or too-deep alike as null', () => {
    expect(narrowActClaim(null)).toBeNull();
    expect(narrowActClaim(undefined)).toBeNull();
    expect(narrowActClaim({ notSub: 1 })).toBeNull();
    let act: unknown = { sub: 'root' };
    for (let i = 0; i < MAX_DELEGATION_DEPTH + 1; i += 1) act = { sub: `a${String(i)}`, act };
    expect(narrowActClaim(act)).toBeNull();
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-MAYACT-01] may_act authorises the actor', () => {
  it('permits when absent, since nothing mints it yet', () => {
    expect(mayActPermits(undefined, 'actor-1')).toBe(true);
  });

  it('permits the named actor', () => {
    expect(mayActPermits({ sub: 'actor-1' }, 'actor-1')).toBe(true);
  });

  it('refuses a different actor', () => {
    expect(mayActPermits({ sub: 'actor-1' }, 'actor-2')).toBe(false);
  });

  it('refuses a malformed claim rather than ignoring it', () => {
    expect(mayActPermits({ notSub: 'actor-1' }, 'actor-1')).toBe(false);
    expect(mayActPermits('actor-1', 'actor-1')).toBe(false);
    expect(mayActPermits(null, 'actor-1')).toBe(false);
  });
});
