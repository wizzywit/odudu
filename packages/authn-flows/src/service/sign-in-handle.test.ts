import { describe, expect, it } from 'vitest';
import {
  clearedSignInHandleCookie,
  hashSignInSecret,
  newSignInSecret,
  readSignInHandle,
  signInHandleCookie,
  signInHandleName,
} from '#/service/sign-in-handle';
import { pathAddress } from '@odudu/kernel';

const SESSION = '0192f2a0-0000-7000-8000-000000000001';

describe('newSignInSecret', () => {
  it('is 256 random bits, base64url, different every time', () => {
    const first = newSignInSecret();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(newSignInSecret()).not.toBe(first);
  });
});

describe('hashSignInSecret', () => {
  it('is the sha256 hex of the secret, so the row never holds what the cookie holds', () => {
    const hash = hashSignInSecret('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('signInHandleName', () => {
  it('takes the __Secure- prefix under TLS and loses it without, with Secure', () => {
    expect(signInHandleName(true)).toBe('__Secure-odudu-sign-in');
    expect(signInHandleName(false)).toBe('odudu-sign-in');
  });
});

describe('signInHandleCookie', () => {
  it('is HttpOnly, SameSite=Lax, scoped to the tenant path, and as short-lived as the request', () => {
    expect(
      signInHandleCookie(pathAddress('https://idp.example', 'acme'), true, SESSION, 'secret', 1800),
    ).toBe(
      `__Secure-odudu-sign-in=${SESSION}.secret; HttpOnly; SameSite=Lax; Path=/tenants/acme/; Secure; Max-Age=1800`,
    );
    expect(
      signInHandleCookie(pathAddress('https://idp.example', 'acme'), false, SESSION, 'secret', 60),
    ).toBe(
      `odudu-sign-in=${SESSION}.secret; HttpOnly; SameSite=Lax; Path=/tenants/acme/; Max-Age=60`,
    );
  });

  it('encodes a tenant name that is not a safe path segment', () => {
    const cookie = signInHandleCookie(
      pathAddress('https://idp.example', 'a b;c'),
      false,
      SESSION,
      'secret',
      60,
    );
    expect(cookie).toContain('Path=/tenants/a%20b%3Bc/;');
    expect(cookie.split(';')).toHaveLength(5);
  });
});

describe('readSignInHandle', () => {
  const header = (value: string) => `theme=dark; odudu-sign-in=${value}; other=1`;

  it('reads the session and the secret', () => {
    expect(readSignInHandle(header(`${SESSION}.s3cret_-x`), false)).toEqual({
      sessionId: SESSION,
      secret: 's3cret_-x',
    });
  });

  it('reads the prefixed name only under TLS', () => {
    expect(readSignInHandle(`__Secure-odudu-sign-in=${SESSION}.abc`, true)).not.toBeNull();
    expect(readSignInHandle(`__Secure-odudu-sign-in=${SESSION}.abc`, false)).toBeNull();
    expect(readSignInHandle(`odudu-sign-in=${SESSION}.abc`, true)).toBeNull();
  });

  it.each([
    undefined,
    '',
    'odudu-sign-in=',
    'odudu-sign-in=nodot',
    `odudu-sign-in=not-a-uuid.abc`,
    `odudu-sign-in=${SESSION}.`,
    `odudu-sign-in=${SESSION}.a.b`,
    `odudu-sign-in=${SESSION}.${'a'.repeat(200)}`,
    `odudu-sign-in=${SESSION}.sp ace`,
  ])('reads nothing from %j', (value) => {
    expect(readSignInHandle(value, false)).toBeNull();
  });

  it('is not fooled by a cookie that merely ends in the name', () => {
    expect(readSignInHandle(`x-odudu-sign-in=${SESSION}.abc`, false)).toBeNull();
  });
});

describe('readSignInHandle with the name present more than once', () => {
  const good = `odudu-sign-in=${SESSION}.good`;

  it('accepts the valid pair whichever position it is in', () => {
    expect(readSignInHandle(`odudu-sign-in=garbage; ${good}`, false)?.secret).toBe('good');
    expect(readSignInHandle(`odudu-sign-in=not-a-uuid.abc; ${good}`, false)?.secret).toBe('good');
    expect(readSignInHandle(`${good}; odudu-sign-in=garbage`, false)?.secret).toBe('good');
    expect(readSignInHandle(`odudu-sign-in=; theme=x; ${good}`, false)?.secret).toBe('good');
  });

  it('takes the first that validates when several do', () => {
    expect(readSignInHandle(`${good}; odudu-sign-in=${SESSION}.second`, false)?.secret).toBe(
      'good',
    );
  });

  it('reads nothing when none validates', () => {
    expect(readSignInHandle('odudu-sign-in=a; odudu-sign-in=b.c', false)).toBeNull();
  });

  it('does the same under the prefixed name', () => {
    expect(
      readSignInHandle(`__Secure-odudu-sign-in=bad; __Secure-odudu-sign-in=${SESSION}.ok`, true)
        ?.secret,
    ).toBe('ok');
  });
});

describe('clearedSignInHandleCookie', () => {
  it('expires the cookie with the attributes and path it was set with', () => {
    expect(clearedSignInHandleCookie(pathAddress('https://idp.example', 'acme'), true)).toBe(
      '__Secure-odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/acme/; Secure; Max-Age=0',
    );
    expect(clearedSignInHandleCookie(pathAddress('https://idp.example', 'a b'), false)).toBe(
      'odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/a%20b/; Max-Age=0',
    );
  });
});
