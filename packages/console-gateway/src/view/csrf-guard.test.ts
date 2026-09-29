import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCsrfGuard } from '#/view/csrf-guard';

const ORIGIN = 'https://console.example.test';
const GOOD = { origin: ORIGIN, 'x-odudu-console': '1' };

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

async function guarded(): Promise<{ app: FastifyInstance; reached: string[] }> {
  const reached: string[] = [];
  const instance = Fastify();
  instance.register(
    (api) => {
      registerCsrfGuard(api, ORIGIN);
      api.post('/admin/things', (_request, reply) => {
        reached.push('handler');
        return reply.send({ ok: true });
      });
      api.get('/session', (_request, reply) => reply.send({ ok: true }));
      return Promise.resolve();
    },
    { prefix: '/console/api' },
  );
  instance.post('/elsewhere', (_request, reply) => reply.send({ ok: true }));
  await instance.ready();
  app = instance;
  return { app: instance, reached };
}

describe('the console CSRF guard', () => {
  it.each([
    ['no Origin', { 'x-odudu-console': '1' }],
    ['another origin', { ...GOOD, origin: 'https://evil.example' }],
    ['no console header', { origin: ORIGIN }],
  ])('refuses a POST with %s before its handler runs', async (_label, headers) => {
    const { app: server, reached } = await guarded();

    const res = await server.inject({
      method: 'POST',
      url: '/console/api/admin/things',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403 });
    expect(reached).toEqual([]);
  });

  it('lets a POST carrying both through to its handler', async () => {
    const { app: server, reached } = await guarded();

    const res = await server.inject({
      method: 'POST',
      url: '/console/api/admin/things',
      headers: { ...GOOD, 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(reached).toEqual(['handler']);
  });

  it('asks nothing of a GET, and nothing of a route outside its scope', async () => {
    const { app: server } = await guarded();

    expect((await server.inject({ url: '/console/api/session' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url: '/elsewhere' })).statusCode).toBe(200);
  });
});
