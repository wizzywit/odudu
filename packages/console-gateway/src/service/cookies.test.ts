import { describe, expect, it } from 'vitest';
import {
  clearedLoginCookie,
  loginCookie,
  loginCookieName,
  readCookie,
  sessionCookie,
  sessionCookieName,
} from '#/service/cookies';

describe('console cookie names', () => {
  it('take the __Host- prefix only under TLS', () => {
    expect(loginCookieName(true)).toBe('__Host-odudu-console-login');
    expect(loginCookieName(false)).toBe('odudu-console-login');
    expect(sessionCookieName(true)).toBe('__Host-odudu-console');
    expect(sessionCookieName(false)).toBe('odudu-console');
  });
});

describe('the login cookie', () => {
  // A browser drops a __Host- cookie whose Path is anything but /.
  it('lives ten minutes, Lax, at the root path', () => {
    expect(loginCookie('s.t', true)).toBe(
      '__Host-odudu-console-login=s.t; HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure',
    );
    expect(loginCookie('s.t', false)).toBe(
      'odudu-console-login=s.t; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    );
  });

  it('is cleared with the same name and path', () => {
    expect(clearedLoginCookie(false)).toBe(
      'odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    );
  });
});

describe('the session cookie', () => {
  it('is Strict and HttpOnly, Secure only under TLS', () => {
    expect(sessionCookie('t.s', true)).toBe(
      '__Host-odudu-console=t.s; HttpOnly; SameSite=Strict; Path=/; Secure',
    );
    expect(sessionCookie('t.s', false)).toBe(
      'odudu-console=t.s; HttpOnly; SameSite=Strict; Path=/',
    );
  });
});

describe('readCookie', () => {
  it('finds a cookie by its exact name among several', () => {
    const header = 'odudu-console-login-x=1; odudu-console-login=abc.def; odudu-console=zz';
    expect(readCookie(header, 'odudu-console-login')).toBe('abc.def');
    expect(readCookie(header, 'odudu-console')).toBe('zz');
  });

  it('answers undefined for an absent header, name or value', () => {
    expect(readCookie(undefined, 'odudu-console')).toBeUndefined();
    expect(readCookie('other=1', 'odudu-console')).toBeUndefined();
    expect(readCookie('odudu-console=', 'odudu-console')).toBeUndefined();
  });
});
