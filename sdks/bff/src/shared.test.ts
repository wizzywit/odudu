import { describe, expect, it } from 'vitest';
import * as shared from '#/shared';

describe('the rules a framework binding shares with the BFF', () => {
  it('exports the cookie, id, header and path rules', () => {
    expect(Object.keys(shared).sort()).toEqual([
      'BFF_HEADER',
      'DEFAULT_COOKIE_NAME',
      'checkMountPath',
      'clearCookie',
      'isExpiredForGood',
      'isLocalPath',
      'isSessionId',
      'readCookie',
      'sessionKey',
      'setCookie',
    ]);
  });

  it('names the header and the cookie the BFF uses', () => {
    expect(shared.BFF_HEADER).toBe('x-odudu-bff');
    expect(shared.DEFAULT_COOKIE_NAME).toBe('__Host-odudu');
  });

  it('checks a mount path like the BFF checks its prefix', () => {
    expect(shared.checkMountPath('')).toBe('');
    expect(shared.checkMountPath('/api/auth')).toBe('/api/auth');
    expect(() => shared.checkMountPath('/api/auth/')).toThrow(TypeError);
    expect(() => shared.checkMountPath('api')).toThrow(TypeError);
    expect(() => shared.checkMountPath('/a/../b')).toThrow(TypeError);
  });

  it('tells a local path from one that leaves the origin', () => {
    expect(shared.isLocalPath('/dashboard?x=1')).toBe(true);
    for (const path of ['//evil.example', '/\\evil', 'https://evil.example', '']) {
      expect(shared.isLocalPath(path)).toBe(false);
    }
  });
});
