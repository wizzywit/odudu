import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { createTokenSource } from '#/use-cases/token-source';

let fake: FakeServer;
let clock: number;
const START = 1_800_000_000_000;
const deps = () => ({ allowInsecureRequests: true, now: () => clock });

beforeEach(async () => {
  clock = START;
  fake = await startFakeServer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fake.close();
});

function source(extra: { skewMs?: number } = {}): () => Promise<string> {
  return createTokenSource(
    { issuer: fake.issuer, clientId: 'service-1', auth: { secret: 's' }, scope: 'a', ...extra },
    deps(),
  );
}

describe('createTokenSource', () => {
  it('rejects with invalid_client when the server refuses the secret with a challenge', async () => {
    fake.tokenChallenge = true;
    fake.tokenError = { error: 'invalid_client' };
    const error = await source()().catch((e: unknown) => e);
    expect((error as OduduError).code).toBe('invalid_client');
  });

  it('reuses the token until 30 s before expiry', async () => {
    fake.expiresIn = 900;
    const token = source();
    expect(await token()).toBe('client-token-1');
    clock = START + 869_000;
    expect(await token()).toBe('client-token-1');
    expect(fake.clientCredentialsGrants).toBe(1);
    clock = START + 870_000;
    expect(await token()).toBe('client-token-2');
    expect(fake.clientCredentialsGrants).toBe(2);
  });

  it('renews skewMs before expiry when the caller sets it', async () => {
    fake.expiresIn = 100;
    const token = source({ skewMs: 10_000 });
    await token();
    clock = START + 89_000;
    await token();
    expect(fake.clientCredentialsGrants).toBe(1);
    clock = START + 90_000;
    await token();
    expect(fake.clientCredentialsGrants).toBe(2);
  });

  it('renews a short token after half its lifetime, not on every call', async () => {
    fake.expiresIn = 10;
    const token = source();
    await token();
    clock = START + 4_999;
    await token();
    await token();
    expect(fake.clientCredentialsGrants).toBe(1);
    clock = START + 5_000;
    await token();
    expect(fake.clientCredentialsGrants).toBe(2);
  });

  it('caps the skew at half the lifetime for a 30 s token too', async () => {
    fake.expiresIn = 30;
    const token = source();
    await token();
    clock = START + 14_999;
    await token();
    expect(fake.clientCredentialsGrants).toBe(1);
    clock = START + 15_000;
    await token();
    expect(fake.clientCredentialsGrants).toBe(2);
  });

  it('treats a response without expires_in as a 60 s token', async () => {
    fake.expiresIn = undefined;
    const token = source();
    await token();
    clock = START + 29_999;
    await token();
    expect(fake.clientCredentialsGrants).toBe(1);
    clock = START + 30_000;
    await token();
    expect(fake.clientCredentialsGrants).toBe(2);
  });

  for (const unusable of [0, -5, 'soon']) {
    it(`treats expires_in ${JSON.stringify(unusable)} as a 60 s token`, async () => {
      fake.expiresIn = unusable;
      const token = source();
      await token();
      clock = START + 29_999;
      await token();
      expect(fake.clientCredentialsGrants).toBe(1);
      clock = START + 30_000;
      await token();
      expect(fake.clientCredentialsGrants).toBe(2);
    });
  }

  it('makes one renewal under concurrent calls', async () => {
    const token = source();
    const results = await Promise.all(Array.from({ length: 10 }, () => token()));
    expect(new Set(results)).toEqual(new Set(['client-token-1']));
    expect(fake.clientCredentialsGrants).toBe(1);
  });

  it('rejects every waiter of a failed renewal with one error and retries on the next call', async () => {
    const token = source();
    fake.tokenError = { error: 'invalid_client' };
    const outcomes = await Promise.allSettled([token(), token(), token()]);
    const reasons = outcomes.map((o) => (o.status === 'rejected' ? (o.reason as unknown) : null));
    expect(reasons[0]).toBeInstanceOf(OduduError);
    expect(reasons[1]).toBe(reasons[0]);
    expect(reasons[2]).toBe(reasons[0]);
    expect(fake.tokenRequests).toHaveLength(1);
    fake.tokenError = undefined;
    expect(await token()).toBe('client-token-1');
    expect(fake.tokenRequests).toHaveLength(2);
  });

  it('holds no timer', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const token = source();
    await token();
    // Positive control: the spy does see the HTTP client's own timers.
    expect(timeout).toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    // The HTTP client sets short timers of its own; a renewal timer would wait
    // for the token to age, minutes at least.
    const delays = timeout.mock.calls.map(([, delay]) => delay ?? 0);
    expect(Math.max(0, ...delays)).toBeLessThan(10_000);
  });
});
