import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { cookieSet, makeBff, request, signIn, START, type Clock } from '#/testing/harness';

let fake: FakeServer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeServer();
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
});

const answers = {
  'a 502 HTML page': { status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' },
  'a 429 with no body': { status: 429, body: '' },
  'a 500 JSON body without an error member': {
    status: 500,
    contentType: 'application/json',
    body: '{"oops":true}',
  },
};
const sessionRequest = (cookie: string): Request =>
  request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } });

describe.each(Object.entries(answers))('when the token endpoint answers %s', (_name, raw) => {
  it('keeps the session through a refresh and answers 503', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenRaw = raw;
    const failed = await bff.session(sessionRequest(cookie));
    expect(failed.status).toBe(503);
    expect(failed.headers.get('x-odudu-session')).toBeNull();
    expect(failed.headers.getSetCookie()).toHaveLength(0);
    fake.tokenRaw = undefined;
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
  });

  it('answers 502 to a callback, not 400', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.tokenRaw = raw;
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const response = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(response.status).toBe(502);
  });
});
