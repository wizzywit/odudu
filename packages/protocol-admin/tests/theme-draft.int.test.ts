import { THEME_DIFF_PIECES } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { assetRepository, DIFF_PIECES } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const SIGN_IN =
  '<div class="card"><h1>{{t "login.title"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>';

const PASSING = {
  surfacePage: '#ffffff',
  surfacePanel: '#ffffff',
  surfaceSunken: '#ffffff',
  inkPrimary: '#000000',
  inkMuted: '#767676',
  signalActive: '#ffffff',
  signalActiveInk: '#000000',
  signalDanger: '#ffffff',
  signalDangerInk: '#000000',
  borderStrong: '#949494',
  focusRing: '#949494',
};

interface Ctx {
  tenant: { id: string; name: string };
  token: string;
}

async function tenantCtx(): Promise<Ctx> {
  const tenant = await fixture.createTenant(`acme-${newId()}`);
  return {
    tenant,
    token: await fixture.adminToken(tenant.name, ['manage-tenant', 'manage-clients']),
  };
}

function call(
  ctx: Ctx,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; token?: string } = {},
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${ctx.tenant.name}${path}`,
    headers: {
      authorization: `Bearer ${options.token ?? ctx.token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
}

interface View {
  draft: Record<string, unknown> | null;
  published: { version: number; body: Record<string, unknown> } | null;
  changed: string[];
}

async function read(ctx: Ctx, base: string): Promise<LightMyRequestResponse> {
  return call(ctx, 'GET', `${base}/theme`);
}

async function save(ctx: Ctx, base: string, body: unknown): Promise<LightMyRequestResponse> {
  const etag = (await read(ctx, base)).headers.etag;
  return call(ctx, 'PUT', `${base}/theme`, {
    body,
    ...(typeof etag === 'string' ? { headers: { 'if-match': etag } } : {}),
  });
}

async function saved(ctx: Ctx, base: string, body: unknown): Promise<View> {
  const res = await save(ctx, base, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<View>();
}

const publish = (ctx: Ctx, base: string) => call(ctx, 'POST', `${base}/theme/publish`);

async function discard(ctx: Ctx, base: string, ifMatch?: string): Promise<LightMyRequestResponse> {
  return call(ctx, 'DELETE', `${base}/theme/draft`, {
    ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
  });
}

async function storeImage(ctx: Ctx, label: string): Promise<string> {
  const stored = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
    assetRepository(tx).put({
      tenantId: ctx.tenant.id,
      sha256: label.padEnd(64, '0'),
      mime: 'image/png',
      width: 4,
      height: 3,
      bytes: Buffer.from(label),
      tenantCapBytes: 1_000_000,
    }),
  );
  if (stored === 'over_cap') throw new Error('refused');
  return stored.id;
}

async function scopes(): Promise<{ label: string; ctx: Ctx; base: string }[]> {
  const ctx = await tenantCtx();
  const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
  return [
    { label: 'the tenant', ctx, base: '' },
    { label: 'a client', ctx, base: `/clients/${client.id}` },
  ];
}

