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
import Fastify, { type LightMyRequestResponse } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleLoginRepository } from '#/repository/console-logins';
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

async function callback(
  odudu: OduduPort,
  state: string,
  logs: string[] = [],
): Promise<LightMyRequestResponse> {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const server = Fastify({ logger: { level: 'trace', stream: destination } });
  const base = new URL('http://console.example.test');
  const login = { database: app, ownerDatabase: owner, kek: KEK, base };
  server.register(
    (auth) => {
      registerAuthRoutes(auth, {
        login,
        callback: { ...login, odudu },
        tls: false,
        now: () => new Date(),
        origin: base.origin,
      });
      return Promise.resolve();
    },
    { prefix: '/console/auth' },
  );
  await server.ready();
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
    };

    const res = await callback(port, await seedLogin());

    expect(res.statusCode).toBe(500);
    expect(revoked).toEqual(['refresh-to-revoke']);
  });
});
