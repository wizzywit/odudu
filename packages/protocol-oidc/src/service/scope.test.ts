import { describe, expect, it } from 'vitest';
import { resolveScope } from '#/service/scope';

describe('[RFC6749-3.3-01] scope only ever narrows', () => {
  it('intersects requested with client-allowed', () => {
    expect(resolveScope('openid profile admin', ['openid', 'profile'], null, null)).toEqual([
      'openid',
      'profile',
    ]);
  });

  it('cannot widen beyond what the client is allowed', () => {
    expect(resolveScope('admin', ['openid'], null, null)).toEqual([]);
  });

  it('narrows further to what was consented when consent exists', () => {
    expect(resolveScope('openid profile', ['openid', 'profile'], ['openid'], null)).toEqual([
      'openid',
    ]);
  });

  it('narrows further to the delegated set when one exists', () => {
    expect(resolveScope('openid profile', ['openid', 'profile'], null, ['profile'])).toEqual([
      'profile',
    ]);
  });

  it('treats a null consented set as "everything allowed", not "nothing"', () => {
    expect(resolveScope('openid', ['openid'], null, null)).toEqual(['openid']);
  });
});
