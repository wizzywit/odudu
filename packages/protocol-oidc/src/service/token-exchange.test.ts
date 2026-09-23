import { describe, expect, it } from 'vitest';
import { attenuateScope, parseTokenType, resolveExchangeAudience } from '#/service/token-exchange';

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
});
