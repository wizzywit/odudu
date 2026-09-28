import { wrapSecret } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleLoginRepository } from '#/repository/console-logins';
import { consoleSessionRepository } from '#/repository/console-sessions';
import { type OduduPort } from '#/service/odudu-port';
import { bindToTenant, randomSecret, sha256 } from '#/service/secrets';
import { registerAuthRoutes } from '#/view/routes/auth';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const SENTINEL = 'sentinel-7f3a9c-must-not-be-logged';
const ISSUER = 'http://console.example.test/tenants/probe';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

const throwingPort: OduduPort = {
  issuerOf: () => Promise.reject(new Error(`discovery failed: ${SENTINEL}`)),
  keysOf: () => Promise.resolve(null),
  exchangeCode: () => Promise.resolve(null),
  revoke: () => Promise.resolve(),
  refresh: () => Promise.resolve({ kind: 'failed' }),
  forward: () => Promise.reject(new Error('not forwarded')),
};

async function seedLogin(): Promise<string> {
  const tenantId = crypto.randomUUID();
  await owner.db.execute(
    sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${`t-${tenantId}`})`,
  );
  const state = bindToTenant(tenantId, randomSecret());
  await withTenant(app.db, tenantId, (tx) =>
    consoleLoginRepository(tx).create({
      tenantId,
      stateHash: sha256(state),
      verifierWrapped: wrapSecret('verifier', KEK),
      nonce: 'nonce',
      returnTo: '/console/',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  );
  return state;
}

async function authServer(odudu: OduduPort, logs: string[]): Promise<FastifyInstance> {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const server = Fastify({ logger: { level: 'trace', stream: destination } });
  const base = new URL('http://console.example.test');
  const login = { database: app, ownerDatabase: owner, kek: KEK, base };
  const now = (): Date => new Date();
  server.register(
    (auth) => {
      registerAuthRoutes(auth, {
        login,
        callback: { ...login, odudu, tls: false },
        logout: { database: app, kek: KEK, odudu, base, tls: false, now },
        tls: false,
        now,
        origin: base.origin,
      });
      return Promise.resolve();
    },
    { prefix: '/console/auth' },
  );
  await server.ready();
  return server;
}

async function callback(
  odudu: OduduPort,
  state: string,
  logs: string[] = [],
): Promise<LightMyRequestResponse> {
  const server = await authServer(odudu, logs);
  try {
    const query = new URLSearchParams({ code: 'c', state, iss: ISSUER });
    return await server.inject({
      url: `/console/auth/callback?${query.toString()}`,
      headers: { cookie: `odudu-console-login=${state}` },
    });
  } finally {
    await server.close();
  }
}

interface SeededSession {
  readonly cookie: string;
  readonly tenantId: string;
}

async function seedSession(): Promise<SeededSession> {
  const tenantId = crypto.randomUUID();
  const subjectId = crypto.randomUUID();
  await owner.db.execute(
    sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${`t-${tenantId}`})`,
  );
  await owner.db.execute(
    sql`INSERT INTO subjects (id, tenant_id, type) VALUES (${subjectId}, ${tenantId}, 'user')`,
  );
  const secret = randomSecret();
  const now = Date.now();
  await withTenant(app.db, tenantId, (tx) =>
    consoleSessionRepository(tx).create({
      tenantId,
      subjectId,
      secretHash: sha256(secret),
      tokens: {
        accessTokenWrapped: wrapSecret('access', KEK),
        refreshTokenWrapped: wrapSecret('refresh-to-revoke', KEK),
        accessExpiresAt: new Date(now + 300_000),
      },
      idTokenWrapped: wrapSecret('id-token-hint', KEK),
      now: new Date(now),
      expiresAt: new Date(now + 3_600_000),
    }),
  );
  return { cookie: bindToTenant(tenantId, secret), tenantId };
}

