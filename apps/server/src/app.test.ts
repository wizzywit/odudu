import { type DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { AUDIT_REFUSAL_ROWS_PER_CLIENT, auditRefusalBudget, buildApp } from '#/app';
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

// Answers every `select().from().where()` chain with no rows, so a route
// that resolves `{tenant}` from the path before doing anything else finds
// no tenant rather than throwing on a db that answers nothing at all.
const noSuchTenantDatabase: DatabaseHandle = {
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as DatabaseHandle['db'],
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

describe('admin routes', () => {
  it('serves the admin API and leaves the OIDC routes alone', async () => {
    const app = buildApp({
      database: noSuchTenantDatabase,
      ownerDatabase: noSuchTenantDatabase,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
    });

    const res = await app.inject({ method: 'GET', url: '/admin/tenants/acme/subjects' });
    expect(res.statusCode).toBe(401);

    const discovery = await app.inject({
      method: 'GET',
      url: '/tenants/acme/.well-known/openid-configuration',
    });
    expect(discovery.statusCode).not.toBe(401);
  });
});

describe('auditRefusalBudget', () => {
  it('answers row until the last row of the window, then log until it reopens', () => {
    let now = new Date('2026-09-26T00:00:00Z');
    const budget = auditRefusalBudget(() => now);

    const answers = Array.from({ length: AUDIT_REFUSAL_ROWS_PER_CLIENT + 2 }, () =>
      budget.take('tenant:client'),
    );

    expect(answers.filter((answer) => answer === 'row')).toHaveLength(
      AUDIT_REFUSAL_ROWS_PER_CLIENT - 1,
    );
    expect(answers.slice(AUDIT_REFUSAL_ROWS_PER_CLIENT - 1)).toEqual(['last_row', 'log', 'log']);
    expect(budget.take('tenant:another-client')).toBe('row');

    now = new Date(now.getTime() + 61_000);
    expect(budget.take('tenant:client')).toBe('row');
  });
});
