import { describe, expect, it } from 'vitest';
import { decodeStored, encodeStored, storedMatches } from '#/service/stored-sign-in';

const stored = {
  refreshToken: 'rt-1',
  issuer: 'https://id.example.com/tenants/acme',
  tokenEndpoint: 'https://id.example.com/tenants/acme/protocol/openid-connect/token',
};

describe('a sign-in kept with where it was made', () => {
  it('round-trips', () => {
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it.each([
    'rt-raw',
    '',
    '{}',
    '[]',
    '{"refreshToken":"x"}',
    '{"refreshToken":1,"issuer":"i","tokenEndpoint":"t"}',
  ])('does not read %j as one', (text) => {
    expect(decodeStored(text)).toBeUndefined();
  });

  it('belongs to an authorization server only when issuer and token endpoint are both the ones it was made at', () => {
    const same = { issuer: stored.issuer, tokenEndpoint: stored.tokenEndpoint };
    expect(storedMatches(stored, same)).toBe(true);
    expect(storedMatches(stored, { ...same, issuer: 'https://evil.example' })).toBe(false);
    expect(storedMatches(stored, { ...same, tokenEndpoint: 'https://evil.example/token' })).toBe(
      false,
    );
  });
});
