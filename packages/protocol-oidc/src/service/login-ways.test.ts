import { MAX_SIGN_IN_PATH_LENGTH, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { restartAuthorizeLocation } from '#/service/restart-request';
import { accountPagePath, loginWays } from '#/service/login-ways';

const SIGN_IN = '/tenants/acme/protocol/openid-connect/auth?response_type=code&client_id=portal';
const BOTH = { registrationAllowed: true, resetPasswordAllowed: true };
const NEITHER = { registrationAllowed: false, resetPasswordAllowed: false };

describe('accountPagePath', () => {
  it('is the path the Create an account link carries, so prompt=create lands on the same page', () => {
    expect(
      accountPagePath(pathAddress('https://idp.example', 'acme'), 'registration', SIGN_IN),
    ).toBe(loginWays(pathAddress('https://idp.example', 'acme'), BOTH, SIGN_IN).createAccount);
    expect(accountPagePath(pathAddress('https://idp.example', 'acme'), 'registration', null)).toBe(
      '/tenants/acme/login-actions/registration',
    );
  });
});

describe('loginWays', () => {
  it('offers nothing a tenant has not turned on', () => {
    expect(loginWays(pathAddress('https://idp.example', 'acme'), NEITHER, SIGN_IN)).toEqual({});
  });

  it('offers each page on its own setting', () => {
    expect(
      loginWays(
        pathAddress('https://idp.example', 'acme'),
        { ...NEITHER, registrationAllowed: true },
        null,
      ),
    ).toEqual({
      createAccount: '/tenants/acme/login-actions/registration',
    });
    expect(
      loginWays(
        pathAddress('https://idp.example', 'acme'),
        { ...NEITHER, resetPasswordAllowed: true },
        null,
      ),
    ).toEqual({
      resetPassword: '/tenants/acme/login-actions/reset-password',
    });
  });

  it('carries the way back to the sign-in as a parameter, encoded', () => {
    const ways = loginWays(pathAddress('https://idp.example', 'acme'), BOTH, SIGN_IN);
    const encoded = encodeURIComponent(SIGN_IN);
    expect(ways.createAccount).toBe(
      `/tenants/acme/login-actions/registration?return_to=${encoded}`,
    );
    expect(ways.resetPassword).toBe(
      `/tenants/acme/login-actions/reset-password?return_to=${encoded}`,
    );
  });

  it('encodes a tenant name that needs it, so the path stays on this tenant', () => {
    expect(loginWays(pathAddress('https://idp.example', 'a/b c'), BOTH, null).createAccount).toBe(
      '/tenants/a%2Fb%20c/login-actions/registration',
    );
  });

  it('offers the links without return_to when the path is past the bound the receiver accepts', () => {
    const long = `${SIGN_IN}&x=${'a'.repeat(MAX_SIGN_IN_PATH_LENGTH)}`;
    expect(loginWays(pathAddress('https://idp.example', 'acme'), BOTH, long)).toEqual({
      createAccount: '/tenants/acme/login-actions/registration',
      resetPassword: '/tenants/acme/login-actions/reset-password',
    });
    const atBound = SIGN_IN + 'a'.repeat(MAX_SIGN_IN_PATH_LENGTH - SIGN_IN.length);
    expect(
      loginWays(pathAddress('https://idp.example', 'acme'), BOTH, atBound).createAccount,
    ).toContain('return_to=');
  });

  it('drops the path of a request with a large claims parameter', () => {
    const claims = {
      idToken: Object.fromEntries(
        Array.from({ length: 150 }, (_, i) => [
          `claim_${String(i)}_xxxxxxxxxxxx`,
          { essential: true },
        ]),
      ),
      userinfo: {},
    };
    const path = restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
      clientId: 'c',
      redirectUri: 'https://app.example/cb',
      scope: 'openid',
      state: null,
      nonce: null,
      codeChallenge: 'x'.repeat(43),
      codeChallengeMethod: 'S256',
      claims,
    });
    expect(path).not.toBeNull();
    expect((path ?? '').length).toBeGreaterThan(MAX_SIGN_IN_PATH_LENGTH);
    expect(loginWays(pathAddress('https://idp.example', 'acme'), BOTH, path).createAccount).toBe(
      '/tenants/acme/login-actions/registration',
    );
  });
});
