import { type HostState } from '@odudu/domain-tenant';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDomainCheck } from '#/domain-check';
import { slidingWindow } from '#/throttle';

const LIVE: HostState = {
  kind: 'live',
  route: { tenantId: 't', tenantName: 'acme', canonical: true, retiredUntil: null },
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function start(states: Record<string, HostState>, limit = 1000) {
  const asked: string[] = [];
  const instance = Fastify();
  registerDomainCheck(instance, {
    state: (host) => {
      asked.push(host);
      return Promise.resolve(states[host] ?? { kind: 'unknown' });
    },
    throttle: slidingWindow({ limit, windowSeconds: 60, now: () => new Date() }),
  });
  app = instance;
  return { app: instance, asked };
}

const ask = (instance: FastifyInstance, query: string, host?: string) =>
  instance.inject({
    method: 'GET',
    url: `/internal/domain-check${query}`,
    ...(host === undefined ? {} : { headers: { host } }),
  });

describe('GET /internal/domain-check', () => {
  it('answers 200 with no body for a live host and asks once', async () => {
    const { app: instance, asked } = start({ 'login.acme.com': LIVE });
    const res = await ask(instance, '?domain=login.acme.com');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(asked).toEqual(['login.acme.com']);
  });

  it('[ODUDU-HOST-CHECK-01] answers 404 with no body for a host that is not live or not known', async () => {
    const { app: instance } = start({ 'p.acme.com': { kind: 'not_live' } });
    for (const query of ['?domain=p.acme.com', '?domain=nobody.example.com']) {
      const res = await ask(instance, query);
      expect(res.statusCode, query).toBe(404);
      expect(res.body, query).toBe('');
    }
  });

  it('reads the host in any spelling of it', async () => {
    const { app: instance, asked } = start({ 'login.acme.com': LIVE });
    expect((await ask(instance, '?domain=LOGIN.Acme.com.')).statusCode).toBe(200);
    expect(asked).toEqual(['login.acme.com']);
  });

  it('refuses what is no registrable host without reading', async () => {
    const { app: instance, asked } = start({ 'login.acme.com': LIVE });
    for (const query of [
      '',
      '?domain=',
      '?domain=login.acme.com&domain=login.acme.com',
      '?domain=127.0.0.1',
      '?domain=%5B%3A%3A1%5D',
      '?domain=login.acme.com:8443',
      '?domain=localhost',
      '?other=login.acme.com',
    ]) {
      const res = await ask(instance, query);
      expect(res.statusCode, query).toBe(404);
      expect(res.body, query).toBe('');
    }
    expect(asked).toEqual([]);
  });

  it('[ODUDU-HOST-CHECK-01] answers 200 and 404 with the same headers', async () => {
    const { app: instance } = start({ 'login.acme.com': LIVE });
    const live = await ask(instance, '?domain=login.acme.com');
    const gone = await ask(instance, '?domain=nobody.example.com');
    const liveHeaders: Record<string, unknown> = { ...live.headers };
    const goneHeaders: Record<string, unknown> = { ...gone.headers };
    delete liveHeaders.date;
    delete goneHeaders.date;
    expect(liveHeaders).toEqual(goneHeaders);
  });

  it('answers the same whatever the Host is', async () => {
    const { app: instance } = start({ 'login.acme.com': LIVE });
    for (const host of ['odudu:3000', 'login.acme.com', 'unknown.example']) {
      expect((await ask(instance, '?domain=login.acme.com', host)).statusCode, host).toBe(200);
      expect((await ask(instance, '?domain=nobody.example.com', host)).statusCode, host).toBe(404);
    }
  });

  it('answers 429 with Retry-After and no body past its budget', async () => {
    const { app: instance } = start({ 'login.acme.com': LIVE }, 2);
    expect((await ask(instance, '?domain=login.acme.com')).statusCode).toBe(200);
    expect((await ask(instance, '?domain=nobody.example.com')).statusCode).toBe(404);
    const res = await ask(instance, '?domain=login.acme.com');
    expect(res.statusCode).toBe(429);
    expect(res.body).toBe('');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('does not read once the budget is spent', async () => {
    const { app: instance, asked } = start({}, 1);
    await ask(instance, '?domain=a.example.com');
    await ask(instance, '?domain=b.example.com');
    expect(asked).toEqual(['a.example.com']);
  });
});
