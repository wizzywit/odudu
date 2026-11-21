import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { refresh } from '#/use-cases/refresh';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { testKey, verifyAssertion } from '#/testing/client-keys';
import type { ClientAuth, Pending, TokenSet } from '#/types';

const NOW = 1_800_000_000_000;
const deps = { allowInsecureRequests: true, now: () => NOW };
const REDIRECT = 'https://app.example/callback';
const SECRET = 'distinctivesecret9f3a';
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

async function begin(): Promise<{ pending: Pending; callback: string }> {
  const { url, pending } = await beginSignIn(
    {
      issuer: fake.issuer,
      clientId: 'web1',
      redirectUri: REDIRECT,
      scope: 'openid offline_access',
    },
    deps,
  );
  fake.claims = { nonce: pending.nonce };
  const callback = new URL(REDIRECT);
  callback.searchParams.set('code', 'code-1');
  callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
  callback.searchParams.set('iss', fake.issuer);
  return { pending, callback: callback.href };
}

async function signedIn(auth?: ClientAuth): Promise<TokenSet> {
  const { pending, callback } = await begin();
  return completeSignIn(callback, pending, deps, auth === undefined ? {} : { auth });
}

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

function basic(clientId: string, secret: string): string {
  const credentials = `${formEncode(clientId)}:${formEncode(secret)}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

async function assertionOf(form: URLSearchParams | undefined, publicKey: TestKey['publicKey']) {
  expect(form?.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  );
  return verifyAssertion(
    form?.get('client_assertion') ?? '',
    publicKey,
    { clientId: 'web1', audience: `${fake.issuer}/token`, now: NOW },
    'ES256',
  );
}

type TestKey = Awaited<ReturnType<typeof testKey>>;

describe('confidential clients', () => {
  it('a confidential code exchange sends the secret as client_secret_basic', async () => {
    await signedIn({ secret: SECRET });
    expect(fake.tokenAuthorizations).toEqual([basic('web1', SECRET)]);
    expect(fake.tokenRequests[0]?.has('client_secret')).toBe(false);
    expect(fake.tokenRequests[0]?.has('client_assertion')).toBe(false);
  });

  it('a confidential code exchange sends a private_key_jwt assertion whose aud is the token endpoint', async () => {
    const key = await testKey('ES256');
    await signedIn({ privateKey: key.privateKey, kid: 'key-1' });
    expect(fake.tokenAuthorizations[0]).toBeUndefined();
    expect(fake.tokenRequests[0]?.get('client_id')).toBe('web1');
    const { header, payload } = await assertionOf(fake.tokenRequests[0], key.publicKey);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'key-1' });
    expect(payload.aud).toBe(`${fake.issuer}/token`);
  });

  it('a confidential refresh sends the secret as client_secret_basic', async () => {
    const tokens = await signedIn();
    fake.tokenRequests.length = 0;
    fake.tokenAuthorizations.length = 0;
    await refresh(tokens, { auth: { secret: SECRET } }, deps);
    expect(fake.tokenRequests[0]?.get('grant_type')).toBe('refresh_token');
    expect(fake.tokenAuthorizations).toEqual([basic('web1', SECRET)]);
  });

  it('a confidential refresh sends a private_key_jwt assertion', async () => {
    const tokens = await signedIn();
    fake.tokenRequests.length = 0;
    const key = await testKey('ES256');
    await refresh(tokens, { auth: { privateKey: key.privateKey } }, deps);
    expect(fake.tokenRequests[0]?.get('grant_type')).toBe('refresh_token');
    const { payload } = await assertionOf(fake.tokenRequests[0], key.publicKey);
    expect(payload.aud).toBe(`${fake.issuer}/token`);
  });

  it('a public exchange and refresh send no credentials (unchanged)', async () => {
    const tokens = await signedIn();
    await refresh(tokens, {}, deps);
    expect(fake.tokenAuthorizations).toEqual([undefined, undefined]);
    for (const form of fake.tokenRequests) {
      expect(form.get('client_id')).toBe('web1');
      expect(form.has('client_assertion')).toBe(false);
      expect(form.has('client_secret')).toBe(false);
    }
  });

  it('a refused exchange never carries the secret in its error', async () => {
    fake.tokenError = {
      error: 'invalid_client',
      error_description: 'client authentication failed',
    };
    const { pending, callback } = await begin();
    const error = await completeSignIn(callback, pending, deps, { auth: { secret: SECRET } }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OduduError);
    const encoded = basic('web1', SECRET).slice(6);
    const everything = JSON.stringify(error, Object.getOwnPropertyNames(error));
    const cause = String((error as OduduError).cause);
    for (const text of [everything, cause, (error as OduduError).message]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(encoded);
    }
  });

  it('a private key that cannot sign with the algorithm rejects with invalid_options on the exchange', async () => {
    const { pending, callback } = await begin();
    const error = await completeSignIn(callback, pending, deps, {
      auth: { privateKey: { kty: 'oct', k: 'AAAA' }, alg: 'ES256' },
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as OduduError).code).toBe('invalid_options');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('a code exchange response without expires_in is refused, not read as expired', async () => {
    fake.expiresIn = undefined;
    const { pending, callback } = await begin();
    const exchanged = await completeSignIn(callback, pending, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((exchanged as OduduError).code).toBe('request_failed');
  });

  it('a refresh response without expires_in keeps the rotated refresh token and lives 60 s', async () => {
    const tokens = await signedIn();
    fake.expiresIn = undefined;
    const renewed = await refresh(tokens, {}, deps);
    expect(renewed.refreshToken).toBe('refresh-token-1-rotated');
    expect(renewed.byAudience[tokens.issuer]?.expiresAt).toBe(deps.now() + 60_000);
  });
});
