import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, ORIGIN, request, signIn, START, type Clock } from '#/testing/harness';
import { startUpstream, type FakeUpstream, type Responder } from '#/testing/upstream';
import type { Bff } from '#/types';

let fake: FakeServer;
let upstream: FakeUpstream | undefined;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeServer();
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
  await upstream?.close();
});

const GUARD = { 'x-odudu-bff': '1', origin: ORIGIN };

async function proxied(respond: Responder): Promise<{ bff: Bff; cookie: string }> {
  upstream = await startUpstream(respond);
  const bff = makeBff(fake, clock, {
    upstreams: [{ name: 'api', origin: upstream.origin, pathPrefixes: ['/v1'] }],
  });
  return { bff, cookie: (await signIn(bff, fake)).cookie };
}

const call = (bff: Bff, cookie: string | undefined): Promise<Response> =>
  bff.proxy(request('/proxy/api/v1/items', cookie, { headers: GUARD }));

const spoofing: Responder = (_request, response) => {
  response.writeHead(401, { 'content-type': 'application/json', 'x-odudu-session': 'ended' });
  response.end('{"error":"the API says no"}');
};

describe('the session-ended marker on a proxied call', () => {
  it('is on the 401 of a request with no session', async () => {
    const { bff } = await proxied((_r, response) => response.end());
    const response = await call(bff, undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get('x-odudu-session')).toBe('ended');
  });

  it('is on the 401 of a session the issuer ended by refusing its refresh token', async () => {
    const { bff, cookie } = await proxied((_r, response) => response.end());
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_grant' };
    const response = await call(bff, cookie);
    expect(response.status).toBe(401);
    expect(response.headers.get('x-odudu-session')).toBe('ended');
  });

  it('is on the 401 of a session a refreshed ID token for another subject ended', async () => {
    const { bff, cookie } = await proxied((_r, response) => response.end());
    clock.now += 890_000;
    fake.claims = { ...fake.claims, sub: 'someone-else' };
    const response = await call(bff, cookie);
    expect(response.status).toBe(401);
    expect(response.headers.get('x-odudu-session')).toBe('ended');
  });

  it('is on the 401 of /session when the session ended', async () => {
    const { bff, cookie } = await proxied((_r, response) => response.end());
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_grant' };
    const response = await bff.session(
      request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('x-odudu-session')).toBe('ended');
  });

  it('is not on an upstream 401, and an upstream that sends it has it stripped', async () => {
    const { bff, cookie } = await proxied(spoofing);
    const response = await call(bff, cookie);
    expect(response.status).toBe(401);
    expect(response.headers.has('x-odudu-session')).toBe(false);
    expect(await response.json()).toEqual({ error: 'the API says no' });
  });

  it('is stripped from a successful upstream answer too', async () => {
    const { bff, cookie } = await proxied((_r, response) => {
      response.writeHead(200, { 'x-odudu-session': 'ended' });
      response.end('{}');
    });
    const response = await call(bff, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.has('x-odudu-session')).toBe(false);
  });

  it('is not on a plain upstream 401', async () => {
    const { bff, cookie } = await proxied((_r, response) => {
      response.writeHead(401);
      response.end();
    });
    expect((await call(bff, cookie)).headers.has('x-odudu-session')).toBe(false);
  });
});
