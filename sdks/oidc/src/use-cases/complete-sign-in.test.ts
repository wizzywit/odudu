import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import type { Pending, SignInOptions } from '#/types';

const NOW = 1_800_000_000_000;
const deps = { allowInsecureRequests: true, now: () => NOW };
const REDIRECT = 'http://localhost:5173/callback';
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

async function begin(extra: Partial<SignInOptions> = {}): Promise<Pending> {
  const { pending } = await beginSignIn(
    {
      issuer: fake.issuer,
      clientId: 'app-1',
      redirectUri: REDIRECT,
      scope: 'openid profile',
      ...extra,
    },
    deps,
  );
  fake.claims = { nonce: pending.nonce };
  return pending;
}

function callback(params: Record<string, string | undefined>): string {
  const url = new URL(REDIRECT);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.href;
}

function good(pending: Pending): Record<string, string> {
  return { code: 'code-1', state: pending.state, iss: fake.issuer };
}

async function refusal(url: string, pending: Pending): Promise<OduduError> {
  const error = await completeSignIn(url, pending, deps).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OduduError);
  return error as OduduError;
}

describe('completeSignIn', () => {
  it('returns the tokens and the validated claims', async () => {
    const pending = await begin();
    fake.scope = 'openid profile';
    const tokens = await completeSignIn(callback(good(pending)), pending, deps);
    expect(tokens.idToken.split('.')).toHaveLength(3);
    expect(tokens.refreshToken).toBe('refresh-token-1');
    expect(tokens.claims.sub).toBe('subject-1');
    expect(tokens.claims.iss).toBe(fake.issuer);
    expect(tokens.byAudience).toEqual({
      [fake.issuer]: {
        accessToken: 'access-token-1',
        expiresAt: NOW + 900_000,
        scope: 'openid profile',
      },
    });
  });

  it('sends the code, the verifier and the redirect address to the token endpoint', async () => {
    const pending = await begin();
    await completeSignIn(callback(good(pending)), pending, deps);
    const request = fake.tokenRequests[0];
    expect(request?.get('grant_type')).toBe('authorization_code');
    expect(request?.get('code')).toBe('code-1');
    expect(request?.get('redirect_uri')).toBe(REDIRECT);
    expect(request?.get('client_id')).toBe('app-1');
    expect(request?.get('code_verifier')).toBe(pending.codeVerifier);
  });

  it('keys the access token by the audience it was asked for', async () => {
    const pending = await begin({ meAccess: 'write' });
    fake.scope = 'openid profile me:read me:write';
    const tokens = await completeSignIn(callback(good(pending)), pending, deps);
    expect(Object.keys(tokens.byAudience)).toEqual([`${fake.issuer}/me`]);
    expect(tokens.byAudience[`${fake.issuer}/me`]?.scope).toBe('openid profile me:read me:write');
  });

  it('refuses a missing state', async () => {
    const pending = await begin();
    const error = await refusal(callback({ code: 'code-1', iss: fake.issuer }), pending);
    expect(error.code).toBe('invalid_state');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('refuses a state that differs', async () => {
    const pending = await begin();
    const error = await refusal(callback({ ...good(pending), state: 'other' }), pending);
    expect(error.code).toBe('invalid_state');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('refuses a missing iss (RFC 9207)', async () => {
    const pending = await begin();
    const error = await refusal(callback({ ...good(pending), iss: undefined }), pending);
    expect(error.code).toBe('invalid_issuer');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('refuses an iss that differs', async () => {
    const pending = await begin();
    const error = await refusal(
      callback({ ...good(pending), iss: 'https://evil.example/tenants/demo' }),
      pending,
    );
    expect(error.code).toBe('invalid_issuer');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('returns the error an authorization response carries', async () => {
    const pending = await begin();
    const error = await refusal(
      callback({
        state: pending.state,
        iss: fake.issuer,
        error: 'access_denied',
        error_description: 'the person said no',
      }),
      pending,
    );
    expect(error.code).toBe('access_denied');
    expect(error.error).toBe('access_denied');
    expect(error.errorDescription).toBe('the person said no');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('refuses a callback with no code', async () => {
    const pending = await begin();
    const error = await refusal(callback({ state: pending.state, iss: fake.issuer }), pending);
    expect(error.code).toBe('invalid_callback');
  });

  it('refuses an ID token with the wrong nonce', async () => {
    const pending = await begin();
    fake.claims = { nonce: 'not-the-nonce' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_id_token');
  });

  it('refuses an ID token for another audience', async () => {
    const pending = await begin();
    fake.claims = { nonce: pending.nonce, aud: 'someone-else' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_id_token');
  });

  it('refuses an expired ID token', async () => {
    const pending = await begin();
    fake.claims = { nonce: pending.nonce, exp: Math.floor(Date.now() / 1000) - 3600 };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_id_token');
  });

  it('refuses an ID token whose azp is another client', async () => {
    const pending = await begin();
    fake.claims = { nonce: pending.nonce, aud: ['app-1', 'api'], azp: 'other-client' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_id_token');
  });

  it('refuses an ID token from another issuer', async () => {
    const pending = await begin();
    fake.claims = { nonce: pending.nonce, iss: 'https://evil.example/tenants/demo' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_id_token');
  });

  it("returns the server's error code for a code it refuses", async () => {
    const pending = await begin();
    fake.tokenError = { error: 'invalid_grant', error_description: 'code already used' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_grant');
    expect(error.error).toBe('invalid_grant');
    expect(error.errorDescription).toBe('code already used');
  });

  it('names invalid_client when the code exchange is refused with a challenge', async () => {
    const pending = await begin();
    fake.tokenChallenge = true;
    fake.tokenError = { error: 'invalid_client' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('invalid_client');
  });

  it('keeps request_failed for a challenge with no OAuth error body', async () => {
    const pending = await begin();
    fake.tokenChallenge = true;
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('request_failed');
  });

  it('keeps a code the server does not name as the raw error', async () => {
    const pending = await begin();
    fake.tokenError = { error: 'brand_new_error' };
    const error = await refusal(callback(good(pending)), pending);
    expect(error.code).toBe('unrecognized_error');
    expect(error.error).toBe('brand_new_error');
  });

  it('refuses a callback at another address than the redirect URI', async () => {
    const pending = await begin();
    const wrong = new URL('http://localhost:5173/elsewhere');
    for (const [k, v] of Object.entries(good(pending))) wrong.searchParams.set(k, v);
    expect((await refusal(wrong.href, pending)).code).toBe('invalid_callback');
    const other = new URL(wrong.href.replace('localhost:5173/elsewhere', 'evil.example/callback'));
    expect((await refusal(other.href, pending)).code).toBe('invalid_callback');
  });

  it('refuses a malformed redirect URI or callback address with invalid_callback', async () => {
    const pending = await begin();
    expect(
      (await refusal(callback(good(pending)), { ...pending, redirectUri: 'not a url' })).code,
    ).toBe('invalid_callback');
    expect((await refusal('not a url', pending)).code).toBe('invalid_callback');
  });
});
