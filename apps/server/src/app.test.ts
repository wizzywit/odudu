import { type DatabaseHandle } from '@odudu/db';
import { inertDatabase } from '@odudu/db/testing';
import { loadConfig } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { AUDIT_REFUSAL_ROWS_PER_CLIENT, auditRefusalBudget, buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
  ODUDU_LOG_LEVEL: 'silent',
});

const database: DatabaseHandle = {
  db: inertDatabase(),
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
    tls: false,
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

// The throttle runs at onRequest, before the tenant is looked up, so a
// database with no tenants is enough to see which requests it refuses.
describe('the per-origin throttle keys an address by its network', () => {
  const RESET = '/tenants/acme/login-actions/reset-password';

  function throttledApp(trustProxy = false) {
    return buildApp({
      tls: false,
      database: noSuchTenantDatabase,
      ownerDatabase: noSuchTenantDatabase,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
      trustProxy,
      throttle: { limit: 3, windowSeconds: 60 },
    });
  }

  async function spend(
    app: ReturnType<typeof throttledApp>,
    remoteAddress: string,
    headers: Record<string, string> = {},
  ): Promise<number> {
    const response = await app.inject({ method: 'POST', url: RESET, remoteAddress, headers });
    return response.statusCode;
  }

  it('shares one budget across every address in an IPv6 /64', async () => {
    const app = throttledApp();
    for (const address of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:ffff::3']) {
      expect(await spend(app, address)).not.toBe(429);
    }

    expect(await spend(app, '2001:db8:1:2:abcd::4')).toBe(429);
    expect(await spend(app, '2001:db8:1:3::1')).not.toBe(429);
  });

  it('counts an IPv4-mapped IPv6 peer against its IPv4 address', async () => {
    const app = throttledApp();
    expect(await spend(app, '198.51.100.7')).not.toBe(429);
    expect(await spend(app, '::ffff:198.51.100.7')).not.toBe(429);
    expect(await spend(app, '198.51.100.7')).not.toBe(429);

    expect(await spend(app, '::ffff:198.51.100.7')).toBe(429);
    expect(await spend(app, '198.51.100.8')).not.toBe(429);
  });

  it('ignores a forwarded address when the proxy is not trusted, so a client cannot pick its key', async () => {
    const app = throttledApp(false);
    for (const forwarded of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      expect(await spend(app, '198.51.100.7', { 'x-forwarded-for': forwarded })).not.toBe(429);
    }

    expect(await spend(app, '198.51.100.7', { 'x-forwarded-for': '203.0.113.4' })).toBe(429);
  });

  it('keys by the forwarded address when the proxy is trusted, whatever the socket', async () => {
    const app = throttledApp(true);
    for (let n = 0; n < 8; n += 1) {
      const forwarded = { 'x-forwarded-for': `203.0.113.${String(n)}` };
      expect(await spend(app, '10.0.0.1', forwarded)).not.toBe(429);
    }

    expect(await spend(app, '10.0.0.1', { 'x-forwarded-for': '203.0.113.0' })).not.toBe(429);
  });

  it('keys a forwarded address the same way, behind a trusted proxy', async () => {
    const app = throttledApp(true);
    const forwarded = (address: string) => ({ 'x-forwarded-for': address });
    for (const address of ['2001:db8:9:9::1', '2001:DB8:9:9:0:0:0:2', '2001:db8:9:9::3']) {
      expect(await spend(app, '10.0.0.1', forwarded(address))).not.toBe(429);
    }

    expect(await spend(app, '10.0.0.1', forwarded('2001:db8:9:9::4'))).toBe(429);
  });
});

describe('the sign-in budget per address and username', () => {
  const AUTHENTICATE = '/tenants/acme/login-actions/authenticate';
  const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

  // Counts every use of the database, so a refusal can be shown to have
  // happened before anything account-dependent ran.
  function countingDatabase() {
    const handle = { uses: 0 };
    const database = {
      db: new Proxy(
        {},
        {
          get: () => {
            handle.uses += 1;
            throw new Error('the throttle must refuse before the database is touched');
          },
        },
      ),
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    } as unknown as DatabaseHandle;
    return { handle, database };
  }

  function loginApp(database: DatabaseHandle, loginLimit = 3, trustProxy = false) {
    return buildApp({
      tls: false,
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
      throttle: { limit: 1000, windowSeconds: 60 },
      loginThrottle: { limit: loginLimit, windowSeconds: 60 },
      trustProxy,
    });
  }

  function submit(
    app: FastifyInstance,
    fields: Record<string, string>,
    remoteAddress = '198.51.100.7',
    url = AUTHENTICATE,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url,
      payload: new URLSearchParams(fields).toString(),
      headers: { ...FORM, ...headers },
      remoteAddress,
    });
  }

  async function spendUsername(app: FastifyInstance, username: string, times: number) {
    for (let attempt = 0; attempt < times; attempt += 1) {
      expect((await submit(app, { username, password: 'x' })).statusCode).not.toBe(429);
    }
  }

  it('refuses the submission past the budget with a page and the Retry-After it names', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'ada', 3);

    const refused = await submit(app, { username: 'ada', password: 'x' });

    expect(refused.statusCode).toBe(429);
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(refused.headers['content-type']).toContain('text/html');
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(refused.headers['x-frame-options']).toBe('DENY');
    expect(refused.headers['content-security-policy']).toContain("default-src 'none'");
    expect(refused.body).toContain('Too many attempts');
    expect(refused.body).toContain(`Try again in ${String(retryAfter)} second`);
  });

  it('refuses a throttled origin before the body is parsed', async () => {
    const app = buildApp({
      tls: false,
      database: noSuchTenantDatabase,
      ownerDatabase: noSuchTenantDatabase,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
      throttle: { limit: 1, windowSeconds: 60 },
    });
    await submit(app, { username: 'ada', password: 'x' });

    const refused = await submit(app, { username: 'ada', password: 'x'.repeat(2_000_000) });
    const fresh = await submit(
      app,
      { username: 'ada', password: 'x'.repeat(2_000_000) },
      '203.0.113.9',
    );

    expect(refused.statusCode).toBe(429);
    expect(fresh.statusCode).toBe(413);
  });

  it('keeps the machine routes on a bare 429', async () => {
    const app = buildApp({
      tls: false,
      database: noSuchTenantDatabase,
      ownerDatabase: noSuchTenantDatabase,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
      throttle: { limit: 1, windowSeconds: 60 },
    });
    const url = '/admin/tenants/acme/subjects/00000000-0000-0000-0000-000000000000/password-reset';
    await app.inject({ method: 'POST', url, remoteAddress: '198.51.100.7' });

    const refused = await app.inject({ method: 'POST', url, remoteAddress: '198.51.100.7' });

    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect(refused.headers['content-type']).toBeUndefined();
    expect(refused.body).toBe('');
  });

  it('decides on the submitted string, before the database is touched', async () => {
    const { handle, database } = countingDatabase();
    const app = loginApp(database);
    await spendUsername(app, 'ada', 3);
    const usesBefore = handle.uses;

    const refused = await submit(app, { username: 'ada', password: 'x' });

    expect(refused.statusCode).toBe(429);
    expect(handle.uses).toBe(usesBefore);
  });

  it('answers the same bytes whether or not the account exists in the key', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'ada', 3);
    await spendUsername(app, 'no-such-account', 3);

    const [known, unknown] = await Promise.all([
      submit(app, { username: 'ada', password: 'x' }),
      submit(app, { username: 'no-such-account', password: 'x' }),
    ]);

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(unknown.headers['retry-after']).toBe(known.headers['retry-after']);
    expect(unknown.headers['content-length']).toBe(known.headers['content-length']);
  });

  it('answers a composite refusal exactly as the per-address one', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'ada', 3);
    const composite = await submit(app, { username: 'ada', password: 'x' });

    const addressApp = buildApp({
      tls: false,
      database: noSuchTenantDatabase,
      ownerDatabase: noSuchTenantDatabase,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
      throttle: { limit: 1, windowSeconds: 60 },
    });
    await submit(addressApp, { username: 'ada' });
    const perAddress = await submit(addressApp, { username: 'ada' });

    expect(composite.statusCode).toBe(429);
    expect(perAddress.statusCode).toBe(429);
    expect(composite.body).toBe(perAddress.body);
    expect(composite.headers['content-length']).toBe(perAddress.headers['content-length']);
    expect(composite.headers['retry-after']).toBe(perAddress.headers['retry-after']);
  });

  it('does not punish a neighbour: another username, or another address, is untouched', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'ada', 3);

    expect((await submit(app, { username: 'ada', password: 'x' })).statusCode).toBe(429);
    expect((await submit(app, { username: 'bob', password: 'x' })).statusCode).not.toBe(429);
    expect(
      (await submit(app, { username: 'ada', password: 'x' }, '203.0.113.9')).statusCode,
    ).not.toBe(429);
  });

  it('reads one username however it is cased, padded or composed', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'Ada', 1);
    await spendUsername(app, '  ADA ', 1);
    await spendUsername(app, 'ada', 1);

    expect((await submit(app, { username: 'ａｄａ', password: 'x' })).statusCode).toBe(429);
  });

  it('counts only a submission that names a username, and only on the sign-in route', async () => {
    const app = loginApp(noSuchTenantDatabase);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await submit(app, { auth_session_id: 'x', code: '123456' })).statusCode).not.toBe(
        429,
      );
      expect(
        (
          await submit(
            app,
            { username: 'ada', email: 'a@example.test', password: 'x' },
            '198.51.100.7',
            '/tenants/acme/login-actions/registration',
          )
        ).statusCode,
      ).not.toBe(429);
    }
  });

  it('ignores a forwarded address when the proxy is not trusted', async () => {
    const app = loginApp(noSuchTenantDatabase, 3, false);
    for (const forwarded of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      const answer = await submit(
        app,
        { username: 'ada', password: 'x' },
        '198.51.100.7',
        AUTHENTICATE,
        {
          'x-forwarded-for': forwarded,
        },
      );
      expect(answer.statusCode).not.toBe(429);
    }

    const refused = await submit(
      app,
      { username: 'ada', password: 'x' },
      '198.51.100.7',
      AUTHENTICATE,
      {
        'x-forwarded-for': '203.0.113.4',
      },
    );
    expect(refused.statusCode).toBe(429);
  });

  it('keys by the forwarded address when the proxy is trusted, whatever the socket', async () => {
    const app = loginApp(noSuchTenantDatabase, 3, true);
    for (let n = 0; n < 8; n += 1) {
      const answer = await submit(
        app,
        { username: 'ada', password: 'x' },
        '10.0.0.1',
        AUTHENTICATE,
        {
          'x-forwarded-for': `203.0.113.${String(n)}`,
        },
      );
      expect(answer.statusCode).not.toBe(429);
    }
  });

  it('keeps tenants apart, so one name in two tenants is two budgets', async () => {
    const app = loginApp(noSuchTenantDatabase);
    await spendUsername(app, 'admin', 3);

    const other = await submit(
      app,
      { username: 'admin', password: 'x' },
      '198.51.100.7',
      '/tenants/globex/login-actions/authenticate',
    );

    expect(other.statusCode).not.toBe(429);
  });

  it('bounds the usernames it remembers, whatever an attacker submits', async () => {
    const app = loginApp(noSuchTenantDatabase);
    for (let n = 0; n < 50; n += 1) {
      await submit(app, { username: `${'u'.repeat(5000)}${String(n)}`, password: 'x' });
    }
    // Reached without exhausting anything: the key is cut to a fixed length,
    // so fifty near-identical long names are one budget and not fifty.
    expect((await submit(app, { username: 'u'.repeat(5000), password: 'x' })).statusCode).toBe(429);
  });
});