async function logout(
  odudu: OduduPort,
  cookie: string,
  logs: string[] = [],
): Promise<LightMyRequestResponse> {
  const server = await authServer(odudu, logs);
  try {
    return await server.inject({
      method: 'POST',
      url: '/console/auth/logout',
      headers: {
        origin: 'http://console.example.test',
        'x-odudu-console': '1',
        cookie: `odudu-console=${cookie}`,
      },
    });
  } finally {
    await server.close();
  }
}

async function sessionCount(tenantId: string): Promise<number> {
  const rows = await owner.db.execute(
    sql`SELECT id FROM console_sessions WHERE tenant_id = ${tenantId}`,
  );
  return rows.length;
}

describe('a sign-in that fails inside the gateway', () => {
  it('answers the refusal page as a 500 and logs nothing of the failure’s message', async () => {
    const logs: string[] = [];
    const res = await callback(throwingPort, await seedLogin(), logs);

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('sign-in could not be completed');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['set-cookie'])).toContain('odudu-console-login=; ');
    expect(logs.join('\n')).toContain('console sign-in failed');
    expect(logs.join('\n')).not.toContain(SENTINEL);
  });

  it('revokes the exchanged grant when fetching the signing keys fails', async () => {
    const revoked: string[] = [];
    const port: OduduPort = {
      issuerOf: () => Promise.resolve(ISSUER),
      exchangeCode: () =>
        Promise.resolve({
          accessToken: 'access',
          refreshToken: 'refresh-to-revoke',
          idToken: 'id',
          expiresInSeconds: 300,
        }),
      keysOf: () => Promise.reject(new Error(`certs failed: ${SENTINEL}`)),
      revoke: (_tenant, refreshToken) => {
        revoked.push(refreshToken);
        return Promise.resolve();
      },
      refresh: () => Promise.resolve({ kind: 'failed' }),
      forward: () => Promise.reject(new Error('not forwarded')),
    };

    const res = await callback(port, await seedLogin());

    expect(res.statusCode).toBe(500);
    expect(revoked).toEqual(['refresh-to-revoke']);
  });
});

describe('a logout the server answers badly', () => {
  it('ends the session and clears its cookie when the revoke fails', async () => {
    const revoked: string[] = [];
    const port: OduduPort = {
      ...throwingPort,
      issuerOf: () => Promise.resolve(ISSUER),
      revoke: (_tenant, refreshToken) => {
        revoked.push(refreshToken);
        return Promise.reject(new Error(`revoke failed: ${SENTINEL}`));
      },
    };
    const { cookie, tenantId } = await seedSession();

    const res = await logout(port, cookie);

    expect(res.statusCode).toBe(200);
    expect(revoked).toEqual(['refresh-to-revoke']);
    const redirect = new URL(res.json<{ redirect: string }>().redirect);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(
      `${ISSUER}/protocol/openid-connect/logout`,
    );
    expect(redirect.searchParams.get('id_token_hint')).toBe('id-token-hint');
    expect(String(res.headers['set-cookie'])).toContain('odudu-console=; ');
    expect(await sessionCount(tenantId)).toBe(0);
  });

  it('answers a failure as problem+json, clearing the session cookie, not the sign-in page', async () => {
    const logs: string[] = [];
    const { cookie } = await seedSession();

    const res = await logout(throwingPort, cookie, logs);

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ status: 500, type: 'about:blank' });
    expect(res.body).not.toContain('sign-in could not be completed');
    expect(String(res.headers['set-cookie'])).toMatch(/^odudu-console=; .*Max-Age=0/u);
    expect(logs.join('\n')).toContain('console logout failed');
    expect(logs.join('\n')).not.toContain(SENTINEL);
  });

  it('sends the browser to the console when the tenant’s issuer cannot be discovered', async () => {
    const port: OduduPort = { ...throwingPort, issuerOf: () => Promise.resolve(null) };
    const { cookie, tenantId } = await seedSession();

    const res = await logout(port, cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirect: '/console/' });
    expect(String(res.headers['set-cookie'])).toContain('odudu-console=; ');
    expect(await sessionCount(tenantId)).toBe(0);
  });
});
