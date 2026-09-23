import { type DatabaseHandle } from '@odudu/db';
import { loadConfig, type Logger } from '@odudu/kernel';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
});

function capture(): { stream: Writable; lines: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, lines: () => chunks.join('') };
}

describe('createLogger', () => {
  it('drops the authorization header (not on the allowlist)', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { authorization: 'Bearer super-secret-token' } } }, 'incoming');

    expect(lines()).not.toContain('super-secret-token');
    expect(lines()).not.toContain('authorization');
  });

  it('drops the cookie header (not on the allowlist)', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { cookie: '__Host-alpha-session=abc123' } } }, 'incoming');

    expect(lines()).not.toContain('abc123');
    expect(lines()).not.toContain('cookie');
  });

  it('drops a randomly-named secret-bearing header the allowlist has never heard of', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const headerName = `x-secret-${Math.random().toString(36).slice(2)}`;

    logger.info({ req: { headers: { [headerName]: 'super-secret-value-xyz' } } }, 'incoming');

    expect(lines()).not.toContain('super-secret-value-xyz');
    expect(lines()).not.toContain(headerName);
  });

  it('keeps an operationally useful allowlisted header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { 'user-agent': 'curl/8.0' } } }, 'incoming');

    expect(lines()).toContain('curl/8.0');
  });

  it('strips the query string from the logged url', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info(
      { req: { url: '/authorize?state=super-secret-state&code=super-secret-code' } },
      'incoming',
    );

    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).toContain('/authorize');
  });

  it('strips the query string from a logged location header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info(
      {
        res: {
          statusCode: 302,
          getHeaders: () => ({
            location: 'https://client.example/cb?code=super-secret-code&state=super-secret-state',
          }),
        },
      },
      'request completed',
    );

    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).toContain('https://client.example/cb');
  });

  it('strips the fragment from a logged location header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info(
      {
        res: {
          statusCode: 302,
          getHeaders: () => ({
            location: 'https://client.example/cb#code=super-secret-code&state=super-secret-state',
          }),
        },
      },
      'request completed',
    );

    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).toContain('https://client.example/cb');
  });

  it('drops a response header that is not on the allowlist', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info(
      {
        res: {
          statusCode: 200,
          getHeaders: () => ({
            'content-security-policy': "script-src 'nonce-super-secret-nonce'",
          }),
        },
      },
      'request completed',
    );

    expect(lines()).not.toContain('super-secret-nonce');
    expect(lines()).not.toContain('content-security-policy');
  });

  it('keeps the diagnostic response headers', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info(
      {
        res: {
          statusCode: 401,
          getHeaders: () => ({
            'www-authenticate': 'Bearer realm="alpha", error="invalid_token"',
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'retry-after': '30',
          }),
        },
      },
      'request completed',
    );

    expect(lines()).toContain('invalid_token');
    expect(lines()).toContain('application/json');
    expect(lines()).toContain('no-store');
    expect(lines()).toContain('retry-after');
  });

  it('satisfies the kernel Logger interface', () => {
    const kernelLogger: Logger = createLogger(config);
    expect(typeof kernelLogger.child).toBe('function');
  });

  it('drops the authorization header on a real request logged through the running app', async () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const database: DatabaseHandle = {
      db: {} as DatabaseHandle['db'],
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    };
    const app = buildApp({
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger,
    });

    await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { authorization: 'Bearer super-secret-token' },
    });

    expect(lines()).not.toContain('super-secret-token');
    expect(lines()).not.toContain('authorization');
  });

  it('drops the query string from a real request logged through the running app', async () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const database: DatabaseHandle = {
      db: {} as DatabaseHandle['db'],
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    };
    const app = buildApp({
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger,
    });
    app.get('/authorize-probe', () => ({ ok: true }));

    await app.inject({
      method: 'GET',
      url: '/authorize-probe?state=super-secret-state&code=super-secret-code',
    });

    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).toContain('/authorize-probe');
  });

  it('drops the authorization code from a real redirect logged through the running app', async () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const database: DatabaseHandle = {
      db: {} as DatabaseHandle['db'],
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    };
    const app = buildApp({
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger,
    });
    app.get('/authorize-redirect-probe', (_request, reply) =>
      reply
        .code(302)
        .header(
          'location',
          'https://client.example/cb?code=super-secret-code&state=super-secret-state',
        )
        .send(),
    );

    await app.inject({ method: 'GET', url: '/authorize-redirect-probe' });

    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).toContain('https://client.example/cb');
  });

  it('drops a real set-cookie response header logged through the running app', async () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const database: DatabaseHandle = {
      db: {} as DatabaseHandle['db'],
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    };
    const app = buildApp({
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger,
    });
    app.get('/cookie-write-probe', (_request, reply) => {
      reply.header('set-cookie', '__Host-alpha-session=super-secret-cookie-value');
      return { ok: true };
    });

    await app.inject({ method: 'GET', url: '/cookie-write-probe' });

    expect(lines()).not.toContain('super-secret-cookie-value');
    expect(lines()).not.toContain('set-cookie');
  });
});
