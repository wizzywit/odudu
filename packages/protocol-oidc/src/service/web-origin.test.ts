import { describe, expect, it } from 'vitest';
import { expandWebOrigins, isWellFormedWebOrigin, normalizeOrigin } from '#/service/web-origin';

describe('web origin grammar', () => {
  it.each([
    ['https://app.example', true],
    ['http://localhost:3000', true],
    ['https://app.example:8443', true],
    ['+', true],
  ])('accepts %s', (value, expected) => {
    expect(isWellFormedWebOrigin(value)).toBe(expected);
  });

  it.each([
    ['*'],
    ['https://*'],
    ['https://*.example'],
    ['https://app.example/'],
    ['https://app.example/callback'],
    ['https://app.example?x=1'],
    ['app.example'],
    ['ftp://app.example'],
    [''],
  ])('refuses %s', (value) => {
    expect(isWellFormedWebOrigin(value)).toBe(false);
  });
});

describe('normalizeOrigin', () => {
  it('drops a scheme default port and keeps every other port', () => {
    expect(normalizeOrigin('https://app.example:443')).toBe('https://app.example');
    expect(normalizeOrigin('http://app.example:80')).toBe('http://app.example');
    expect(normalizeOrigin('https://app.example:8443')).toBe('https://app.example:8443');
  });

  it('returns null for something that is not an origin', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('expandWebOrigins', () => {
  it('expands + to the origins of the registered redirect URIs', () => {
    const origins = expandWebOrigins(
      ['+'],
      [
        'https://app.example/callback',
        'https://app.example/silent-renew',
        'https://admin.example/cb',
      ],
    );
    expect([...origins].sort()).toEqual(['https://admin.example', 'https://app.example']);
  });

  it('keeps explicit origins alongside an expanded +', () => {
    const origins = expandWebOrigins(['+', 'https://other.example'], ['https://app.example/cb']);
    expect([...origins].sort()).toEqual(['https://app.example', 'https://other.example']);
  });

  it('yields nothing for a client that configured nothing', () => {
    expect(expandWebOrigins([], ['https://app.example/cb']).size).toBe(0);
  });
});
