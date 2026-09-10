import { type DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app.js';
import { createLogger } from '#/logger.js';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_LOG_LEVEL: 'silent',
});

function fakeDatabase(behaviour: 'ok' | 'down'): DatabaseHandle {
  const sql = (() => {
    if (behaviour === 'down') return Promise.reject(new Error('connection refused'));
    return Promise.resolve([{ ok: 1 }]);
  }) as unknown as DatabaseHandle['sql'];

  return {
    db: {} as DatabaseHandle['db'],
    sql,
    close: () => Promise.resolve(),
  };
}

function app(behaviour: 'ok' | 'down') {
  return buildApp({
    database: fakeDatabase(behaviour),
    logger: createLogger(loadConfig({ ODUDU_DATABASE_URL: config.ODUDU_DATABASE_URL })),
  });
}

describe('health endpoints', () => {
  it('reports live without touching the database', async () => {
    const response = await app('down').inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    const response = await app('ok').inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('reports 503 when the database does not answer', async () => {
    const response = await app('down').inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'failed' },
    });
  });

  it('echoes a correlation id', async () => {
    const response = await app('ok').inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'given-id' },
    });

    expect(response.headers['x-request-id']).toBe('given-id');
  });

  it('generates a correlation id when none is supplied', async () => {
    const response = await app('ok').inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
