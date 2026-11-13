import { createDatabase, withTenant } from '@odudu/db';
import { tenants } from '@odudu/db';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import { TENANT_CAPABILITIES, type ResolveTxt } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { makePng } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';
import { createVerifyThrottle } from '#/service/domain-throttle';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

interface Seen {
  readonly query: string;
  readonly connection: number;
}
const seen: Seen[] = [];
let txt: string[][] = [];
const resolver: ResolveTxt = () => Promise.resolve(txt);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({
    deploymentSmtp: true,
    publicBaseUrl: true,
    domainsBaseUrl: 'https://odudu.example.com',
    domainsTls: true,
    resolveTxt: resolver,
    verifyThrottle: createVerifyThrottle({
      hostCooldownMs: 0,
      tenantLimit: 1_000,
      tenantWindowMs: 1,
      maxEntries: 100,
    }),
    openApp: (url) =>
      createDatabase(url, {
        max: 5,
        onQueryForTests: (query, _parameters, connection) => {
          seen.push({ query, connection });
        },
      }),
  });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Ctx {
  readonly tenant: { id: string; name: string };
  readonly token: string;
}

interface Sent {
  readonly path: string;
  readonly body?: unknown;
  readonly raw?: { type: string; bytes: Buffer };
  readonly headers?: Record<string, string>;
}

