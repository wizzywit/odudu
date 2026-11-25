import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { switchCanonical, tenantDomainRepository } from '@odudu/domain-tenant';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// What stands around the "me" routes rather than inside them: the budget per
// origin, the browser origins a client allows, and the address a tenant left.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const ORIGIN = 'https://spa.example';
const LIMIT = 4;
// The limiters read this, so no test depends on the real clock or on another
// test's requests: each takes an address of its own.
let clock = Date.parse('2026-11-16T12:00:00Z');
let nextAddress = 1;
const address = (): string =>
  `10.9.${String(Math.floor(nextAddress / 250))}.${String((nextAddress++ % 250) + 1)}`;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    meOriginThrottle: { limit: LIMIT, windowSeconds: 60 },
    meRefusalThrottle: { limit: 2, windowSeconds: 60 },
    meThrottleNow: () => new Date(clock),
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly sessionId: string;
}

// A tenant with a person, a live session and a public client `spa` that allows ORIGIN.
async function world(allowOrigin = true): Promise<World> {
  const name = `me-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
    email: 'ada@example.com',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  await seed([
    'client',
    '--tenant',
    name,
    '--client-id',
    'spa',
    '--public',
    '--redirect-uri',
    `${ORIGIN}/callback`,
    ...(allowOrigin ? ['--web-origin', ORIGIN] : []),
  ]);
  const { tenantId } = seeded;
  const entry = SessionEntry.issue(newId());
  await withTenant(appDb.db, tenantId, (tx) =>
    sessionRepository(tx).create({
      id: entry.id,
      tenantId,
      subjectId: seeded.userSubjectId ?? '',
      expiresAt: new Date(Date.now() + 3_600_000),
      authenticators: ['pwd'],
      secretHash: entry.secretHash(),
    }),
  );
  return {
    name,
    tenantId,
    issuer: `${BASE}/tenants/${name}`,
    subjectId: seeded.userSubjectId,
    sessionId: entry.id,
  };
}

async function sign(w: World, claims: Record<string, unknown> = {}): Promise<string> {
  const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'spa',
      sid: w.sessionId,
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

const read = (w: World, headers: Record<string, string>, remoteAddress?: string) =>
  app.inject({
    method: 'GET',
    url: `/tenants/${w.name}/me/profile`,
    headers: { host: HOST, ...headers },
    remoteAddress: remoteAddress ?? address(),
  });

const preflight = (w: World, origin: string, method = 'PATCH', from = address()) =>
  app.inject({
    method: 'OPTIONS',
    remoteAddress: from,
    url: `/tenants/${w.name}/me/profile`,
    headers: {
      host: HOST,
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization, content-type',
    },
  });

describe('the budget per origin', () => {
  it('answers 429 with a retry time once an origin has spent it, and not another origin', async () => {
    const w = await world();
    const headers = { authorization: 'Bearer nonsense' };
    for (let i = 0; i < LIMIT; i += 1) {
      expect((await read(w, headers, '10.1.0.1')).statusCode).toBe(401);
    }
    const refused = await read(w, headers, '10.1.0.1');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await read(w, headers, '10.1.0.2')).statusCode).toBe(401);
  });

  it('counts a write and a preflight against the same budget', async () => {
    const w = await world();
    const token = await sign(w);
    const patch = () =>
      app.inject({
        method: 'PATCH',
        url: `/tenants/${w.name}/me/profile`,
        headers: { host: HOST, authorization: `Bearer ${token}` },
        payload: { name: 'Ada' },
        remoteAddress: '10.2.0.1',
      });
    expect((await patch()).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'OPTIONS',
          url: `/tenants/${w.name}/me/profile`,
          headers: { host: HOST, origin: ORIGIN, 'access-control-request-method': 'PATCH' },
          remoteAddress: '10.2.0.1',
        })
      ).statusCode,
    ).toBe(204);
    expect((await patch()).statusCode).toBe(200);
    expect((await patch()).statusCode).toBe(200);
    expect((await patch()).statusCode).toBe(429);
  });
});

describe('cross-origin calls', () => {
  it('lets the origin of the token’s own client read the answer', async () => {
    const w = await world();
    const res = await read(
      w,
      { authorization: `Bearer ${await sign(w)}`, origin: ORIGIN },
      '10.3.0.1',
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers.vary).toContain('Origin');
  });

  it('withholds the header from an origin the client does not allow, and says Vary', async () => {
    const w = await world();
    const res = await read(
      w,
      { authorization: `Bearer ${await sign(w)}`, origin: 'https://other.example' },
      '10.3.0.2',
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers.vary).toContain('Origin');
  });

  it('withholds it where the client registered no origin, and where there is no usable token', async () => {
    const w = await world(false);
    const noOrigins = await read(
      w,
      { authorization: `Bearer ${await sign(w)}`, origin: ORIGIN },
      '10.3.0.3',
    );
    expect(noOrigins.headers['access-control-allow-origin']).toBeUndefined();
    const noToken = await read(w, { origin: ORIGIN }, '10.3.0.3');
    expect(noToken.statusCode).toBe(401);
    expect(noToken.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('withholds it once the client is disabled', async () => {
    const w = await world();
    await owner.sql`update clients set enabled = false where tenant_id = ${w.tenantId} and client_id = 'spa'`;
    const res = await read(
      w,
      { authorization: `Bearer ${await sign(w)}`, origin: ORIGIN },
      '10.3.0.4',
    );
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight for an origin some client of the tenant allows', async () => {
    const w = await world();
    const res = await preflight(w, ORIGIN);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PATCH, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('authorization, content-type');
    expect(res.headers.vary).toContain('Origin');
  });

  it('answers no allowance for an origin only another tenant’s client allows', async () => {
    const a = await world();
    const b = await world(false);
    expect((await preflight(a, ORIGIN)).headers['access-control-allow-origin']).toBe(ORIGIN);
    const refused = await preflight(b, ORIGIN);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    const real = await read(
      b,
      { authorization: `Bearer ${await sign(b)}`, origin: ORIGIN },
      '10.3.0.5',
    );
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers no allowance for a tenant that is unknown or disabled', async () => {
    const w = await world();
    await owner.sql`update tenants set enabled = false where id = ${w.tenantId}`;
    expect((await preflight(w, ORIGIN)).headers['access-control-allow-origin']).toBeUndefined();
    const unknown = await app.inject({
      method: 'OPTIONS',
      remoteAddress: address(),
      url: '/tenants/no-such-tenant/me/profile',
      headers: { host: HOST, origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(unknown.statusCode).toBe(204);
    expect(unknown.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('refusals a script has to read', () => {
  const bad = { authorization: 'Bearer nonsense', origin: ORIGIN };

  it('carry the origin and the exposed headers for an origin a client of the tenant lists', async () => {
    const w = await world();
    const res = await read(w, bad);
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe('WWW-Authenticate, Retry-After');
    const other = await read(w, { ...bad, origin: 'https://other.example' });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('carry it on a 429 too, for as many as the second budget allows, and no origin of another tenant', async () => {
    const w = await world();
    const stranger = await world(false);
    const from = address();
    for (let i = 0; i < LIMIT; i += 1) expect((await read(w, bad, from)).statusCode).toBe(401);
    const first = await read(w, bad, from);
    expect(first.statusCode).toBe(429);
    expect(first.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(first.headers['access-control-expose-headers']).toBe('WWW-Authenticate, Retry-After');
    expect((await read(w, bad, from)).headers['access-control-allow-origin']).toBe(ORIGIN);
    const spent = await read(w, bad, from);
    expect(spent.statusCode).toBe(429);
    expect(spent.headers['access-control-allow-origin']).toBeUndefined();
    const foreign = address();
    for (let i = 0; i < LIMIT; i += 1) await read(stranger, bad, foreign);
    const refused = await read(stranger, bad, foreign);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('are never given an origin for a tenant that is not there', async () => {
    const from = address();
    const res = await app.inject({
      method: 'GET',
      remoteAddress: from,
      url: '/tenants/no-such-tenant/me/profile',
      headers: { host: HOST, ...bad },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('count again once the window has passed', async () => {
    const w = await world();
    const from = address();
    for (let i = 0; i < LIMIT; i += 1) await read(w, bad, from);
    expect((await read(w, bad, from)).statusCode).toBe(429);
    clock += 61_000;
    expect((await read(w, bad, from)).statusCode).toBe(401);
  });
});

describe('a tenant that left its address', () => {
  it('answers the "me" routes at the previous address for the window and not past it', async () => {
    const w = await world();
    const token = await sign(w);
    const host = 'me-window.example-domains.net';
    const domainId = await withTenant(appDb.db, w.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const row = await domains.insert({ tenantId: w.tenantId, host, challenge: 'c' });
      await domains.markVerified(w.tenantId, row.id, new Date());
      return row.id;
    });
    const switched = await withTenant(appDb.db, w.tenantId, (tx) =>
      switchCanonical(
        { domains: tenantDomainRepository(tx), base: BASE, tls: true },
        { id: w.tenantId, name: w.name },
        domainId,
        new Date(),
      ),
    );
    expect(switched.kind).toBe('switched');

    const inWindow = await read(w, { authorization: `Bearer ${token}` }, '10.4.0.1');
    expect(inWindow.statusCode).toBe(200);

    await owner.db.execute(
      sql`update tenant_issuer_retirements set expires_at = now() - interval '1 second' where tenant_id = ${w.tenantId}`,
    );
    expect((await read(w, { authorization: `Bearer ${token}` }, '10.4.0.1')).statusCode).toBe(404);
  });
});
