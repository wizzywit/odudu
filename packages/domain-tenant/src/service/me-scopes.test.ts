import { describe, expect, it } from 'vitest';
import {
  holdsMeScope,
  isMeScope,
  ME_READ_SCOPE,
  ME_SCOPES,
  ME_WRITE_NEEDS_READ_MESSAGE,
  ME_WRITE_SCOPE,
  meWriteNeedsRead,
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

describe('meWriteNeedsRead', () => {
  it('holds a set with no me:write, or with both scopes', () => {
    expect(meWriteNeedsRead([])).toBe(true);
    expect(meWriteNeedsRead(['openid', 'me:read'])).toBe(true);
    expect(meWriteNeedsRead(['me:read', 'me:write'])).toBe(true);
  });
  it('fails a set holding me:write without me:read', () => {
    expect(meWriteNeedsRead(['me:write'])).toBe(false);
    expect(meWriteNeedsRead(['openid', 'me:write', 'mcp:read'])).toBe(false);
  });
  it('has a stable message', () => {
    expect(ME_WRITE_NEEDS_READ_MESSAGE).toBe(
      'the scope me:write is held only together with me:read',
    );
  });
});
