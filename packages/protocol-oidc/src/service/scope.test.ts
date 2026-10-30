import { describe, expect, it } from 'vitest';
import { defaultScopeNames, resolveScope } from '#/service/scope';

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

describe('the default scopes of a client, as a request would name them', () => {
  const entry = (name: string, displayOrder: number, assignment: 'default' | 'optional') => ({
    scope: { name, displayOrder },
    assignment,
  });

  it('keeps the default assignments only, openid first, then by display order and name', () => {
    const rows = [
      entry('profile', 1, 'default'),
      entry('address', 0, 'optional'),
      entry('email', 1, 'default'),
      entry('openid', 5, 'default'),
      entry('groups', 0, 'default'),
    ];
    expect(defaultScopeNames(rows)).toEqual(['openid', 'groups', 'email', 'profile']);
  });

  it('does not depend on the order the database returned the rows in', () => {
    const rows = [
      entry('openid', 0, 'default'),
      entry('phone', 0, 'default'),
      entry('email', 0, 'default'),
    ];
    expect(defaultScopeNames([...rows].reverse())).toEqual(defaultScopeNames(rows));
  });
});
