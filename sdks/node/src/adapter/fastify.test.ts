import Fastify from 'fastify';
import { oduduAuth } from '#/adapter/fastify';
import { type RunningApp, describeAdapterContract } from '#/testing/adapter-contract';

describeAdapterContract('fastify', async (verifier) => {
  const errors: unknown[] = [];
  let handled = 0;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    errors.push(error);
    return reply.code(500).send({ error: 'server_error' });
  });
  await app.register(oduduAuth, { verifier });
  app.get('/open', () => ({ ok: true }));
  app.get('/reports', { onRequest: app.requireToken() }, (request) => {
    handled += 1;
    return { sub: request.auth?.sub, scope: request.auth?.scope };
  });
  app.get('/reports-write', { onRequest: app.requireToken({ scope: 'reports:write' }) }, () => {
    handled += 1;
    return { ok: true };
  });
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const running: RunningApp = {
    origin,
    errors,
    handled: () => handled,
    close: () => app.close(),
  };
  return running;
});
