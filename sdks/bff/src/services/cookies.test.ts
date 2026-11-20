import { describe, expect, it } from 'vitest';
import { clearCookie, readCookie, setCookie } from '#/services/cookies';

describe('cookies', () => {
  it('sets a session cookie with no Max-Age and no Domain', () => {
    expect(setCookie({ name: '__Host-odudu', value: 'abc' })).toBe(
      '__Host-odudu=abc; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('sets a lifetime when given one', () => {
    expect(setCookie({ name: 'n', value: 'v', maxAgeSeconds: 600 })).toContain('; Max-Age=600');
  });

  it('clears with the same attributes, which a __Host- cookie needs to be replaced', () => {
    const line = clearCookie('__Host-odudu');
    expect(line).toContain('Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  });

  it('reads one cookie among several', () => {
    expect(readCookie('a=1; __Host-odudu=xyz; b=2', '__Host-odudu')).toBe('xyz');
  });

  it('does not match a name that only ends the same way', () => {
    expect(readCookie('x__Host-odudu=1', '__Host-odudu')).toBeUndefined();
  });

  it('reads a name sent twice as absent', () => {
    expect(readCookie('n=1; n=2', 'n')).toBeUndefined();
  });

  it('reads no header as absent', () => {
    expect(readCookie(null, 'n')).toBeUndefined();
  });
});
