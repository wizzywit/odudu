import { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { frameworkError, sendBrandMiss } from '#/brand-routes';

function answer(url: string, error: { code: string; message: string; statusCode?: number }) {
  const sent: { code?: number; body?: unknown } = {};
  const reply = {
    code(status: number) {
      sent.code = status;
      return reply;
    },
    header() {
      return reply;
    },
    send(body?: unknown) {
      sent.body = body;
      return reply;
    },
  };
  frameworkError(error, { url } as FastifyRequest, reply as unknown as FastifyReply);
  return sent;
}

describe('frameworkError outside the brand routes', () => {
  it.each([
    ['FST_ERR_MAX_PARAM_LENGTH', 414, 'Bad Request'],
    ['FST_ERR_BAD_URL', 400, 'Bad Request'],
    ['FST_ERR_ASYNC_CONSTRAINT', 500, 'Internal Server Error'],
  ])('labels %s as a %i %s', (code, statusCode, label) => {
    expect(answer('/tenants/x/login', { code, message: 'm', statusCode })).toEqual({
      code: statusCode,
      body: { error: label, code, message: 'm', statusCode },
    });
  });

  it('defaults to 400 when the error names no status', () => {
    expect(answer('/x', { code: 'C', message: 'm' }).code).toBe(400);
  });
});

describe('sendBrandMiss', () => {
  it('answers a bare 404 under the same sandbox as a served file', () => {
    const headers = new Map<string, string>();
    let code = 0;
    const reply = {
      code(status: number) {
        code = status;
        return reply;
      },
      header(name: string, value: string) {
        headers.set(name, value);
        return reply;
      },
      send() {
        return reply;
      },
    };
    sendBrandMiss(reply as unknown as FastifyReply);
    expect(code).toBe(404);
    expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cache-control')).toBe('no-store');
  });
});
