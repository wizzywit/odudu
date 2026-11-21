import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { clientCredentials } from '#/use-cases/client-credentials';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { refresh } from '#/use-cases/refresh';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

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

const answers = {
  'a 502 HTML page from a load balancer': {
    status: 502,
    contentType: 'text/html',
    body: '<html>Bad Gateway</html>',
  },
  'a 503 with no body': { status: 503, body: '' },
  'a 429 with no body': { status: 429, body: '' },
  'a 500 JSON body with no error member': {
    status: 500,
    contentType: 'application/json',
    body: '{"oops":true}',
  },
  'a 200 that is not JSON': { status: 200, contentType: 'text/html', body: '<html>hi</html>' },
};

async function signedIn() {
  const { url, pending } = await beginSignIn(
    { issuer: fake.issuer, clientId: 'app', redirectUri: REDIRECT, scope: 'openid' },
    deps,
  );
  fake.claims = { nonce: pending.nonce };
  const callback = new URL(REDIRECT);
  callback.searchParams.set('code', 'code-1');
  callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
  callback.searchParams.set('iss', fake.issuer);
  return { callback: callback.href, pending };
}

async function rejection(run: () => Promise<unknown>): Promise<OduduError> {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OduduError);
  return error as OduduError;
}

describe.each(Object.entries(answers))('%s', (_name, raw) => {
  it('is a request_failed on refresh, never an invalid ID token', async () => {
    const { callback, pending } = await signedIn();
    const tokens = await completeSignIn(callback, pending, {}, deps);
    fake.tokenRaw = raw;
    const error = await rejection(() => refresh(tokens, {}, deps));
    expect(error.code).toBe('request_failed');
    expect(error.cause).toBeDefined();
  });

  it('is a request_failed on the code exchange', async () => {
    const { callback, pending } = await signedIn();
    fake.tokenRaw = raw;
    const error = await rejection(() => completeSignIn(callback, pending, {}, deps));
    expect(error.code).toBe('request_failed');
  });

  it('is a request_failed for client credentials', async () => {
    fake.tokenRaw = raw;
    const error = await rejection(() =>
      clientCredentials({ issuer: fake.issuer, clientId: 'c', auth: { secret: 's' } }, deps),
    );
    expect(error.code).toBe('request_failed');
  });
});

describe('an ID token that fails its checks', () => {
  it('is still an invalid_id_token', async () => {
    const { callback, pending } = await signedIn();
    fake.claims = { nonce: 'another-nonce' };
    const error = await rejection(() => completeSignIn(callback, pending, {}, deps));
    expect(error.code).toBe('invalid_id_token');
  });
});
