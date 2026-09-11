import { type DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
  ODUDU_LOG_LEVEL: 'silent',
});

function fakeDatabase(behaviour: 'ok' | 'down'): DatabaseHandle & { calls: number } {
  const state = { calls: 0 };

  const sql = (() => {
    state.calls += 1;
    if (behaviour === 'down') throw new Error('connection refused');
    return Promise.resolve([{ ok: 1 }]);
  }) as unknown as DatabaseHandle['sql'];

  return {
    db: {} as DatabaseHandle['db'],
    sql,
    close: () => Promise.resolve(),
    get calls() {
      return state.calls;
    },
  };
}

function app(behaviour: 'ok' | 'down') {
  const database = fakeDatabase(behaviour);
  return {
    app: buildApp({
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
    }),
    database,
  };
}

describe('health endpoints', () => {
  it('reports live without touching the database', async () => {
    const { app: instance, database } = app('down');
    const response = await instance.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(database.calls).toBe(0);
  });

  it('reports ready when the database answers', async () => {
    const response = await app('ok').app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('reports 503 when the database does not answer', async () => {
    const response = await app('down').app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'failed' },
    });
  });

  it('echoes a correlation id', async () => {
    const response = await app('ok').app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'given-id' },
    });

    expect(response.headers['x-request-id']).toBe('given-id');
  });

  it('generates a correlation id when none is supplied', async () => {
    const response = await app('ok').app.inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
