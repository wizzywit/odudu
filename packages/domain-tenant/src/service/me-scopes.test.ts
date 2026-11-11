import { describe, expect, it } from 'vitest';
import {
  holdsMeScope,
  isMeScope,
  ME_READ_SCOPE,
  ME_SCOPES,
  ME_WRITE_SCOPE,
} from '#/service/me-scopes';

describe('the "me" scopes', () => {
  it('are exactly me:read and me:write', () => {
    expect(ME_READ_SCOPE).toBe('me:read');
    expect(ME_WRITE_SCOPE).toBe('me:write');
    expect([...ME_SCOPES]).toEqual(['me:read', 'me:write']);
    expect(isMeScope('me:read')).toBe(true);
    for (const other of ['openid', 'mcp:read', 'me:admin', 'ME:READ', 'me:read ', '']) {
      expect(isMeScope(other)).toBe(false);
    }
  });

  it('are held when any one is in the list', () => {
    expect(holdsMeScope(['openid', 'me:write'])).toBe(true);
    expect(holdsMeScope(['openid', 'mcp:read'])).toBe(false);
  });
});
