import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientCredentials } from '#/use-cases/client-credentials';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

let fake: FakeServer;
beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

describe('the requests the core makes', () => {
  it('each carry a signal that aborts them, discovery and token request alike', async () => {
    const signals = new Map<string, AbortSignal | null | undefined>();
    await clientCredentials(
      { issuer: fake.issuer, clientId: 'service-1', auth: { secret: 's' } },
      {
        allowInsecureRequests: true,
        fetch: (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          signals.set(url.slice(fake.issuer.length), init?.signal);
          return fetch(input, init);
        },
      },
    );
    expect([...signals.keys()].sort()).toEqual(['/.well-known/openid-configuration', '/token']);
    for (const signal of signals.values()) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    }
  });
});
