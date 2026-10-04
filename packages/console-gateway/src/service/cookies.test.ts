import { describe, expect, it } from 'vitest';
import {
  clearedLoginCookie,
  clearedRestartCookie,
  loginCookie,
  restartCookie,
  restartCookieName,
  clearedSessionCookie,
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

describe('the restart cookie', () => {
  // __Host- needs Path=/, so it is not scoped to /console/auth either.
  it('lives a minute, Lax, at the root path, __Host- only under TLS', () => {
    expect(restartCookieName(true)).toBe('__Host-odudu-console-restart');
    expect(restartCookie(true)).toBe(
      '__Host-odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60; Secure',
    );
    expect(restartCookie(false)).toBe(
      'odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60',
    );
  });

  it('is cleared with the same name and path', () => {
    expect(clearedRestartCookie(false)).toBe(
      'odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
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

  it('is cleared with the same name, attributes and path', () => {
    expect(clearedSessionCookie(true)).toBe(
      '__Host-odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure',
    );
    expect(clearedSessionCookie(false)).toBe(
      'odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
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

  // A second cookie of the same name is one a sibling subdomain or an
  // attacker's script could have planted beside the real one, and nothing
  // in the header says which is which.
  it('answers undefined for a name that appears twice, whatever the values', () => {
    expect(readCookie('odudu-console=a.b; odudu-console=a.b', 'odudu-console')).toBeUndefined();
    expect(
      readCookie('odudu-console=a.b; x=1; odudu-console=c.d', 'odudu-console'),
    ).toBeUndefined();
    expect(readCookie('odudu-console=; odudu-console=c.d', 'odudu-console')).toBeUndefined();
  });

  it('tolerates malformed pairs around the one it wants', () => {
    expect(readCookie('garbage; =x; odudu-console=a.b;;', 'odudu-console')).toBe('a.b');
    expect(readCookie(';;;', 'odudu-console')).toBeUndefined();
  });
});
