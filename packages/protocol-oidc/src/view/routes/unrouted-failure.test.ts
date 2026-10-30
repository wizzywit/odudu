import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerNotFound, answerServerError } from '#/view/routes/unrouted';

vi.mock('#/view/not-found-html', () => ({
  renderNotFoundPage: () => {
    throw new Error('renderer secret: select * from tenants');
  },
}));
vi.mock('#/view/server-error-html', () => ({
  renderServerErrorPage: () => {
    throw new Error('renderer secret: select * from tenants');
  },
}));

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

function build(): FastifyInstance {
  const built = Fastify({ genReqId: () => 'req-1' });
  built.setNotFoundHandler((request, reply) => answerNotFound(request, reply, { links: {} }));
  built.setErrorHandler<FastifyError>((error, request, reply) =>
    answerServerError(error, request, reply),
  );
  built.get('/boom', () => {
    throw new Error('driver secret');
  });
  app = built;
  return built;
}

describe('a renderer that throws', () => {
  it('still answers 404 with the fixed problem document, never the message', async () => {
    const res = await build().inject({ url: '/nope', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.body).not.toContain('secret');
    expect(res.json()).toMatchObject({ status: 404, instance: 'req-1' });
  });

  it('still answers 500 with the fixed problem document, never the message or a stack', async () => {
    const res = await build().inject({ url: '/boom', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.body).not.toMatch(/secret|select|at /u);
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: 'req-1',
    });
  });
});
