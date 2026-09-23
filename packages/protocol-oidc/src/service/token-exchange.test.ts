import { describe, expect, it } from 'vitest';
import { parseTokenType } from '#/service/token-exchange';

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
