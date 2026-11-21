import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, request, signIn, START, type Clock } from '#/testing/harness';

let fake: FakeServer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeServer();
  clock = { now: START };
  fake.idTokenAlg = 'ES256';
});
afterEach(async () => {
  await fake.close();
});

const sessionRequest = (cookie: string): Request =>
  request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } });

describe('a client registered for ES256 ID tokens', () => {
  it('is refused at the callback when the BFF expects RS256', async () => {
    const { callback } = await signIn(makeBff(fake, clock), fake);
    expect(callback.status).toBe(400);
  });

  it('signs in and refreshes when idTokenAlg is ES256', async () => {
    const bff = makeBff(fake, clock, { idTokenAlg: 'ES256' });
    const { callback, cookie } = await signIn(bff, fake);
    expect(callback.status).toBe(302);
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
    clock.now += 890_000;
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
    expect(fake.tokenRequests.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(
      1,
    );
  });
});
