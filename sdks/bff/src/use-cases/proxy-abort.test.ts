import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, ORIGIN, request, signIn, START, type Clock } from '#/testing/harness';
import { startUpstream, type FakeUpstream, type Responder } from '#/testing/upstream';
import type { Bff, BffOptions } from '#/types';

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

async function eventually(condition: () => boolean, deadlineMs = 5_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (!condition() && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

async function proxied(
  respond: Responder,
  overrides: Partial<BffOptions> = {},
): Promise<{ bff: Bff; cookie: string; up: FakeUpstream }> {
  const up = await startUpstream(respond);
  upstream = up;
  const bff = makeBff(fake, clock, {
    upstreams: [{ name: 'api', origin: up.origin, pathPrefixes: ['/v1'] }],
    ...overrides,
  });
  return { bff, cookie: (await signIn(bff, fake)).cookie, up };
}

const silent: Responder = () => undefined;
const trickle: Responder = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.write('a');
  const timer = setInterval(() => response.write('a'), 20);
  response.on('close', () => {
    clearInterval(timer);
  });
};
const stallsAfterOneChunk: Responder = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.write('first');
};

describe('a browser that leaves', () => {
  it('during the wait for the upstream to answer takes the upstream request with it', async () => {
    const { bff, cookie, up } = await proxied(silent);
    const controller = new AbortController();
    const pending = bff
      .proxy(request('/proxy/api/v1/x', cookie, { headers: GUARD, signal: controller.signal }))
      .catch((error: unknown) => error);
    await eventually(() => up.started === 1);
    controller.abort();
    await pending;
    await eventually(() => up.hungUp === 1);
    expect(up.hungUp).toBe(1);
  });

  it('while the upstream trickles a body takes the upstream request with it', async () => {
    const { bff, cookie, up } = await proxied(trickle);
    const controller = new AbortController();
    const response = await bff.proxy(
      request('/proxy/api/v1/x', cookie, { headers: GUARD, signal: controller.signal }),
    );
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();
    await reader?.read().catch(() => undefined);
    await eventually(() => up.hungUp === 1);
    expect(up.hungUp).toBe(1);
  });
});

describe('an upstream body that stalls', () => {
  it('is cut after upstreamIdleMs with no chunk, and the upstream request with it', async () => {
    const { bff, cookie, up } = await proxied(stallsAfterOneChunk, { upstreamIdleMs: 150 });
    const response = await bff.proxy(request('/proxy/api/v1/x', cookie, { headers: GUARD }));
    expect(response.status).toBe(200);
    const failure = await response.text().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    await eventually(() => up.hungUp === 1);
    expect(up.hungUp).toBe(1);
  });

  it('is not cut while chunks keep arriving inside the gap', async () => {
    const { bff, cookie, up } = await proxied(trickle, { upstreamIdleMs: 400 });
    const response = await bff.proxy(request('/proxy/api/v1/x', cookie, { headers: GUARD }));
    const reader = response.body?.getReader();
    for (let chunk = 0; chunk < 25; chunk += 1) {
      const read = await reader?.read();
      expect(read?.done).toBe(false);
    }
    await reader?.cancel();
    await eventually(() => up.hungUp === 1);
  });
});
