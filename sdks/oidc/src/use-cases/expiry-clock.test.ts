import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { clientCredentials } from '#/use-cases/client-credentials';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { refresh } from '#/use-cases/refresh';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import type { Deps } from '#/types';

const START = 1_800_000_000_000;
const SLOW_BY = 20_000;
const REDIRECT = 'http://localhost:5173/callback';
let fake: FakeServer;
let clock: number;

beforeEach(async () => {
  fake = await startFakeServer();
  clock = START;
});
afterEach(async () => {
  await fake.close();
});

// A server that takes `SLOW_BY` ms to answer a token request, on the injected clock.
function slowDeps(): Deps {
  return {
    allowInsecureRequests: true,
    now: () => clock,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.url.endsWith('/token')) clock += SLOW_BY;
      return response;
    },
  };
}

describe('the expiry of a token that took a while to arrive', () => {
  it('is counted from before the client credentials request', async () => {
    fake.expiresIn = 60;
    const token = await clientCredentials(
      { issuer: fake.issuer, clientId: 'service-1', auth: { secret: 's' } },
      slowDeps(),
    );
    expect(token.expiresAt).toBe(START + 60_000);
  });

  it('is counted from before the code exchange', async () => {
    fake.expiresIn = 60;
    const deps = slowDeps();
    const { url, pending } = await beginSignIn(
      { issuer: fake.issuer, clientId: 'app-1', redirectUri: REDIRECT, scope: 'openid' },
      deps,
    );
    fake.claims = { nonce: pending.nonce };
    const callback = new URL(REDIRECT);
    callback.searchParams.set('code', 'code-1');
    callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
    callback.searchParams.set('iss', fake.issuer);
    const tokens = await completeSignIn(callback.href, pending, deps);
    expect(tokens.byAudience[fake.issuer]?.expiresAt).toBe(START + 60_000);
  });

  it('is counted from before the refresh request', async () => {
    const deps = slowDeps();
    const { url, pending } = await beginSignIn(
      { issuer: fake.issuer, clientId: 'app-1', redirectUri: REDIRECT, scope: 'openid' },
      deps,
    );
    fake.claims = { nonce: pending.nonce };
    const callback = new URL(REDIRECT);
    callback.searchParams.set('code', 'code-1');
    callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
    callback.searchParams.set('iss', fake.issuer);
    const tokens = await completeSignIn(callback.href, pending, deps);
    fake.expiresIn = 60;
    clock = START;
    const renewed = await refresh(tokens, {}, deps);
    expect(renewed.byAudience[fake.issuer]?.expiresAt).toBe(START + 60_000);
  });
});
