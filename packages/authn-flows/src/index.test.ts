import { describe, expect, it } from 'vitest';
import { sessionCookieName } from '#/index';

describe('session cookie naming', () => {
  it('uses the __Host- prefix when TLS is on', () => {
    expect(sessionCookieName('acme', true)).toBe('__Host-acme-session');
  });

  it('drops the prefix without TLS, because browsers reject __Host- without Secure', () => {
    expect(sessionCookieName('acme', false)).toBe('acme-session');
  });
});