describe('the pieces of a draft that differ', () => {
  it('lists the same pieces as the theme package', () => {
    expect([...THEME_DIFF_PIECES]).toEqual([...DIFF_PIECES]);
  });

  it.each(['the tenant', 'a client'])('for %s, names each piece alone', async (label) => {
    const found = (await scopes()).find((s) => s.label === label);
    if (found === undefined) throw new Error('no scope');
    const { ctx, base } = found;
    const logo = await storeImage(ctx, `logo-${String(label.length)}`);
    const pieces: [string, Record<string, unknown>][] = [
      ['tokens', { tokens: { light: PASSING } }],
      ['assets', { assets: { logo: { assetId: logo, alt: 'Logo' } } }],
      ['stylesheet', { stylesheet: '.page { color: red; }' }],
      ['templates', { templates: { 'sign-in': SIGN_IN } }],
    ];
    for (const [piece, body] of pieces) {
      expect((await saved(ctx, base, body)).changed, piece).toEqual([piece]);
      expect((await read(ctx, base)).json<View>().changed, piece).toEqual([piece]);
    }
  });

  it('is empty without a draft and after a publish', async () => {
    for (const { ctx, base } of await scopes()) {
      expect((await read(ctx, base)).json<View>().changed).toEqual([]);
      await saved(ctx, base, { stylesheet: '.page { color: red; }' });
      const published = await publish(ctx, base);
      expect(published.json<View>().changed).toEqual([]);
    }
  });

  it('is empty again once the draft is written back to the published body', async () => {
    for (const { ctx, base } of await scopes()) {
      const first = { tokens: { light: PASSING }, templates: { 'sign-in': SIGN_IN } };
      await saved(ctx, base, first);
      await publish(ctx, base);
      const edited = await saved(ctx, base, { ...first, templates: {} });
      expect(edited.changed).toEqual(['templates']);
      const again = await saved(ctx, base, first);
      expect(again.draft).not.toBeNull();
      expect(again.changed).toEqual([]);
    }
  });

  it('compares a client with its own published layer, not the tenant’s', async () => {
    const [tenant, client] = await scopes();
    if (tenant === undefined || client === undefined) throw new Error('no scope');
    const { ctx, base } = client;
    await saved(ctx, '', { stylesheet: '.page { color: red; }' });
    await publish(ctx, '');
    const view = await saved(ctx, base, { stylesheet: '.page { color: red; }' });
    expect(view.changed).toEqual(['stylesheet']);
  });
});

describe('POST /theme/publish of a draft that matches what is published', () => {
  it('is refused with 409 and writes no version and no audit row', async () => {
    for (const { ctx, base } of await scopes()) {
      const body = { stylesheet: '.page { color: red; }' };
      await saved(ctx, base, body);
      await publish(ctx, base);
      await saved(ctx, base, body);
      const before = fixture.invalidatedThemes.length;

      const res = await publish(ctx, base);

      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ type: 'about:blank#theme-nothing-to-publish' });
      expect(fixture.invalidatedThemes).toHaveLength(before);
      const versions = await call(ctx, 'GET', `${base}/theme/versions`);
      expect(versions.json<{ items: unknown[] }>().items).toHaveLength(1);
      expect((await read(ctx, base)).json<View>().draft).not.toBeNull();
    }
  });

  it('is refused for an empty draft with nothing published', async () => {
    for (const { ctx, base } of await scopes()) {
      await saved(ctx, base, {});
      const res = await publish(ctx, base);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'about:blank#theme-nothing-to-publish' });
    }
  });
});

