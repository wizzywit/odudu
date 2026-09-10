import { type DatabaseHandle } from '@odudu/db';
import { loadConfig, type Logger } from '@odudu/kernel';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app.js';
import { createLogger } from '#/logger.js';

const config = loadConfig({ ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu' });

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
  it('redacts the authorization header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { authorization: 'Bearer super-secret-token' } } }, 'incoming');

    expect(lines()).not.toContain('super-secret-token');
    expect(lines()).toContain('[redacted]');
  });

  it('redacts the cookie header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { cookie: '__Host-alpha-session=abc123' } } }, 'incoming');

    expect(lines()).not.toContain('abc123');
  });

  it('satisfies the kernel Logger interface', () => {
    const kernelLogger: Logger = createLogger(config);
    expect(typeof kernelLogger.child).toBe('function');
  });

  it('redacts the authorization header on a real request logged through the running app', async () => {
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
    expect(lines()).toContain('[redacted]');
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
