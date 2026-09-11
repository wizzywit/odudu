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
    const app = buildApp({ database, logger });

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
    const app = buildApp({ database, logger });
    app.get('/authorize-probe', () => ({ ok: true }));

    await app.inject({
      method: 'GET',
      url: '/authorize-probe?state=super-secret-state&code=super-secret-code',
    });

    expect(lines()).not.toContain('super-secret-state');
    expect(lines()).not.toContain('super-secret-code');
    expect(lines()).toContain('/authorize-probe');
  });

  it('redacts a real set-cookie response header logged through the running app', async () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);
    const database: DatabaseHandle = {
      db: {} as DatabaseHandle['db'],
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    };
    const app = buildApp({ database, logger });
    app.get('/set-cookie-probe', (_request, reply) => {
      reply.header('set-cookie', '__Host-alpha-session=super-secret-cookie-value');
      return { ok: true };
    });

    await app.inject({ method: 'GET', url: '/set-cookie-probe' });

    expect(lines()).not.toContain('super-secret-cookie-value');
    expect(lines()).toContain('[redacted]');
  });
});
