import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const KEYS = new Set([
  'login.title',
  'login.submit',
  'login.alpha',
  'consent.title',
  'consent.beta',
  'login.aa',
  'login.bb',
  'login.cc',
  'login.dd',
  'login.ee',
]);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({
    messageKeys: (key) => KEYS.has(key),
  });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Ctx {
  tenant: { id: string; name: string };
  token: string;
}

async function tenantCtx(capabilities: string[] = ['manage-tenant']): Promise<Ctx> {
  const tenant = await fixture.createTenant(`acme-${newId()}`);
  return { tenant, token: await fixture.adminToken(tenant.name, capabilities) };
}

function call(
  ctx: Ctx,
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${ctx.tenant.name}/message-overrides${path}`,
    headers: {
      authorization: `Bearer ${options.token ?? ctx.token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
}

const put = (ctx: Ctx, locale: string, key: string, message: string) =>
  call(ctx, 'PUT', `/${locale}/${key}`, { body: { message } });

interface Page {
  items: { locale: string; key: string; message: string; updated_at: string }[];
  next?: string;
}
const list = async (ctx: Ctx, query: string): Promise<Page> =>
  (await call(ctx, 'GET', `?${query}`)).json<Page>();

describe('PUT and DELETE /message-overrides/{locale}/{key}', () => {
  it('sets an override, replaces it, and lists it back', async () => {
    const ctx = await tenantCtx();
    const first = await put(ctx, 'fr', 'login.title', 'Connexion');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ locale: 'fr', key: 'login.title', message: 'Connexion' });
    await put(ctx, 'fr', 'login.title', 'Se connecter');
    const page = await list(ctx, 'locale=fr');
    expect(page.items.map(({ key, message }) => [key, message])).toEqual([
      ['login.title', 'Se connecter'],
    ]);
  });

  it('spells the locale one way, however it was typed', async () => {
    const ctx = await tenantCtx();
    const res = await put(ctx, 'FR-ca', 'login.title', 'Allô');
    expect(res.json()).toMatchObject({ locale: 'fr-CA' });
    expect((await list(ctx, 'locale=fr-CA')).items).toHaveLength(1);
  });

  it('refuses a key that is not a page message, and stores nothing', async () => {
    const ctx = await tenantCtx();
    const res = await put(ctx, 'fr', 'login.nonesuch', 'x');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: unknown[] }>().errors).toEqual([
      { path: 'key', message: 'is not the key of any page or mail message' },
    ]);
    expect((await list(ctx, 'locale=fr')).items).toEqual([]);
    expect(fixture.invalidatedOverrides).not.toContain(ctx.tenant.id);
  });

  it.each(['en_US', 'english', 'f', 'fr-CAN-x', 'not%20a%20tag'])(
    'refuses the locale %s before anything is read',
    async (locale) => {
      const ctx = await tenantCtx();
      const res = await put(ctx, locale, 'login.title', 'x');
      expect(res.statusCode).toBe(400);
    },
  );

  it.each([
    ['an empty message', ''],
    ['a message past 2,000 characters', 'x'.repeat(2001)],
    ['an unbalanced brace', 'Hi {name'],
    ['a bidirectional control', 'abc‮def'],
  ])('refuses %s', async (_label, message) => {
    const ctx = await tenantCtx();
    const res = await put(ctx, 'fr', 'login.title', message);
    expect(res.statusCode).toBe(400);
    expect((await list(ctx, 'locale=fr')).items).toEqual([]);
  });

  it('refuses a body with another field', async () => {
    const ctx = await tenantCtx();
    const res = await call(ctx, 'PUT', '/fr/login.title', {
      body: { message: 'x', key: 'login.submit' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('keeps markup as text, listing it back exactly as written', async () => {
    const ctx = await tenantCtx();
    const markup = '<script>alert(1)</script> <b>x</b> & "y"';
    expect((await put(ctx, 'en', 'login.title', markup)).statusCode).toBe(200);
    expect((await list(ctx, 'locale=en')).items[0]?.message).toBe(markup);
  });

  it('deletes an override, then answers 404 for it', async () => {
    const ctx = await tenantCtx();
    await put(ctx, 'fr', 'login.title', 'Connexion');
    expect((await call(ctx, 'DELETE', '/fr/login.title')).statusCode).toBe(204);
    expect((await call(ctx, 'DELETE', '/fr/login.title')).statusCode).toBe(404);
    expect((await list(ctx, 'locale=fr')).items).toEqual([]);
  });

  it('tells the page cache about a write and a delete, and about nothing refused', async () => {
    const ctx = await tenantCtx();
    const before = fixture.invalidatedOverrides.filter((id) => id === ctx.tenant.id).length;
    await put(ctx, 'fr', 'login.title', 'Connexion');
    await call(ctx, 'DELETE', '/fr/login.title');
    await call(ctx, 'DELETE', '/fr/login.title');
    await put(ctx, 'fr', 'login.nonesuch', 'x');
    expect(fixture.invalidatedOverrides.filter((id) => id === ctx.tenant.id).length).toBe(
      before + 2,
    );
  });
});

describe('the bound of 500 overrides a tenant holds', () => {
  async function fill(ctx: Ctx, count: number): Promise<void> {
    await fixture.owner.sql`
      insert into message_overrides (tenant_id, locale, key, message)
      select ${ctx.tenant.id}::uuid, 'de', 'bulk.' || g, 'x' from generate_series(1, ${count}) g
    `;
  }

  it('answers 409 for the 501st and still lets an existing one change', async () => {
    const ctx = await tenantCtx();
    await fill(ctx, 499);
    expect((await put(ctx, 'fr', 'login.title', 'a')).statusCode).toBe(200);
    const refused = await put(ctx, 'fr', 'login.submit', 'b');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ type: string }>().type).toBe('about:blank#message-overrides-full');
    expect((await put(ctx, 'fr', 'login.title', 'changed')).statusCode).toBe(200);
    const rows = await fixture.owner
      .sql`select count(*)::int as n from message_overrides where tenant_id = ${ctx.tenant.id}`;
    expect(rows[0]?.n).toBe(500);
  });

  it('holds the bound against simultaneous writes', async () => {
    const ctx = await tenantCtx();
    await fill(ctx, 498);
    const keys = ['login.title', 'login.submit', 'login.alpha', 'consent.title', 'consent.beta'];
    const results = await Promise.all(keys.map((key) => put(ctx, 'fr', key, 'x')));
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(2);
    expect(results.filter((res) => res.statusCode === 409)).toHaveLength(3);
    const rows = await fixture.owner
      .sql`select count(*)::int as n from message_overrides where tenant_id = ${ctx.tenant.id}`;
    expect(rows[0]?.n).toBe(500);
  });
});

describe('GET /message-overrides', () => {
  it('needs a locale', async () => {
    const ctx = await tenantCtx();
    expect((await call(ctx, 'GET', '')).statusCode).toBe(400);
    expect((await call(ctx, 'GET', '?locale=en_US')).statusCode).toBe(400);
    expect((await call(ctx, 'GET', '?locale=fr&extra=1')).statusCode).toBe(400);
  });

  it('pages by key under MAX_LIMIT, never mixing locales', async () => {
    const ctx = await tenantCtx();
    for (const key of ['login.aa', 'login.bb', 'login.cc', 'login.dd', 'login.ee']) {
      await put(ctx, 'fr', key, key);
    }
    await put(ctx, 'de', 'login.aa', 'de');
    const first = await list(ctx, 'locale=fr&limit=2');
    expect(first.items.map((item) => item.key)).toEqual(['login.aa', 'login.bb']);
    const cursor = encodeURIComponent(first.next ?? '');
    const second = await list(ctx, `locale=fr&limit=2&cursor=${cursor}`);
    expect(second.items.map((item) => item.key)).toEqual(['login.cc', 'login.dd']);
    const third = await list(
      ctx,
      `locale=fr&limit=2&cursor=${encodeURIComponent(second.next ?? '')}`,
    );
    expect(third.items.map((item) => item.key)).toEqual(['login.ee']);
    expect(third.next).toBeUndefined();
  });

  it('treats a limit above 200 as 200 and refuses a cursor from another locale', async () => {
    const ctx = await tenantCtx();
    for (const key of ['login.aa', 'login.bb']) await put(ctx, 'fr', key, 'x');
    const first = await list(ctx, 'locale=fr&limit=1');
    const reused = await call(
      ctx,
      'GET',
      `?locale=de&limit=1&cursor=${encodeURIComponent(first.next ?? '')}`,
    );
    expect(reused.statusCode).toBe(400);
    expect((await call(ctx, 'GET', '?locale=fr&limit=100000')).statusCode).toBe(200);
  });
});

describe('who may use them, and whose they are', () => {
  const routes = ADMIN_ROUTES.filter((route) => route.pattern.includes('/message-overrides'));

  it('covers the three routes', () => {
    expect(routes.map((route) => `${route.method} ${route.pattern}`).sort()).toEqual([
      'DELETE /admin/tenants/:tenant/message-overrides/:locale/:key',
      'GET /admin/tenants/:tenant/message-overrides',
      'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
    ]);
    expect(routes.every((route) => route.capability === 'manage-tenant')).toBe(true);
  });

  it('refuses a holder of another capability on every route', async () => {
    const ctx = await tenantCtx(['manage-clients', 'view-users']);
    const token = ctx.token;
    expect((await call(ctx, 'GET', '?locale=fr', { token })).statusCode).toBe(403);
    expect((await put(ctx, 'fr', 'login.title', 'x')).statusCode).toBe(403);
    expect((await call(ctx, 'DELETE', '/fr/login.title')).statusCode).toBe(403);
  });

  it('answers no one without a token', async () => {
    const ctx = await tenantCtx();
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${ctx.tenant.name}/message-overrides?locale=fr`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('shows one tenant nothing of another’s, and lets it change nothing', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    await put(theirs, 'fr', 'login.title', 'secret wording');

    expect((await list(mine, 'locale=fr')).items).toEqual([]);
    const reaching = { ...mine, tenant: theirs.tenant };
    expect((await call(reaching, 'GET', '?locale=fr')).statusCode).toBe(401);
    expect((await put(reaching, 'fr', 'login.title', 'taken over')).statusCode).toBe(401);
    expect((await call(reaching, 'DELETE', '/fr/login.title')).statusCode).toBe(401);
    expect((await list(theirs, 'locale=fr')).items[0]?.message).toBe('secret wording');
    expect(await put(mine, 'fr', 'login.title', 'mine').then((res) => res.statusCode)).toBe(200);
    expect((await list(theirs, 'locale=fr')).items[0]?.message).toBe('secret wording');
  });
});

describe('audit of a delete', () => {
  it('names the locale in its canonical spelling, as a set does', async () => {
    const ctx = await tenantCtx();
    await put(ctx, 'fr-CA', 'login.title', 'a');
    expect((await call(ctx, 'DELETE', '/FR-ca/login.title')).statusCode).toBe(204);
    const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.select().from(auditEvents),
    );
    const deleted = rows.find((row) => row.action === 'message_override.delete');
    expect(deleted?.resourceId).toBe('fr-CA/login.title');
    expect(deleted?.detail).toMatchObject({ locale: 'fr-CA', key: 'login.title' });
  });
});

describe('audit', () => {
  it('records a set and a delete by locale and key, with no text', async () => {
    const ctx = await tenantCtx();
    await put(ctx, 'fr', 'login.title', 'a private sentence');
    await call(ctx, 'DELETE', '/fr/login.title');
    await put(ctx, 'fr', 'login.nonesuch', 'x');

    const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.select().from(auditEvents),
    );
    const mine = rows.filter((row) => row.action.startsWith('message_override.'));
    expect(mine.map((row) => row.action).sort()).toEqual([
      'message_override.delete',
      'message_override.set',
    ]);
    for (const row of mine) {
      expect(row.resourceType).toBe('message_override');
      expect(row.resourceId).toBe('fr/login.title');
      expect(JSON.stringify(row)).not.toContain('private sentence');
    }
    expect(mine.find((row) => row.action === 'message_override.set')?.detail).toMatchObject({
      locale: 'fr',
      key: 'login.title',
      message_length: 18,
    });
  });
});
