import { type DatabaseHandle } from '@odudu/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type OduduPort } from '#/service/odudu-port';
import { type Semaphore } from '#/service/semaphore';
import { type SingleFlight } from '#/service/single-flight';
import { type FreshToken } from '#/usecase/fresh-access-token';
import { registerConsoleApi, type ApiDeps } from '#/view/api';
import { spaRoutes } from '#/view/spa';

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'dist');

// Never called: every path these tests exercise is refused before it
// would touch a session, a refresh or the admin proxy.
const deps: ApiDeps = {
  database: {} as unknown as DatabaseHandle,
  tls: false,
  kek: new Uint8Array(32),
  odudu: {} as unknown as OduduPort,
  refreshes: {} as unknown as SingleFlight<string, FreshToken>,
  refreshSlots: {} as unknown as Semaphore,
  now: () => new Date(0),
  origin: 'https://console.example.test',
};

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  app.register(
    (api) => {
      registerConsoleApi(api, deps);
      return Promise.resolve();
    },
    { prefix: '/console/api' },
  );
  await app.register(spaRoutes(FIXTURE_DIR));
  await app.ready();
  return app;
}

describe('registerConsoleApi claims its whole prefix', () => {
  it('answers its own problem 404 for an unmatched route, not the shell', async () => {
    const app = await build();

    const res = await app.inject({ url: '/console/api/no-such-route' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.json()).toMatchObject({ type: 'about:blank#not-found', status: 404 });
    await app.close();
  });

  it('claims the bare prefix too, with no trailing segment', async () => {
    const app = await build();

    const res = await app.inject({ url: '/console/api' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.json()).toMatchObject({ type: 'about:blank#not-found', status: 404 });
    await app.close();
  });
});