describe('the console', () => {
  it('refuses to build with a base URL and no client key, naming the variable', () => {
    expect(() =>
      buildApp({
        tls: false,
        database,
        ownerDatabase: database,
        kek: config.ODUDU_KEK,
        logger: createLogger(config),
        consoleBaseUrl: 'http://localhost:3000',
      }),
    ).toThrow(/ODUDU_CONSOLE_CLIENT_KEY/u);
  });
});

describe('admin routes', () => {
  it('serves the admin API and leaves the OIDC routes alone', async () => {
    const app = buildApp({
      tls: false,
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

describe('an unexpected failure', () => {
  const LEAK = 'Failed query: select "secret_hash" from "sessions" params: hunter2';

  function failingApp() {
    const database = {
      db: new Proxy(
        {},
        {
          get: () => {
            throw new Error(LEAK);
          },
        },
      ),
      sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
      close: () => Promise.resolve(),
    } as unknown as DatabaseHandle;
    return buildApp({
      tls: false,
      database,
      ownerDatabase: database,
      kek: config.ODUDU_KEK,
      logger: createLogger(config),
    });
  }

  it('answers a fixed problem document with no driver or SQL text', async () => {
    const res = await failingApp().inject({
      url: '/tenants/acme/.well-known/openid-configuration',
    });

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).not.toContain('Failed query');
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: res.headers['x-request-id'],
    });
  });

  it('still answers a client error in the shape Fastify gives it', async () => {
    const res = await failingApp().inject({
      method: 'POST',
      url: '/tenants/acme/clients-registrations/openid-connect',
      payload: '{not json',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
  });
});
