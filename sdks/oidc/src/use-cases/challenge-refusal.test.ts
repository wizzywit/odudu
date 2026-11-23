import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { clientCredentials } from '#/use-cases/client-credentials';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { createTokenSource } from '#/use-cases/token-source';
import { refresh } from '#/use-cases/refresh';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

const NOW = 1_800_000_000_000;
const deps = { allowInsecureRequests: true, now: () => NOW };
const REDIRECT = 'http://localhost:5173/callback';
const SECRET = 'eyJhbGciOiJSUzI1NiJ9.hostile-token-looking-text';
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

// Each path is prepared while the token endpoint still works, and returns the
// call that meets the refusal.
const paths: Record<string, () => Promise<() => Promise<unknown>>> = {
  clientCredentials: () =>
    Promise.resolve(() =>
      clientCredentials({ issuer: fake.issuer, clientId: 'c', auth: { secret: 's' } }, deps),
    ),
  createTokenSource: () =>
    Promise.resolve(
      createTokenSource({ issuer: fake.issuer, clientId: 'c', auth: { secret: 's' } }, deps),
    ),
  completeSignIn: async () => {
    const { url, pending } = await beginSignIn(
      { issuer: fake.issuer, clientId: 'app', redirectUri: REDIRECT, scope: 'openid' },
      deps,
    );
    const callback = new URL(REDIRECT);
    callback.searchParams.set('code', 'code-1');
    callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
    callback.searchParams.set('iss', fake.issuer);
    fake.claims = { nonce: pending.nonce };
    return () => completeSignIn(callback.href, pending, {}, deps);
  },
  refresh: async () => {
    const { url, pending } = await beginSignIn(
      { issuer: fake.issuer, clientId: 'app', redirectUri: REDIRECT, scope: 'openid' },
      deps,
    );
    fake.claims = { nonce: pending.nonce };
    const callback = new URL(REDIRECT);
    callback.searchParams.set('code', 'code-1');
    callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
    callback.searchParams.set('iss', fake.issuer);
    const tokens = await completeSignIn(callback.href, pending, {}, deps);
    return () => refresh(tokens, {}, deps);
  },
};

async function rejection(run: () => Promise<unknown>): Promise<OduduError> {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OduduError);
  return error as OduduError;
}

function shape(error: OduduError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.message,
    error: error.error,
    errorDescription: error.errorDescription,
    cause: error.cause,
  };
}

function expectNothingEchoed(error: OduduError): void {
  const seen = JSON.stringify([
    error.message,
    error.cause instanceof Error ? error.cause.message : '',
    error.stack ?? '',
  ]);
  expect(seen).not.toContain(SECRET);
  expect(seen).not.toContain('hostile');
}

describe.each(Object.entries(paths))(
  'a 401 challenge from the token endpoint, in %s',
  (_name, prepare) => {
    const hostile = {
      error: 'invalid_client',
      error_description: `${SECRET} ${'long '.repeat(200)}`,
    };

    // Today's path for a 400 body carries the server's code and its
    // `error_description` on the error, a fixed message, and no cause; the
    // challenge path answers identically.
    it('answers as a refusal with a body does, with the same fields', async () => {
      const run = await prepare();
      fake.tokenError = hostile;
      const withBody = await rejection(run);
      fake.tokenChallenge = true;
      const withChallenge = await rejection(run);
      expect(withChallenge.code).toBe('invalid_client');
      expect(shape(withChallenge)).toEqual(shape(withBody));
      expect(withChallenge.cause).toBeUndefined();
      expect(withChallenge.message).not.toContain(SECRET);
    });

    it('maps an error code it does not know to unrecognized_error', async () => {
      const run = await prepare();
      fake.tokenChallenge = true;
      fake.tokenError = { error: 'brand_new_error' };
      const error = await rejection(run);
      expect(error.code).toBe('unrecognized_error');
      expect(error.error).toBe('brand_new_error');
    });

    const unreadable: [string, Buffer][] = [
      ['an HTML page', Buffer.from(`<html><body>${SECRET} hostile</body></html>`)],
      ['JSON with no error', Buffer.from(JSON.stringify({ detail: `${SECRET} hostile` }))],
      [
        'JSON whose error is not a string',
        Buffer.from(JSON.stringify({ error: 5, hostile: SECRET })),
      ],
      ['JSON that is not an object', Buffer.from(JSON.stringify([SECRET, 'hostile']))],
      [
        'bytes that are not UTF-8',
        Buffer.concat([Buffer.from('{"error":"invalid_client","x":"'), Buffer.from([0xff, 0xfe])]),
      ],
      ['an empty body', Buffer.alloc(0)],
      [
        'a body over the limit that declares its length',
        Buffer.from(`{"error":"invalid_client","pad":"${'x'.repeat(100_000)}"}`),
      ],
    ];
    it.each(unreadable)('stays request_failed and echoes nothing for %s', async (_label, body) => {
      const run = await prepare();
      fake.tokenChallenge = true;
      fake.tokenChallengeBody = body;
      const error = await rejection(run);
      expect(error.code).toBe('request_failed');
      expect(error.message).toBe('the token request did not complete');
      expect(error.error).toBeUndefined();
      expect(error.errorDescription).toBeUndefined();
      expectNothingEchoed(error);
    });

    it('stops reading a body that never ends, and rejects promptly', async () => {
      const run = await prepare();
      fake.tokenChallenge = true;
      fake.tokenChallengeBody = 'endless';
      const started = Date.now();
      const error = await rejection(run);
      expect(error.code).toBe('request_failed');
      expect(Date.now() - started).toBeLessThan(3000);
    });
  },
);
