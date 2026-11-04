import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import {
  tenantDomainRepository,
  tenantIssuerRetirements,
  type ResolveTxt,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifyThrottle } from '#/service/domain-throttle';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const BASE = 'https://id.operator.test';
const MANAGE = ['manage-domains'] as const;
const READ = ['view-domains'] as const;

interface Wire {
  id: string;
  host: string;
  state: string;
  canonical: boolean;
  dns_record: { name: string; value: string } | null;
}

let fixture: AdminFixture | undefined;
let lookups: string[] = [];
let dns: ResolveTxt = () => Promise.reject(Object.assign(new Error('none'), { code: 'ENODATA' }));
const resolver: ResolveTxt = (name) => {
  lookups.push(name);
  return dns(name);
};

function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

beforeAll(async () => {
  fixture = await startAdminFixture({
    domainsBaseUrl: BASE,
    domainsTls: true,
    resolveTxt: resolver,
    // Loose enough that a test is never throttled by accident; the throttle
    // has its own tests below with a real one.
    verifyThrottle: createVerifyThrottle({
      hostCooldownMs: 0,
      tenantLimit: 1_000,
      tenantWindowMs: 1,
      maxEntries: 100,
    }),
  });
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

interface Ctx {
  tenant: { id: string; name: string };
  manage: string;
  read: string;
}

async function tenantCtx(): Promise<Ctx> {
  const tenant = await fx().createTenant(`dom-${newId()}`);
  return {
    tenant,
    manage: await fx().adminToken(tenant.name, MANAGE),
    read: await fx().adminToken(tenant.name, READ),
  };
}

let counter = 0;
const freshHost = (): string => `login${String((counter += 1))}.acme-corp.org`;

function call(
  tenant: string,
  token: string,
  method: 'DELETE' | 'GET' | 'POST',
  tail: string,
  options: { payload?: unknown; ifMatch?: string } = {},
): Promise<LightMyRequestResponse> {
  return fx().http.inject({
    method,
    url: `/admin/tenants/${tenant}/domains${tail}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
    },
    ...(options.payload === undefined ? {} : { payload: JSON.stringify(options.payload) }),
  });
}

async function register(ctx: Ctx, host = freshHost()): Promise<Wire> {
  const res = await call(ctx.tenant.name, ctx.manage, 'POST', '', { payload: { host } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Wire>();
}

async function verified(ctx: Ctx, host = freshHost()): Promise<Wire> {
  const pending = await register(ctx, host);
  dns = () => Promise.resolve([[pending.dns_record?.value ?? '']]);
  const res = await call(ctx.tenant.name, ctx.manage, 'POST', `/${pending.id}/verify`);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json<Wire>().state).toBe('verified');
  return res.json<Wire>();
}

async function activate(ctx: Ctx, id: string, ifMatch?: string): Promise<LightMyRequestResponse> {
  return call(ctx.tenant.name, ctx.manage, 'POST', `/${id}/activate`, {
    ...(ifMatch === undefined ? {} : { ifMatch }),
  });
}

async function retirements(tenantId: string): Promise<Map<string, Date>> {
  const rows = await withTenant(fx().app.db, tenantId, (tx) =>
    tx.select().from(tenantIssuerRetirements).where(eq(tenantIssuerRetirements.tenantId, tenantId)),
  );
  return new Map(rows.map((row) => [row.issuer, row.expiresAt]));
}

async function actions(tenantId: string): Promise<string[]> {
  const rows = await withTenant(fx().app.db, tenantId, (tx) => tx.select().from(auditEvents));
  return rows
    .filter((row) => row.action.startsWith('domain.'))
    .map((row) => `${row.action}:${row.outcome}`)
    .sort();
}

const etagOf = (res: LightMyRequestResponse): string => {
  const etag = res.headers.etag;
  if (typeof etag !== 'string') throw new Error(`no ETag: ${res.body}`);
  return etag;
};

describe('registering a domain', () => {
  it('answers the row pending with the TXT record to publish, an ETag and an audit row', async () => {
    const ctx = await tenantCtx();
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', '', {
      payload: { host: 'LOGIN.Acme-Corp.org' },
    });
    expect(res.statusCode).toBe(201);
    expect(etagOf(res)).toMatch(/^"[0-9a-f]{64}"$/u);
    const row = res.json<Wire>();
    expect(row).toMatchObject({
      host: 'login.acme-corp.org',
      state: 'pending',
      canonical: false,
      dns_record: { name: '_odudu-challenge.login.acme-corp.org' },
    });
    expect(row.dns_record?.value).toMatch(/^odudu-domain-verification=/u);
    expect(await actions(ctx.tenant.id)).toEqual(['domain.registered:allowed']);
  });

  it('refuses each refusal with its own stable problem type', async () => {
    const ctx = await tenantCtx();
    const cases: [string, number, string][] = [
      ['203.0.113.7', 422, 'domain-host-ip-literal'],
      ['localhost', 422, 'domain-host-localhost'],
      ['app.localhost', 422, 'domain-host-localhost'],
      ['id.operator.test', 422, 'domain-host-operator'],
      ['login.example.com', 422, 'domain-host-reserved'],
      ['not a host', 422, 'domain-host-invalid'],
    ];
    for (const [host, status, type] of cases) {
      const res = await call(ctx.tenant.name, ctx.manage, 'POST', '', { payload: { host } });
      expect(res.statusCode, host).toBe(status);
      expect(res.json<{ type: string }>().type, host).toBe(`about:blank#${type}`);
    }
    expect(await actions(ctx.tenant.id)).toEqual([]);
  });

  it('refuses a host the tenant holds already, and the system tenant', async () => {
    const ctx = await tenantCtx();
    const host = freshHost();
    await register(ctx, host);
    const again = await call(ctx.tenant.name, ctx.manage, 'POST', '', { payload: { host } });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ type: string }>().type).toBe('about:blank#domain-already-registered');

    const system = await fx().systemAdminToken(MANAGE);
    const res = await call('system', system, 'POST', '', { payload: { host: freshHost() } });
    expect(res.json<{ type: string }>().type).toBe('about:blank#domain-system-tenant');
  });

  it('refuses a tenth-plus-eleventh domain past its limit', async () => {
    const ctx = await tenantCtx();
    for (let i = 0; i < 20; i += 1) await register(ctx);
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', '', {
      payload: { host: freshHost() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#domain-limit');
  });

  it('refuses a body with another field, and an empty host', async () => {
    const ctx = await tenantCtx();
    for (const payload of [{ host: freshHost(), canonical: true }, { host: '' }, {}]) {
      const res = await call(ctx.tenant.name, ctx.manage, 'POST', '', { payload });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('verifying a domain', () => {
  it('stays pending while the record is absent and verifies once it is there', async () => {
    const ctx = await tenantCtx();
    const row = await register(ctx);
    dns = () => Promise.reject(Object.assign(new Error('none'), { code: 'ENODATA' }));
    const pending = await call(ctx.tenant.name, ctx.manage, 'POST', `/${row.id}/verify`);
    expect(pending.statusCode).toBe(200);
    expect(pending.json<Wire>()).toMatchObject({ state: 'pending' });

    dns = () => Promise.resolve([[row.dns_record?.value ?? '']]);
    const done = await call(ctx.tenant.name, ctx.manage, 'POST', `/${row.id}/verify`);
    expect(done.json<Wire>()).toMatchObject({ state: 'verified', dns_record: null });
    expect(await actions(ctx.tenant.id)).toEqual([
      'domain.registered:allowed',
      'domain.verified:allowed',
    ]);

    lookups = [];
    const again = await call(ctx.tenant.name, ctx.manage, 'POST', `/${row.id}/verify`);
    expect(again.json<Wire>().state).toBe('verified');
    expect(lookups).toEqual([]);
  });

  it('answers a host another tenant verified first with 409 and records the failure', async () => {
    const a = await tenantCtx();
    const b = await tenantCtx();
    const host = freshHost();
    const mine = await register(a, host);
    const theirs = await register(b, host);
    dns = () => Promise.resolve([[theirs.dns_record?.value ?? '']]);
    expect((await call(b.tenant.name, b.manage, 'POST', `/${theirs.id}/verify`)).statusCode).toBe(
      200,
    );
    dns = () => Promise.resolve([[mine.dns_record?.value ?? '']]);
    const res = await call(a.tenant.name, a.manage, 'POST', `/${mine.id}/verify`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#domain-verified-elsewhere');
    expect(await actions(a.tenant.id)).toEqual([
      'domain.failed:failed',
      'domain.registered:allowed',
    ]);
  });

  it('answers 404 for an unknown id', async () => {
    const ctx = await tenantCtx();
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', `/${newId()}/verify`);
    expect(res.statusCode).toBe(404);
  });
});

describe('the verify throttle', () => {
  it('never resolves one host twice inside the cooldown, and answers 429 with Retry-After', async () => {
    const throttled = await startAdminFixture({
      domainsBaseUrl: BASE,
      resolveTxt: resolver,
      verifyThrottle: createVerifyThrottle({
        hostCooldownMs: 30_000,
        tenantLimit: 3,
        tenantWindowMs: 60_000,
        maxEntries: 100,
      }),
    });
    try {
      const tenant = await throttled.createTenant(`thr-${newId()}`);
      const token = await throttled.adminToken(tenant.name, MANAGE);
      const send = (method: 'POST', tail: string, payload?: unknown) =>
        throttled.http.inject({
          method,
          url: `/admin/tenants/${tenant.name}/domains${tail}`,
          headers: {
            authorization: `Bearer ${token}`,
            ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
        });
      const make = async (): Promise<Wire> => {
        const res = await send('POST', '', { host: freshHost() });
        return res.json<Wire>();
      };
      dns = () => Promise.reject(Object.assign(new Error('none'), { code: 'ENODATA' }));
      lookups = [];

      const first = await make();
      expect((await send('POST', `/${first.id}/verify`)).statusCode).toBe(200);
      expect(lookups).toHaveLength(1);
      const again = await send('POST', `/${first.id}/verify`);
      expect(again.statusCode).toBe(429);
      expect(again.headers['retry-after']).toMatch(/^\d+$/u);
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);
      expect(again.json<{ type: string }>().type).toBe('about:blank#domain-verify-throttled');
      expect(lookups).toHaveLength(1);

      // The tenant has two lookups left in the window, and no more.
      const second = await make();
      const third = await make();
      const fourth = await make();
      expect((await send('POST', `/${second.id}/verify`)).statusCode).toBe(200);
      expect((await send('POST', `/${third.id}/verify`)).statusCode).toBe(200);
      const limited = await send('POST', `/${fourth.id}/verify`);
      expect(limited.statusCode).toBe(429);
      expect(lookups).toHaveLength(3);
    } finally {
      await throttled.stop();
    }
  }, 180_000);
});

describe('switching the canonical address', () => {
  it('activates a verified domain: canonical, the path issuer retired for an hour, an audit row', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    const before = fx().clock.now().getTime();
    const res = await activate(ctx, row.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Wire>()).toMatchObject({ canonical: true });
    const held = await retirements(ctx.tenant.id);
    const path = `${BASE}/tenants/${ctx.tenant.name}`;
    expect([...held.keys()]).toEqual([path]);
    const until = held.get(path)?.getTime() ?? 0;
    expect(until - before).toBeGreaterThanOrEqual(3_600_000);
    expect(until - before).toBeLessThan(3_600_000 + 60_000);
    expect(await actions(ctx.tenant.id)).toContain('domain.activated:allowed');
  });

  it('retires the domain’s own issuer when going back, and leaves both valid after A to B to A', async () => {
    const ctx = await tenantCtx();
    const a = await verified(ctx);
    const b = await verified(ctx);
    await activate(ctx, a.id);
    await activate(ctx, b.id);
    await activate(ctx, a.id);
    const held = await retirements(ctx.tenant.id);
    expect([...held.keys()].sort()).toEqual(
      [`${BASE}/tenants/${ctx.tenant.name}`, `https://${b.host}`].sort(),
    );
    const list = await call(ctx.tenant.name, ctx.read, 'GET', '');
    const rows = list.json<{ items: Wire[] }>().items;
    expect(rows.filter((r) => r.canonical).map((r) => r.id)).toEqual([a.id]);
  });

  it('deactivates without a DNS lookup, retiring the domain and writing an audit row', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    await activate(ctx, row.id);
    dns = () => {
      throw new Error('deactivate must not contact DNS');
    };
    lookups = [];
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', `/${row.id}/deactivate`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Wire>().canonical).toBe(false);
    expect(lookups).toEqual([]);
    expect((await retirements(ctx.tenant.id)).has(`https://${row.host}`)).toBe(true);
    expect(await actions(ctx.tenant.id)).toContain('domain.deactivated:allowed');
  });

  it('deactivates idempotently when the tenant is on the path address already', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', `/${row.id}/deactivate`);
    expect(res.statusCode).toBe(200);
    expect(await retirements(ctx.tenant.id)).toEqual(new Map());
    expect(
      (await actions(ctx.tenant.id)).filter((a) => a.startsWith('domain.deactivated')),
    ).toEqual([]);
  });

  it('does not take another domain’s place when a non-canonical one is deactivated', async () => {
    const ctx = await tenantCtx();
    const a = await verified(ctx);
    const b = await verified(ctx);
    await activate(ctx, a.id);
    const res = await call(ctx.tenant.name, ctx.manage, 'POST', `/${b.id}/deactivate`);
    expect(res.statusCode).toBe(200);
    const list = await call(ctx.tenant.name, ctx.read, 'GET', '');
    expect(list.json<{ items: Wire[] }>().items.find((r) => r.id === a.id)?.canonical).toBe(true);
  });

  it('refuses a pending or failed domain with 409', async () => {
    const ctx = await tenantCtx();
    const row = await register(ctx);
    const res = await activate(ctx, row.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#domain-not-verified');
    expect(await retirements(ctx.tenant.id)).toEqual(new Map());
  });

  it('refuses an unknown id with 404', async () => {
    const ctx = await tenantCtx();
    expect((await activate(ctx, newId())).statusCode).toBe(404);
    expect(
      (await call(ctx.tenant.name, ctx.manage, 'POST', `/${newId()}/deactivate`)).statusCode,
    ).toBe(404);
  });

  it('carries the ETag: a stale If-Match is 412 for activate and deactivate, the current one passes', async () => {
    const ctx = await tenantCtx();
    const a = await verified(ctx);
    const b = await verified(ctx);
    const listed = await call(ctx.tenant.name, ctx.read, 'GET', '');
    const initial = etagOf(listed);

    const first = await activate(ctx, a.id, initial);
    expect(first.statusCode).toBe(200);
    const after = etagOf(first);
    expect(after).not.toBe(initial);

    expect((await activate(ctx, b.id, initial)).statusCode).toBe(412);
    expect(
      (await call(ctx.tenant.name, ctx.manage, 'POST', `/${a.id}/deactivate`, { ifMatch: initial }))
        .statusCode,
    ).toBe(412);
    expect((await activate(ctx, b.id, after)).statusCode).toBe(200);
    // The list answers the validator the last switch did.
    const relisted = await call(ctx.tenant.name, ctx.read, 'GET', '');
    expect(etagOf(relisted)).toBe(etagOf(await call(ctx.tenant.name, ctx.read, 'GET', `/${a.id}`)));
  });

  it('lets exactly one of two concurrent activations of different domains be the address', async () => {
    const ctx = await tenantCtx();
    const a = await verified(ctx);
    const b = await verified(ctx);
    const results = await Promise.all([activate(ctx, a.id), activate(ctx, b.id)]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    const list = await call(ctx.tenant.name, ctx.read, 'GET', '');
    expect(list.json<{ items: Wire[] }>().items.filter((r) => r.canonical)).toHaveLength(1);
  });
});

describe('the audit row of a switch', () => {
  it('is written in the switch’s own transaction: a failure after it undoes both', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    await fx().failNextWriteAfterAudit();
    const res = await activate(ctx, row.id);
    expect(res.statusCode).toBe(500);
    expect(await actions(ctx.tenant.id)).not.toContain('domain.activated:allowed');
    expect(await retirements(ctx.tenant.id)).toEqual(new Map());
    const after = await call(ctx.tenant.name, ctx.read, 'GET', `/${row.id}`);
    expect(after.json<Wire>().canonical).toBe(false);
  });
});

describe('removing a domain', () => {
  it('removes a pending or idle domain with 204 and an audit row', async () => {
    const ctx = await tenantCtx();
    const row = await register(ctx);
    const res = await call(ctx.tenant.name, ctx.manage, 'DELETE', `/${row.id}`);
    expect(res.statusCode).toBe(204);
    expect((await call(ctx.tenant.name, ctx.read, 'GET', `/${row.id}`)).statusCode).toBe(404);
    expect(await actions(ctx.tenant.id)).toContain('domain.removed:allowed');
  });

  it('refuses to remove the tenant’s address with 409', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    await activate(ctx, row.id);
    const res = await call(ctx.tenant.name, ctx.manage, 'DELETE', `/${row.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#domain-canonical');
  });

  it('answers 404 for an unknown id', async () => {
    const ctx = await tenantCtx();
    expect((await call(ctx.tenant.name, ctx.manage, 'DELETE', `/${newId()}`)).statusCode).toBe(404);
  });
});

describe('listing domains', () => {
  it('pages by host with a cursor and a next link', async () => {
    const ctx = await tenantCtx();
    const hosts = [freshHost(), freshHost(), freshHost()];
    for (const host of hosts) await register(ctx, host);
    const first = await call(ctx.tenant.name, ctx.read, 'GET', '?limit=2');
    const page = first.json<{ items: Wire[]; next?: string }>();
    expect(page.items.map((r) => r.host)).toEqual([...hosts].sort().slice(0, 2));
    expect(first.headers.link).toContain('rel="next"');
    const second = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      `?limit=2&cursor=${encodeURIComponent(page.next ?? '')}`,
    );
    expect(second.json<{ items: Wire[]; next?: string }>()).toMatchObject({
      items: [{ host: [...hosts].sort()[2] }],
    });
    expect(second.json<{ next?: string }>().next).toBeUndefined();
    const bad = await call(ctx.tenant.name, ctx.read, 'GET', '?cursor=nope');
    expect(bad.statusCode).toBe(400);
  });
});

describe('the capabilities', () => {
  it('lets view-domains read and refuses it every change, and manage-domains both', async () => {
    const ctx = await tenantCtx();
    const row = await register(ctx);
    const read = (tail: string) => call(ctx.tenant.name, ctx.read, 'GET', tail);
    expect((await read('')).statusCode).toBe(200);
    expect((await read(`/${row.id}`)).statusCode).toBe(200);
    expect((await read('/passkey-impact?canonical=path')).statusCode).toBe(200);
    expect(
      (await call(ctx.tenant.name, ctx.read, 'POST', '', { payload: { host: freshHost() } }))
        .statusCode,
    ).toBe(403);
    for (const tail of [`/${row.id}/verify`, `/${row.id}/activate`, `/${row.id}/deactivate`]) {
      expect((await call(ctx.tenant.name, ctx.read, 'POST', tail)).statusCode, tail).toBe(403);
    }
    expect((await call(ctx.tenant.name, ctx.read, 'DELETE', `/${row.id}`)).statusCode).toBe(403);

    expect((await call(ctx.tenant.name, ctx.manage, 'GET', '')).statusCode).toBe(200);
    const other = await fx().adminToken(ctx.tenant.name, ['manage-tenant', 'manage-clients']);
    expect((await call(ctx.tenant.name, other, 'GET', '')).statusCode).toBe(403);
  });
});

describe('a foreign tenant', () => {
  it('is refused on every route, and never reads, changes or removes another tenant’s domain', async () => {
    const mine = await tenantCtx();
    const foreign = await tenantCtx();
    const row = await verified(mine);
    const token = await fx().adminToken(foreign.tenant.name, [...MANAGE, ...READ]);
    // The path names the victim's tenant while the token was issued by another.
    const routes: ['DELETE' | 'GET' | 'POST', string][] = [
      ['GET', ''],
      ['POST', ''],
      ['GET', `/${row.id}`],
      ['GET', '/passkey-impact?canonical=path'],
      ['POST', `/${row.id}/verify`],
      ['POST', `/${row.id}/activate`],
      ['POST', `/${row.id}/deactivate`],
      ['DELETE', `/${row.id}`],
    ];
    for (const [method, tail] of routes) {
      const res = await call(mine.tenant.name, token, method, tail, {
        payload: method === 'POST' && tail === '' ? { host: freshHost() } : undefined,
      });
      expect(res.statusCode, `${method} ${tail}`).toBe(401);
    }
    const stillThere = await call(mine.tenant.name, mine.read, 'GET', `/${row.id}`);
    expect(stillThere.json<Wire>()).toMatchObject({ canonical: false, state: 'verified' });
  });

  it('cannot reach a domain by its id through its own tenant', async () => {
    const mine = await tenantCtx();
    const foreign = await tenantCtx();
    const row = await verified(mine);
    for (const [method, tail] of [
      ['GET', `/${row.id}`],
      ['POST', `/${row.id}/verify`],
      ['POST', `/${row.id}/activate`],
      ['POST', `/${row.id}/deactivate`],
      ['DELETE', `/${row.id}`],
    ] as const) {
      const res = await call(foreign.tenant.name, foreign.manage, method, tail);
      expect(res.statusCode, `${method} ${tail}`).toBe(404);
    }
    const list = await call(foreign.tenant.name, foreign.read, 'GET', '');
    expect(list.json<{ items: Wire[] }>().items).toEqual([]);
    const probe = await withTenant(fx().app.db, foreign.tenant.id, (tx) =>
      tenantDomainRepository(tx).get(mine.tenant.id, row.id),
    );
    expect(probe).toBeNull();
  });
});

describe('the passkey impact', () => {
  async function passkey(ctx: Ctx, rpId: string | null): Promise<string> {
    const subject = await fx().createSubject(ctx.tenant.name, `u-${newId()}`);
    await fx().owner.sql`
      insert into user_credentials (id, tenant_id, subject_id, type, secret_data, lookup_key, rp_id)
      values (gen_random_uuid(), ${ctx.tenant.id}, ${subject.id}, 'webauthn', '{}'::jsonb,
              ${`cred-${newId()}`}, ${rpId})`;
    return subject.id;
  }

  it('counts the subjects whose passkey a switch would hide', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    await passkey(ctx, 'id.operator.test');
    await passkey(ctx, 'id.operator.test');
    await passkey(ctx, row.host);
    await passkey(ctx, null);
    const toDomain = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      `/passkey-impact?canonical=${row.host}`,
    );
    expect(toDomain.json()).toEqual({ subjects: 2, capped: false });
    const toPath = await call(ctx.tenant.name, ctx.read, 'GET', '/passkey-impact?canonical=path');
    expect(toPath.json()).toEqual({ subjects: 1, capped: false });
  });

  it('counts a subject once however many passkeys it holds', async () => {
    const ctx = await tenantCtx();
    const row = await verified(ctx);
    const subject = await passkey(ctx, 'id.operator.test');
    await fx().owner.sql`
      insert into user_credentials (id, tenant_id, subject_id, type, secret_data, lookup_key, rp_id)
      values (gen_random_uuid(), ${ctx.tenant.id}, ${subject}, 'webauthn', '{}'::jsonb,
              ${`cred-${newId()}`}, 'id.operator.test')`;
    const res = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      `/passkey-impact?canonical=${row.host}`,
    );
    expect(res.json()).toEqual({ subjects: 1, capped: false });
  });

  it('counts nothing of another tenant, refuses a host that is not the tenant’s and a malformed one', async () => {
    const ctx = await tenantCtx();
    const foreign = await tenantCtx();
    const row = await verified(ctx);
    await passkey(foreign, 'id.operator.test');
    const res = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      `/passkey-impact?canonical=${row.host}`,
    );
    expect(res.json()).toEqual({ subjects: 0, capped: false });
    const unknown = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      '/passkey-impact?canonical=nope.acme-corp.org',
    );
    expect(unknown.statusCode).toBe(404);
    const bad = await call(
      ctx.tenant.name,
      ctx.read,
      'GET',
      '/passkey-impact?canonical=not%20a%20host',
    );
    expect(bad.statusCode).toBe(400);
    const missing = await call(ctx.tenant.name, ctx.read, 'GET', '/passkey-impact');
    expect(missing.statusCode).toBe(400);
  });
});

describe('export and import', () => {
  it('leaves domains out of an export and says so, and refuses a domains key on import', async () => {
    const ctx = await tenantCtx();
    await verified(ctx);
    const token = await fx().adminToken(ctx.tenant.name, ['manage-tenant', 'manage-clients']);
    const exported = await fx().http.inject({
      method: 'GET',
      url: `/admin/tenants/${ctx.tenant.name}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exported.statusCode).toBe(200);
    const document = exported.json<Record<string, unknown>>();
    expect(document).not.toHaveProperty('domains');
    expect(exported.body).not.toContain('acme-corp.org');

    const system = await fx().systemAdminToken(['manage-tenants', 'manage-tenant']);
    const imported = await fx().http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${system}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: `imp-${newId().slice(-8)}`,
        document: { ...document, domains: [{ host: 'login.stolen.org' }] },
      }),
    });
    expect(imported.statusCode).toBe(400);
    expect(imported.body).toContain('domains');
  });
});
