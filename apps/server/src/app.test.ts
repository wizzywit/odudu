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

const database: DatabaseHandle = {
  db: {} as DatabaseHandle['db'],
  sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

function appWithIpProbe(trustProxy?: boolean) {
  const app = buildApp({
    database,
    ownerDatabase: database,
    kek: config.ODUDU_KEK,
    logger: createLogger(config),
    ...(trustProxy === undefined ? {} : { trustProxy }),
  });
  app.get('/ip-probe', (request) => ({ ip: request.ip }));
  return app;
}

describe('trustProxy', () => {
  it('ignores X-Forwarded-For by default', async () => {
    const app = appWithIpProbe();
    const response = await app.inject({
      method: 'GET',
      url: '/ip-probe',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(response.json<{ ip: string }>().ip).not.toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For when explicitly set to false', async () => {
    const app = appWithIpProbe(false);
    const response = await app.inject({
      method: 'GET',
      url: '/ip-probe',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(response.json<{ ip: string }>().ip).not.toBe('203.0.113.9');
  });

  it('trusts X-Forwarded-For when enabled', async () => {
    const app = appWithIpProbe(true);
    const response = await app.inject({
      method: 'GET',
      url: '/ip-probe',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(response.json<{ ip: string }>().ip).toBe('203.0.113.9');
  });
});
