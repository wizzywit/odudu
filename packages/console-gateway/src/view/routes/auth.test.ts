import Fastify, { type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CompleteLoginDeps } from '#/usecase/complete-login';
import { type LoginDeps } from '#/usecase/begin-login';
import { registerAuthRoutes, type AuthRouteDeps } from '#/view/routes/auth';
import { type LogoutRouteDeps } from '#/view/routes/logout';
import { spaRoutes } from '#/view/spa';

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'dist');

// Never called: every path these tests exercise is refused before it
// would begin, complete or log out of a session.
const deps: AuthRouteDeps = {
  login: {} as unknown as LoginDeps,
  callback: {} as unknown as CompleteLoginDeps,
  logout: {} as unknown as LogoutRouteDeps,
  tls: false,
  now: () => new Date(0),
  origin: 'https://console.example.test',
};

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  app.register(
    (auth) => {
      registerAuthRoutes(auth, deps);
      return Promise.resolve();
    },
    { prefix: '/console/auth' },
  );
  await app.register(spaRoutes(FIXTURE_DIR));
  await app.ready();
  return app;
}

describe('registerAuthRoutes claims its whole prefix', () => {
  it('answers its own refusal for an unmatched route, not the shell', async () => {
    const app = await build();

    const res = await app.inject({ url: '/console/auth/no-such-route' });

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('sign-in could not be completed');
    await app.close();
  });

  it('claims the bare prefix too, with no trailing segment', async () => {
    const app = await build();

    const res = await app.inject({ url: '/console/auth' });

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('sign-in could not be completed');
    await app.close();
  });
});