describe('DELETE /theme/draft', () => {
  it('removes only the draft, leaving the published theme and its versions', async () => {
    for (const { ctx, base } of await scopes()) {
      await saved(ctx, base, { stylesheet: '.page { color: red; }' });
      await publish(ctx, base);
      await saved(ctx, base, { stylesheet: '.page { color: blue; }' });
      const etag = String((await read(ctx, base)).headers.etag);

      const res = await discard(ctx, base, etag);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers.etag).toBeUndefined();
      const view = res.json<View>();
      expect(view.draft).toBeNull();
      expect(view.changed).toEqual([]);
      expect(view.published).toMatchObject({
        version: 1,
        body: { stylesheet: '.page { color: red; }' },
      });
      const versions = await call(ctx, 'GET', `${base}/theme/versions`);
      expect(versions.json<{ items: unknown[] }>().items).toHaveLength(1);
    }
  });

  it('leaves the other scope’s draft alone', async () => {
    const [tenant, client] = await scopes();
    if (tenant === undefined || client === undefined) throw new Error('no scope');
    const { ctx } = tenant;
    await saved(ctx, '', { stylesheet: '.page { color: red; }' });
    await saved(ctx, client.base, { stylesheet: '.page { color: blue; }' });
    const etag = String((await read(ctx, client.base)).headers.etag);

    expect((await discard(ctx, client.base, etag)).statusCode).toBe(200);

    expect((await read(ctx, '')).json<View>().draft).not.toBeNull();
  });

  it('releases the images the draft held, so they can be deleted', async () => {
    const ctx = await tenantCtx();
    const logo = await storeImage(ctx, 'held');
    await saved(ctx, '', { assets: { logo: { assetId: logo, alt: 'Logo' } } });
    const etag = String((await read(ctx, '')).headers.etag);
    expect((await discard(ctx, '', etag)).statusCode).toBe(200);

    const deleted = await call(ctx, 'DELETE', `/theme/assets/${logo}`);

    expect(deleted.statusCode, deleted.body).toBe(204);
  });

  it('needs the draft’s ETag: 428 without it or with *, 412 when stale', async () => {
    for (const { ctx, base } of await scopes()) {
      await saved(ctx, base, { stylesheet: '.page { color: red; }' });
      const stale = String((await read(ctx, base)).headers.etag);
      await saved(ctx, base, { stylesheet: '.page { color: blue; }' });

      expect((await discard(ctx, base)).statusCode).toBe(428);
      expect((await discard(ctx, base, '*')).statusCode).toBe(428);
      expect((await discard(ctx, base, stale)).statusCode).toBe(412);
      expect((await read(ctx, base)).json<View>().draft).not.toBeNull();
    }
  });

  it('answers the theme as it is when there is no draft, and 412 for an ETag', async () => {
    for (const { ctx, base } of await scopes()) {
      const none = await discard(ctx, base);
      expect(none.statusCode).toBe(200);
      expect(none.json()).toMatchObject({ draft: null, changed: [] });
      expect((await discard(ctx, base, '"gone"')).statusCode).toBe(412);
    }
  });

  it('records theme.draft_discarded with the scope and no theme body', async () => {
    for (const { ctx, base } of await scopes()) {
      await saved(ctx, base, { stylesheet: '.page { color: #123456; }' });
      const etag = String((await read(ctx, base)).headers.etag);
      await discard(ctx, base, etag);
      await discard(ctx, base);

      const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
        tx.select().from(auditEvents),
      );
      const scope = base === '' ? 'tenant' : 'client';
      const discarded = rows.filter(
        (row) =>
          row.action === 'theme.draft_discarded' &&
          (row.detail as { scope?: string } | null)?.scope === scope,
      );
      expect(discarded).toHaveLength(1);
      expect(discarded[0]?.resourceId).toBe(
        base === '' ? ctx.tenant.id : base.replace('/clients/', ''),
      );
      expect(JSON.stringify(discarded[0])).not.toContain('123456');
    }
  });

  it('answers 404 for a client of another tenant, and for one that does not exist', async () => {
    const mine = await tenantCtx();
    const [, theirs] = await scopes();
    if (theirs === undefined) throw new Error('no scope');
    await saved(theirs.ctx, theirs.base, { stylesheet: '.page { color: red; }' });
    const etag = String((await read(theirs.ctx, theirs.base)).headers.etag);

    for (const base of [theirs.base, `/clients/${newId()}`]) {
      expect((await discard(mine, base, etag)).statusCode).toBe(404);
    }
    expect((await read(theirs.ctx, theirs.base)).json<View>().draft).not.toBeNull();
  });

  it('answers a foreign tenant exactly as a missing one', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    await saved(theirs, '', { stylesheet: '.page { color: red; }' });
    const etag = String((await read(theirs, '')).headers.etag);

    const foreign = await call({ ...mine, tenant: theirs.tenant }, 'DELETE', '/theme/draft', {
      headers: { 'if-match': etag },
    });
    const missing = await call(
      { ...mine, tenant: { id: newId(), name: `nonesuch-${newId()}` } },
      'DELETE',
      '/theme/draft',
      { headers: { 'if-match': etag } },
    );

    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
    expect((await read(theirs, '')).json<View>().draft).not.toBeNull();
  });

  it('is a manage-tenant route for a tenant and a manage-clients route for a client', () => {
    const routes = ADMIN_ROUTES.filter((route) => route.pattern.endsWith('/theme/draft'));
    expect(routes.map((route) => [route.method, route.pattern, route.capability])).toEqual([
      ['DELETE', '/admin/tenants/:tenant/theme/draft', 'manage-tenant'],
      ['DELETE', '/admin/tenants/:tenant/clients/:id/theme/draft', 'manage-clients'],
    ]);
  });
});