function call(
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: Omit<Sent, 'path'> & { key?: string } = {},
): Promise<LightMyRequestResponse> {
  const { raw, body, headers, key } = options;
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${ctx.tenant.name}${path}`,
    headers: {
      authorization: `Bearer ${ctx.token}`,
      ...(raw !== undefined
        ? { 'content-type': raw.type }
        : body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      ...(key === undefined ? {} : { 'idempotency-key': key }),
      ...headers,
    },
    ...(raw !== undefined
      ? { payload: raw.bytes }
      : body === undefined
        ? {}
        : { payload: JSON.stringify(body) }),
  });
}

async function made(ctx: Ctx, path: string, body: unknown): Promise<{ id: string; etag: string }> {
  const res = await call(ctx, 'POST', path, { body });
  expect(res.statusCode, `${path}: ${res.body}`).toBeLessThan(300);
  return { id: res.json<{ id: string }>().id, etag: String(res.headers.etag) };
}

async function stagedKey(ctx: Ctx, alg: 'RS256' | 'ES256'): Promise<string> {
  return (await made(ctx, '/keys', { alg })).id;
}

async function mailUser(ctx: Ctx): Promise<string> {
  const id = await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId: ctx.tenant.id, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId: ctx.tenant.id,
      username: `m-${newId()}`,
      email: `m-${newId()}@example.test`,
    });
    return subject.id;
  });
  await fixture.owner.db
    .update(tenants)
    .set({ resetPasswordAllowed: true })
    .where(eq(tenants.id, ctx.tenant.id));
  return id;
}

async function theme(ctx: Ctx, base: string, label: string): Promise<void> {
  const current = await call(ctx, 'GET', `${base}/theme`);
  const etag = current.headers.etag;
  const put = await call(ctx, 'PUT', `${base}/theme`, {
    body: { stylesheet: `.page { color: ${label}; }` },
    ...(typeof etag === 'string' ? { headers: { 'if-match': etag } } : {}),
  });
  expect(put.statusCode, put.body).toBe(200);
}

async function published(ctx: Ctx, base: string, label: string): Promise<void> {
  await theme(ctx, base, label);
  const res = await call(ctx, 'POST', `${base}/theme/publish`);
  expect(res.statusCode, res.body).toBe(200);
}

async function firstVersion(ctx: Ctx, base: string): Promise<string> {
  await published(ctx, base, '#111111');
  await published(ctx, base, '#222222');
  const list = await call(ctx, 'GET', `${base}/theme/versions`);
  const items = list.json<{ items: { id: string }[] }>().items;
  const oldest = items[items.length - 1];
  if (oldest === undefined) throw new Error('no version');
  return oldest.id;
}

async function verifiedDomain(ctx: Ctx): Promise<string> {
  const host = `d${newId().slice(-8)}.acme-corp.org`;
  const row = await call(ctx, 'POST', '/domains', { body: { host } });
  expect(row.statusCode, row.body).toBe(201);
  const wire = row.json<{ id: string; dns_record?: { value: string } }>();
  txt = [[wire.dns_record?.value ?? '']];
  const verify = await call(ctx, 'POST', `/domains/${wire.id}/verify`);
  expect(verify.statusCode, verify.body).toBe(200);
  return wire.id;
}

async function domainsEtag(ctx: Ctx): Promise<string> {
  return String((await call(ctx, 'GET', '/domains')).headers.etag);
}

// What each POST is sent so that it succeeds, built from the state the
// route needs. A setup that leaves the route at 404 or 409 proves nothing
// about where its writes go, so the test fails the drive instead.
const DRIVES: Record<string, (ctx: Ctx) => Promise<Sent>> = {
  '/admin/tenants/:tenant/subjects': () =>
    Promise.resolve({ path: '/subjects', body: { username: `u-${newId()}` } }),
  '/admin/tenants/:tenant/subjects/bulk': async (ctx) => {
    const subject = await made(ctx, '/subjects', { username: `u-${newId()}` });
    return { path: '/subjects/bulk', body: { action: 'disable', ids: [subject.id] } };
  },
  '/admin/tenants/:tenant/subjects/:id/password-reset': async (ctx) => ({
    path: `/subjects/${await mailUser(ctx)}/password-reset`,
  }),
  '/admin/tenants/:tenant/subjects/:id/verification': async (ctx) => ({
    path: `/subjects/${await mailUser(ctx)}/verification`,
  }),
  '/admin/tenants/:tenant/subjects/:id/actions-email': async (ctx) => ({
    path: `/subjects/${await mailUser(ctx)}/actions-email`,
    body: { actions: ['update-password'] },
  }),
  '/admin/tenants/:tenant/theme/publish': async (ctx) => {
    await theme(ctx, '', '#333333');
    return { path: '/theme/publish' };
  },
  '/admin/tenants/:tenant/theme/versions/:versionId/restore': async (ctx) => ({
    path: `/theme/versions/${await firstVersion(ctx, '')}/restore`,
  }),
  '/admin/tenants/:tenant/theme/assets': () =>
    Promise.resolve({
      path: '/theme/assets?kind=logo',
      raw: { type: 'image/png', bytes: makePng({ width: 8, height: 4 }) },
    }),
  '/admin/tenants/:tenant/clients/:id/theme/publish': async (ctx) => {
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    await theme(ctx, `/clients/${client.id}`, '#333333');
    return { path: `/clients/${client.id}/theme/publish` };
  },
  '/admin/tenants/:tenant/clients/:id/theme/versions/:versionId/restore': async (ctx) => {
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    const version = await firstVersion(ctx, `/clients/${client.id}`);
    return { path: `/clients/${client.id}/theme/versions/${version}/restore` };
  },
  '/admin/tenants/:tenant/domains': () =>
    Promise.resolve({ path: '/domains', body: { host: `r${newId().slice(-8)}.acme-corp.org` } }),
  '/admin/tenants/:tenant/domains/:id/activate': async (ctx) => {
    const id = await verifiedDomain(ctx);
    return { path: `/domains/${id}/activate`, headers: { 'if-match': await domainsEtag(ctx) } };
  },
  '/admin/tenants/:tenant/domains/:id/deactivate': async (ctx) => {
    const id = await verifiedDomain(ctx);
    const activated = await call(ctx, 'POST', `/domains/${id}/activate`, {
      headers: { 'if-match': await domainsEtag(ctx) },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    return { path: `/domains/${id}/deactivate`, headers: { 'if-match': await domainsEtag(ctx) } };
  },
  '/admin/tenants/:tenant/roles': () =>
    Promise.resolve({ path: '/roles', body: { name: `r-${newId()}` } }),
  '/admin/tenants/:tenant/roles/:id/composites': async (ctx) => {
    const parent = await made(ctx, '/roles', { name: `p-${newId()}` });
    const child = await made(ctx, '/roles', { name: `c-${newId()}` });
    return { path: `/roles/${parent.id}/composites`, body: { child_role_id: child.id } };
  },
  '/admin/tenants/:tenant/groups': () =>
    Promise.resolve({ path: '/groups', body: { name: `g-${newId()}` } }),
  '/admin/tenants/:tenant/flows': () =>
    Promise.resolve({
      path: '/flows',
      body: {
        name: `f-${newId()}`,
        steps: [{ authenticator: 'password', requirement: 'required' }],
      },
    }),
  '/admin/tenants/:tenant/scopes': () =>
    Promise.resolve({ path: '/scopes', body: { name: `s-${newId()}` } }),
  '/admin/tenants/:tenant/scopes/restore-builtins': () =>
    Promise.resolve({ path: '/scopes/restore-builtins' }),
  '/admin/tenants/:tenant/keys': () => Promise.resolve({ path: '/keys', body: { alg: 'RS256' } }),
  '/admin/tenants/:tenant/keys/:id/promote': async (ctx) => {
    const id = await stagedKey(ctx, 'RS256');
    return { path: `/keys/${id}/promote` };
  },
  '/admin/tenants/:tenant/keys/:id/retire': async (ctx) => {
    await stagedKey(ctx, 'ES256');
    const next = await stagedKey(ctx, 'RS256');
    const promoted = await call(ctx, 'POST', `/keys/${next}/promote`);
    expect(promoted.statusCode, promoted.body).toBe(200);
    const list = await call(ctx, 'GET', '/keys');
    const old = list
      .json<{ items: { id: string; status: string; alg: string }[] }>()
      .items.find((key) => key.status !== 'active' && key.alg === 'ES256');
    if (old === undefined) throw new Error('no key to retire');
    return { path: `/keys/${old.id}/retire` };
  },
};

// Statements that change data, the audit trail included: a call's audit rows
// are part of what its record has to share a transaction with.
const WRITES = /^\s*(insert into|update|delete from)\s+/iu;

const accepting = ADMIN_ROUTES.filter(
  (route) => idempotentMethod(route.method) && route.noIdempotency === undefined,
);

describe('every POST that takes an Idempotency-Key', () => {
  it('has a drive', () => {
    expect(accepting.map((route) => route.pattern).sort()).toEqual(Object.keys(DRIVES).sort());
  });

  it.each(accepting.map((route) => route.pattern))(
    'succeeds with a key and writes only through the transaction its record shares: %s',
    async (pattern) => {
      const t = await fixture.createTenant(`join-${newId()}`);
      const ctx: Ctx = {
        tenant: t,
        token: await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]),
      };
      const drive = DRIVES[pattern];
      if (drive === undefined) throw new Error(`no drive for ${pattern}`);
      const sent = await drive(ctx);
      const from = seen.length;
      const res = await call(ctx, 'POST', sent.path, { ...sent, key: `k-${newId()}` });
      const statements = seen.slice(from);
      expect(res.statusCode, `${pattern}: ${res.body}`).toBeLessThan(300);
      const lock = statements.findIndex((entry) =>
        entry.query.includes('pg_try_advisory_xact_lock'),
      );
      expect(lock, `${pattern} never reached its key`).toBeGreaterThan(-1);
      const held = statements[lock]?.connection;
      const writes = statements.slice(lock).filter((entry) => WRITES.test(entry.query));
      expect(writes.length, `${pattern} wrote nothing after its key`).toBeGreaterThan(0);
      const outside = writes
        .filter((entry) => entry.connection !== held)
        .map((entry) => entry.query.slice(0, 80));
      expect(outside).toEqual([]);
    },
    120_000,
  );
});
