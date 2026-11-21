import { describe, expect, it } from 'vitest';
import { decodeStored, encodeStored, judgeStored, storedMatches } from '#/services/stored-sign-in';

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

describe('what is done with the sign-in a run finds', () => {
  const server = { issuer: stored.issuer, tokenEndpoint: stored.tokenEndpoint };
  const elsewhere = { ...server, issuer: 'https://other.example' };

  it('presents the one held in memory, or else the one stored, when it is from this server', () => {
    expect(judgeStored(stored, null, server)).toEqual({ refreshToken: 'rt-1', forget: false });
    expect(judgeStored(undefined, encodeStored(stored), server)).toEqual({
      refreshToken: 'rt-1',
      forget: false,
    });
  });

  it('prefers the one held in memory over the stored text', () => {
    const newer = { ...stored, refreshToken: 'rt-2' };
    expect(judgeStored(newer, encodeStored(stored), server).refreshToken).toBe('rt-2');
  });

  it('forgets one made for another server, and one it cannot read', () => {
    expect(judgeStored(stored, null, elsewhere)).toEqual({ refreshToken: undefined, forget: true });
    expect(judgeStored(undefined, encodeStored(stored), elsewhere)).toEqual({
      refreshToken: undefined,
      forget: true,
    });
    expect(judgeStored(undefined, 'rt-raw', server)).toEqual({
      refreshToken: undefined,
      forget: true,
    });
  });

  it('finds nothing to forget when nothing is held', () => {
    expect(judgeStored(undefined, null, server)).toEqual({
      refreshToken: undefined,
      forget: false,
    });
  });
});
