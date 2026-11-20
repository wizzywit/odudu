import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '#/services/return-to';

describe('safeReturnTo', () => {
  it.each(['/', '/dashboard', '/a/b?x=1&y=2', '/a#frag', '/a%20b'])('keeps %s', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    'https://evil.example/',
    'http://evil.example',
    '//evil.example',
    '//evil.example/x',
    '/\\evil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    'javascript:alert(1)',
    'dashboard',
    '',
    '/a\nb',
    '/a\tb',
    '/ /evil',
    ' /dashboard',
    '/%2f%2fevil',
    '/%5cevil',
    `/${'a'.repeat(2048)}`,
  ])('refuses %j', (value) => {
    expect(safeReturnTo(value)).toBeUndefined();
  });

  it('refuses a missing value', () => {
    expect(safeReturnTo(null)).toBeUndefined();
    expect(safeReturnTo(undefined)).toBeUndefined();
  });

  it('refuses the sign-in routes themselves, which would loop', () => {
    expect(safeReturnTo('/api/auth/login', '/api/auth')).toBeUndefined();
    expect(safeReturnTo('/api/auth/callback?code=x', '/api/auth')).toBeUndefined();
    expect(safeReturnTo('/api/authors', '/api/auth')).toBe('/api/authors');
  });
});
