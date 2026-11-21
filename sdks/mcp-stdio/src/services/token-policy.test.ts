import { describe, expect, it } from 'vitest';
import {
  endsStoredSignIn,
  freshAccessToken,
  keepsRefreshToken,
  readsStoredSignIn,
  refusesAccess,
} from '#/services/token-policy';
import { StdioError } from '#/services/stdio-error';
import type { TokenSet } from '#/services/token-set';
import { jwtOf } from '#/testing/jwt';

const set = (scope: string, refreshToken?: string): TokenSet => ({
  accessToken: jwtOf({ scope }),
  expiresAt: new Date(),
  scope: scope.split(' '),
  ...(refreshToken === undefined ? {} : { refreshToken }),
});

describe('what a run does with a stored sign-in', () => {
  it('reads one only when it is read-only', () => {
    expect(readsStoredSignIn('mcp:read')).toBe(true);
    expect(readsStoredSignIn('mcp:write')).toBe(false);
  });

  it('keeps a refresh token only for a read-only run, and never one that came with mcp:write', () => {
    expect(keepsRefreshToken('mcp:read', set('mcp:read', 'r'))).toBe('r');
    expect(keepsRefreshToken('mcp:read', set('mcp:read'))).toBeUndefined();
    expect(keepsRefreshToken('mcp:write', set('mcp:write', 'r'))).toBeUndefined();
    expect(keepsRefreshToken('mcp:read', set('mcp:read mcp:write', 'r'))).toBeUndefined();
  });

  it('forgets a stored sign-in the server says has ended, and no other failure', () => {
    expect(endsStoredSignIn(new StdioError('mcp_grant_ended', 'x'))).toBe(true);
    expect(endsStoredSignIn(new StdioError('mcp_unreachable', 'x'))).toBe(false);
    expect(endsStoredSignIn(new Error('x'))).toBe(false);
  });
});

describe('what a token source hands out', () => {
  it('refuses a write to a run that did not ask for mcp:write, and nothing else', () => {
    expect(refusesAccess('write', 'mcp:read')).toBe(true);
    expect(refusesAccess('write', 'mcp:write')).toBe(false);
    expect(refusesAccess('read', 'mcp:read')).toBe(false);
    expect(refusesAccess('read', 'mcp:write')).toBe(false);
  });

  it('keeps a token until it is within the skew of expiring', () => {
    const held = { ...set('mcp:read'), accessToken: 'a', expiresAt: new Date(100_000) };
    expect(freshAccessToken(held, 69_999, 30_000)).toBe('a');
    expect(freshAccessToken(held, 70_000, 30_000)).toBeUndefined();
    expect(freshAccessToken(held, 100_000, 30_000)).toBeUndefined();
    expect(freshAccessToken(undefined, 0, 30_000)).toBeUndefined();
  });
});
