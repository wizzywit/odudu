import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
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

async function tenantCtx(
  capabilities: string[] = ['manage-tenant', 'manage-clients'],
): Promise<Ctx> {
  const tenant = await fixture.createTenant(`acme-${newId()}`);
  return { tenant, token: await fixture.adminToken(tenant.name, capabilities) };
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

const put = (ctx: Ctx, body: unknown, ifMatch?: string, base = '') =>
  call(ctx, 'PUT', `${base}/theme`, {
    body,
    ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
  });

const publish = (ctx: Ctx, base = '', headers?: Record<string, string>) =>
  call(ctx, 'POST', `${base}/theme/publish`, headers === undefined ? {} : { headers });

function body(label: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { stylesheet: `.page { color: ${label}; }`, ...extra };
}

async function saved(ctx: Ctx, request: Record<string, unknown>, base = ''): Promise<string> {
  const current = await call(ctx, 'GET', `${base}/theme`);
  const etag = current.headers.etag;
  const res = await put(ctx, request, typeof etag === 'string' ? etag : undefined, base);
  expect(res.statusCode, res.body).toBe(200);
  return String(res.headers.etag);
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

// A draft the save checks would have refused, written as a row, which is
// what publishing has to guard against.
async function plantDraft(ctx: Ctx, draft: Partial<ThemeBody>, clientId: string | null = null) {
  const scope = { tenantId: ctx.tenant.id, clientId };
  await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
    const themes = themeRepository(tx);
    const current = await themes.draft(scope);
    await themes.saveDraft(
      scope,
      { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...draft },
      current?.etag ?? null,
    );
  });
}

const errorsOf = (res: LightMyRequestResponse) =>
  res.json<{ errors: { path: string; code?: string; detail?: string }[] }>().errors;

describe('PUT /theme', () => {
  it('saves a first draft without If-Match and answers its ETag', async () => {
    const ctx = await tenantCtx();

    const res = await put(ctx, body('red'));

    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(res.json()).toMatchObject({
      scope: 'tenant',
      draft: { stylesheet: '.page { color: red; }' },
      published: null,
    });
  });

  it('refuses a first draft that names a version with 412', async () => {
    const ctx = await tenantCtx();
    expect((await put(ctx, body('red'), '"nothing"')).statusCode).toBe(412);
  });

  it('requires If-Match once a draft exists: 428 without it or with *', async () => {
    const ctx = await tenantCtx();
    await saved(ctx, body('red'));

    expect((await put(ctx, body('blue'))).statusCode).toBe(428);
    expect((await put(ctx, body('blue'), '*')).statusCode).toBe(428);
  });

  it('PUT with a stale If-Match is 412 and the draft is unchanged', async () => {
    const ctx = await tenantCtx();
    const first = await saved(ctx, body('red'));
    await saved(ctx, body('green'));

    const res = await put(ctx, body('blue'), first);

    expect(res.statusCode).toBe(412);
    const read = await call(ctx, 'GET', '/theme');
    expect(read.json<{ draft: { stylesheet: string } }>().draft.stylesheet).toBe(
      '.page { color: green; }',
    );
  });

  it('of two saves naming the same ETag exactly one wins', async () => {
    const ctx = await tenantCtx();
    const etag = await saved(ctx, body('red'));

    const results = await Promise.all([
      put(ctx, body('blue'), etag),
      put(ctx, body('green'), etag),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 412]);
  });

  it('refuses unknown keys, bad colours, bad ids and a non-object body', async () => {
    const ctx = await tenantCtx();
    const cases: unknown[] = [
      { nonsense: 1 },
      { tokens: { light: { ...PASSING, surfacePage: 'white' } } },
      { tokens: { light: { ...PASSING, extra: '#000000' } } },
      { tokens: { light: { surfacePage: '#ffffff' } } },
      { tokens: { font: 'Comic Sans' } },
      { assets: { logo: { assetId: 'not-a-uuid', alt: 'x' } } },
      { assets: { logo: { assetId: newId(), alt: '   ' } } },
      { templates: { 'no-such-kind': SIGN_IN } },
      { stylesheet: 5 },
    ];
    for (const request of cases) {
      const res = await put(ctx, request);
      expect(res.statusCode, JSON.stringify(request)).toBe(400);
    }
    expect((await call(ctx, 'GET', '/theme')).json()).toMatchObject({ draft: null });
  });

  it('refuses an image of another tenant, naming its slot', async () => {
    const ctx = await tenantCtx();
    const other = await tenantCtx();
    const foreign = await storeImage(other, 'theirs');

    const res = await put(ctx, { assets: { logo: { assetId: foreign, alt: 'Logo' } } });

    expect(res.statusCode).toBe(400);
    expect(errorsOf(res)).toMatchObject([{ path: 'assets.logo.assetId', code: 'asset-missing' }]);
  });

  it('refuses a template with an unknown message key, with its path and place', async () => {
    const ctx = await tenantCtx();

    const res = await put(ctx, {
      templates: { 'sign-in': SIGN_IN.replace('login.title', 'login.nonesuch') },
    });

    expect(res.statusCode).toBe(400);
    expect(errorsOf(res)).toMatchObject([
      { path: 'templates.sign-in', code: 'unknown-message-key', detail: 'login.nonesuch' },
    ]);
    expect(res.json<{ errors: { line: number; column: number }[] }>().errors[0]).toMatchObject({
      line: 1,
      column: 23,
    });
  });

  it('refuses a template missing a required part and a stylesheet it cannot read', async () => {
    const ctx = await tenantCtx();

    const res = await put(ctx, {
      templates: { 'sign-in': '<p>{{submit}}</p>' },
      stylesheet: '@import url(https://evil.example/x.css);',
    });

    expect(res.statusCode).toBe(400);
    const paths = errorsOf(res).map((e) => `${e.path}:${e.code ?? ''}`);
    expect(paths).toContain('templates.sign-in:missing-part');
    expect(paths.some((p) => p.startsWith('stylesheet:'))).toBe(true);
  });

  it('answers a hostile template with cleaned, bounded details and no echo of markup as prose', async () => {
    const ctx = await tenantCtx();
    const longTag = `<${'a'.repeat(30_000)}>x</${'a'.repeat(30_000)}>`;
    const hostile = `${SIGN_IN}<script>alert(1)</script><div ‮\u0007onclick="x">${longTag}`;

    const res = await put(ctx, { templates: { 'sign-in': hostile } });

    expect(res.statusCode).toBe(400);
    const details = errorsOf(res).map((e) => e.detail ?? '');
    expect(details).toContain('script');
    for (const detail of details) {
      expect(detail).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
      expect(Array.from(detail).length).toBeLessThanOrEqual(81);
    }
    expect(res.body.length).toBeLessThan(100_000);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses a template over 64 KiB by its path, and a 1 MB slot name', async () => {
    const ctx = await tenantCtx();
    const huge = `{{${'a'.repeat(1_000_000)}}}`;

    const res = await put(ctx, { templates: { 'sign-in': huge } });

    expect(res.statusCode).toBe(400);
    expect(errorsOf(res)).toMatchObject([{ path: 'templates.sign-in', code: 'too_large' }]);
  });

  it('refuses a body over the route’s limit with 413 before reading it', async () => {
    const ctx = await tenantCtx();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${ctx.tenant.name}/theme`,
      headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
      payload: `{"stylesheet":"${'x'.repeat(5 * 1024 * 1024)}"}`,
    });

    expect(res.statusCode).toBe(413);
  });

  it('refuses a body with a NUL in the stylesheet', async () => {
    const ctx = await tenantCtx();
    const res = await put(ctx, { stylesheet: '.page { color: red; }\u0000' });
    expect(res.statusCode).toBe(400);
    expect(errorsOf(res).map((e) => e.code)).toContain('nul-byte');
  });
});

describe('POST /theme/publish', () => {
  it('publish refuses a failing contrast pair with its path', async () => {
    const ctx = await tenantCtx();
    await saved(ctx, { tokens: { light: { ...PASSING, inkMuted: '#75758a' } } });

    const res = await publish(ctx);

    expect(res.statusCode).toBe(400);
    expect(
      errorsOf(res)
        .map((e) => e.path)
        .sort(),
    ).toEqual(['tokens.light.inkMuted', 'tokens.light.inkMuted', 'tokens.light.inkMuted']);
    expect(errorsOf(res)[0]).toMatchObject({ code: 'contrast' });
    expect(fixture.invalidatedThemes).not.toContain(ctx.tenant.id);
    expect((await call(ctx, 'GET', '/theme')).json()).toMatchObject({ published: null });
  });

  it('publish refuses a template missing form.open', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, {
      templates: {
        'sign-in': '<div>{{t "login.title"}}{{error}}{{fields}}{{submit}}{{form.close}}</div>',
      },
    });

    const res = await publish(ctx);

    expect(res.statusCode).toBe(400);
    expect(errorsOf(res)).toContainEqual(
      expect.objectContaining({
        path: 'templates.sign-in',
        code: 'missing-part',
        detail: 'form.open',
      }),
    );
  });

  it('publishes a good draft, answers warnings and the new version, and drops the cache', async () => {
    const ctx = await tenantCtx();
    await saved(ctx, {
      tokens: { light: PASSING },
      stylesheet: '.page { color: red; }',
      templates: { 'sign-in': SIGN_IN },
    });

    const res = await publish(ctx);

    expect(res.statusCode, res.body).toBe(200);
    const view = res.json<{
      draft: unknown;
      published: { version: number };
      warnings: { piece: string; code: string }[];
      sources: Record<string, string>;
    }>();
    expect(view.draft).toBeNull();
    expect(view.published.version).toBe(1);
    expect(view.warnings.map((w) => `${w.piece}:${w.code}`).sort()).toEqual([
      'stylesheet:stylesheet-unverified',
      'templates.sign-in:template-unverified',
    ]);
    expect(view.sources).toMatchObject({
      'tokens.light': 'tenant',
      stylesheet: 'tenant',
      'templates.sign-in': 'tenant',
      'tokens.dark': 'default',
    });
    expect(fixture.invalidatedThemes).toContain(ctx.tenant.id);
  });

  it('answers 409 when there is no draft', async () => {
    const ctx = await tenantCtx();
    const res = await publish(ctx);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'about:blank#theme-no-draft' });
  });

  it('of two simultaneous publishes of one draft exactly one wins', async () => {
    const ctx = await tenantCtx();
    await saved(ctx, body('red'));

    const results = await Promise.all([publish(ctx), publish(ctx)]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const versions = await call(ctx, 'GET', '/theme/versions');
    expect(versions.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('honours an If-Match naming the draft and refuses a stale one with 412', async () => {
    const ctx = await tenantCtx();
    const first = await saved(ctx, body('red'));
    await saved(ctx, body('green'));

    const stale = await publish(ctx, '', { 'if-match': first });
    expect(stale.statusCode).toBe(412);
    const current = String((await call(ctx, 'GET', '/theme')).headers.etag);
    expect((await publish(ctx, '', { 'if-match': current })).statusCode).toBe(200);
  });

  it('refuses to publish a draft whose image has gone missing', async () => {
    const ctx = await tenantCtx();
    const logo = await storeImage(ctx, 'logo');
    await saved(ctx, { assets: { logo: { assetId: logo, alt: 'Logo' } } });
    await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      assetRepository(tx).delete(ctx.tenant.id, logo),
    );

    const res = await publish(ctx);

    expect(res.statusCode).toBe(400);
    expect(errorsOf(res)).toMatchObject([{ path: 'assets.logo.assetId', code: 'asset-missing' }]);
  });
});

describe('versions, restore and reset', () => {
  it('lists at most 20 versions, newest first, without bodies', async () => {
    const ctx = await tenantCtx();
    for (let i = 0; i < 22; i += 1) {
      await saved(ctx, body(`#${(i + 16).toString(16)}0000`));
      expect((await publish(ctx)).statusCode).toBe(200);
    }

    const res = await call(ctx, 'GET', '/theme/versions');

    const items = res.json<{ items: { version: number; state: string }[] }>().items;
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ version: 22, state: 'published' });
    expect(items[19]?.version).toBe(3);
    expect(res.body).not.toContain('stylesheet');
  }, 60_000);

  it('restore brings back the whole snapshot', async () => {
    const ctx = await tenantCtx();
    const logo = await storeImage(ctx, 'logo');
    const original = {
      tokens: { light: PASSING, font: 'IBM Plex Mono' },
      stylesheet: '.page { color: red; }',
      templates: { 'sign-in': SIGN_IN },
      assets: { logo: { assetId: logo, alt: 'Logo' } },
    };
    await saved(ctx, original);
    await publish(ctx);
    await saved(ctx, { stylesheet: '.page { color: blue; }' });
    await publish(ctx);
    const versions = await call(ctx, 'GET', '/theme/versions');
    const first = versions
      .json<{ items: { id: string; version: number }[] }>()
      .items.find((v) => v.version === 1);

    const res = await call(ctx, 'POST', `/theme/versions/${first?.id ?? ''}/restore`);

    expect(res.statusCode, res.body).toBe(200);
    const view = res.json<{ published: { version: number; body: unknown } }>();
    expect(view.published.version).toBe(3);
    expect(view.published.body).toEqual({
      tokens: original.tokens,
      stylesheet: original.stylesheet,
      templates: original.templates,
      assets: original.assets,
    });
    expect(fixture.invalidatedThemes.filter((id) => id === ctx.tenant.id).length).toBe(3);
  });

  it('restore refuses when an image the version names no longer exists, naming it', async () => {
    const ctx = await tenantCtx();
    const logo = await storeImage(ctx, 'logo');
    await saved(ctx, { assets: { logo: { assetId: logo, alt: 'Logo' } } });
    await publish(ctx);
    await saved(ctx, body('red'));
    await publish(ctx);
    await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      assetRepository(tx).delete(ctx.tenant.id, logo),
    );
    const first = (await call(ctx, 'GET', '/theme/versions'))
      .json<{ items: { id: string; version: number }[] }>()
      .items.find((v) => v.version === 1);
    const before = fixture.invalidatedThemes.length;

    const res = await call(ctx, 'POST', `/theme/versions/${first?.id ?? ''}/restore`);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'about:blank#theme-assets-missing' });
    expect(errorsOf(res)).toMatchObject([{ path: 'assets.logo.assetId', detail: logo }]);
    expect(fixture.invalidatedThemes).toHaveLength(before);
    expect(
      (await call(ctx, 'GET', '/theme')).json<{ published: { version: number } }>().published
        .version,
    ).toBe(2);
  });

  it('restore refuses a version whose template fails today’s checks, listing it', async () => {
    const ctx = await tenantCtx();
    // Written as rows: a version published when the key was in the catalogue.
    for (const template of [SIGN_IN.replace('login.title', 'login.gone'), SIGN_IN]) {
      const scope = { tenantId: ctx.tenant.id, clientId: null };
      await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
        const themes = themeRepository(tx);
        await themes.saveDraft(
          scope,
          { tokens: {}, stylesheet: null, templates: { 'sign-in': template }, assets: {} },
          null,
        );
        await themes.publish(scope);
      });
    }
    const first = (await call(ctx, 'GET', '/theme/versions'))
      .json<{ items: { id: string; version: number }[] }>()
      .items.find((v) => v.version === 1);
    const before = fixture.invalidatedThemes.length;

    const res = await call(ctx, 'POST', `/theme/versions/${first?.id ?? ''}/restore`);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'about:blank#theme-version-fails-checks' });
    expect(errorsOf(res)).toMatchObject([
      { path: 'templates.sign-in', code: 'unknown-message-key', detail: 'login.gone' },
    ]);
    expect(fixture.invalidatedThemes).toHaveLength(before);
    expect(
      (await call(ctx, 'GET', '/theme')).json<{ published: { version: number } }>().published
        .version,
    ).toBe(2);
  });

  it('answers 404 for a version of another scope or tenant, and for a made-up one', async () => {
    const ctx = await tenantCtx();
    const other = await tenantCtx();
    await saved(other, body('red'));
    await publish(other);
    const theirs = (await call(other, 'GET', '/theme/versions')).json<{
      items: { id: string }[];
    }>().items[0];

    expect(
      (await call(ctx, 'POST', `/theme/versions/${theirs?.id ?? ''}/restore`)).statusCode,
    ).toBe(404);
    expect((await call(ctx, 'POST', `/theme/versions/${newId()}/restore`)).statusCode).toBe(404);
    expect((await call(ctx, 'POST', '/theme/versions/not-a-uuid/restore')).statusCode).toBe(400);
  });

  it('reset returns the tenant to the default, keeps history and drops the cache', async () => {
    const ctx = await tenantCtx();
    await saved(ctx, body('red'));
    await publish(ctx);
    await saved(ctx, body('blue'));

    const res = await call(ctx, 'DELETE', '/theme');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ draft: null, published: null });
    expect(res.json<{ sources: Record<string, string> }>().sources.stylesheet).toBe('default');
    expect(
      (await call(ctx, 'GET', '/theme/versions')).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect(fixture.invalidatedThemes).toContain(ctx.tenant.id);
  });
});

describe('a client’s theme', () => {
  async function clientCtx(): Promise<{ ctx: Ctx; base: string }> {
    const ctx = await tenantCtx();
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    return { ctx, base: `/clients/${client.id}` };
  }

  it('reset on a client returns it to the tenant theme', async () => {
    const { ctx, base } = await clientCtx();
    await saved(ctx, body('#444444'));
    await publish(ctx);
    await saved(ctx, { stylesheet: '.page { color: blue; }' }, base);
    const client = await publish(ctx, base);
    expect(client.json<{ sources: Record<string, string> }>().sources.stylesheet).toBe('client');

    const res = await call(ctx, 'DELETE', `${base}/theme`);

    expect(res.statusCode).toBe(200);
    const view = res.json<{
      scope: string;
      published: unknown;
      sources: Record<string, string>;
    }>();
    expect(view).toMatchObject({ scope: 'client', published: null });
    expect(view.sources.stylesheet).toBe('tenant');
    expect(view.sources['templates.sign-in']).toBe('default');
  });

  it('shows per piece which layer supplies it', async () => {
    const { ctx, base } = await clientCtx();
    await saved(ctx, { stylesheet: '.page { color: red; }', tokens: { light: PASSING } });
    await publish(ctx);
    await saved(ctx, { templates: { 'sign-in': SIGN_IN } }, base);
    await publish(ctx, base);

    const read = (await call(ctx, 'GET', `${base}/theme`)).json<{
      sources: Record<string, string>;
      tenant_sources: Record<string, string> | null;
    }>();
    const { sources } = read;
    expect(read.tenant_sources).toMatchObject({
      stylesheet: 'tenant',
      'tokens.light': 'tenant',
      'templates.sign-in': 'default',
    });

    expect(sources).toMatchObject({
      'templates.sign-in': 'client',
      stylesheet: 'tenant',
      'tokens.light': 'tenant',
      'tokens.dark': 'default',
    });
  });

  it('keeps tenant and client drafts apart and versions apart', async () => {
    const { ctx, base } = await clientCtx();
    await saved(ctx, body('#111111'));
    await saved(ctx, body('#222222'), base);
    await publish(ctx, base);

    const tenantView = (await call(ctx, 'GET', '/theme')).json<{
      draft: { stylesheet: string };
      published: unknown;
    }>();
    expect(tenantView.draft.stylesheet).toBe('.page { color: #111111; }');
    expect(tenantView.published).toBeNull();
    expect(
      (await call(ctx, 'GET', `${base}/theme/versions`)).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect(
      (await call(ctx, 'GET', '/theme/versions')).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
  });

  it('answers 404 for a client of another tenant and for one that does not exist', async () => {
    const { ctx } = await clientCtx();
    const other = await clientCtx();
    const foreign = other.base;

    for (const base of [foreign, `/clients/${newId()}`]) {
      expect((await call(ctx, 'GET', `${base}/theme`)).statusCode).toBe(404);
      expect((await put(ctx, body('x'), undefined, base)).statusCode).toBe(404);
      expect((await publish(ctx, base)).statusCode).toBe(404);
      expect((await call(ctx, 'GET', `${base}/theme/versions`)).statusCode).toBe(404);
      expect((await call(ctx, 'DELETE', `${base}/theme`)).statusCode).toBe(404);
      expect(
        (await call(ctx, 'POST', `${base}/theme/versions/${newId()}/restore`)).statusCode,
      ).toBe(404);
    }
  });

  it('drops the cache when the client is deleted', async () => {
    const { ctx, base } = await clientCtx();
    await saved(ctx, body('#222222'), base);
    await publish(ctx, base);
    const before = fixture.invalidatedThemes.length;

    const res = await call(ctx, 'DELETE', base);

    expect(res.statusCode).toBe(204);
    expect(fixture.invalidatedThemes.slice(before)).toEqual([ctx.tenant.id]);
  });
});

describe('access', () => {
  const SAMPLE_BODY = { stylesheet: '.page { color: red; }' };

  function requestFor(
    route: { method: string; pattern: string },
    ctx: Ctx,
    clientId: string,
  ): { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; body?: unknown } {
    const path = route.pattern
      .replace('/admin/tenants/:tenant', '')
      .replace(':id', clientId)
      .replace(':versionId', newId());
    return {
      method: route.method as 'GET' | 'PUT' | 'POST' | 'DELETE',
      path,
      ...(route.method === 'PUT' ? { body: SAMPLE_BODY } : {}),
    };
  }

  // The images and the stylesheet's hook list have their own files.
  const themeRoutes = ADMIN_ROUTES.filter(
    (route) =>
      /\/theme(\/|$)/u.test(route.pattern) &&
      !route.pattern.includes('/theme/assets') &&
      !route.pattern.includes('/theme/stylesheet-hooks'),
  );

  it('covers the eighteen routes of a tenant’s and a client’s theme', () => {
    expect(themeRoutes).toHaveLength(18);
  });

  it('every route needs its capability, and a read-only role is refused', async () => {
    const ctx = await tenantCtx(['view-users', 'view-audit']);
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});

    for (const route of themeRoutes) {
      const request = requestFor(route, ctx, client.id);
      const res = await call(ctx, request.method, request.path, {
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      expect(res.statusCode, `${route.method} ${route.pattern}`).toBe(403);
    }
  });

  it('a tenant route needs manage-tenant and a client route manage-clients', async () => {
    const tenantOnly = await tenantCtx(['manage-tenant']);
    const clientsOnly = await tenantCtx(['manage-clients']);
    const clientA = await fixture.createConfidentialClient(tenantOnly.tenant.name, {});
    const clientB = await fixture.createConfidentialClient(clientsOnly.tenant.name, {});

    for (const route of themeRoutes) {
      const forClient = route.pattern.includes('/clients/');
      const wrong = forClient ? tenantOnly : clientsOnly;
      const right = forClient ? clientsOnly : tenantOnly;
      const wrongRequest = requestFor(route, wrong, clientA.id);
      const rightRequest = requestFor(route, right, clientB.id);
      const refused = await call(wrong, wrongRequest.method, wrongRequest.path, {
        ...(wrongRequest.body === undefined ? {} : { body: wrongRequest.body }),
      });
      const admitted = await call(right, rightRequest.method, rightRequest.path, {
        ...(rightRequest.body === undefined ? {} : { body: rightRequest.body }),
      });
      expect(refused.statusCode, `${route.method} ${route.pattern}`).toBe(403);
      expect(admitted.statusCode, `${route.method} ${route.pattern}`).not.toBe(403);
      expect(admitted.statusCode, `${route.method} ${route.pattern}`).not.toBe(401);
    }
  });

  it('a foreign tenant answers exactly as a missing one', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    await saved(theirs, body('#333333'));

    const foreign = await call({ ...mine, tenant: theirs.tenant }, 'GET', '/theme');
    const missing = await call(
      { ...mine, tenant: { id: newId(), name: `nonesuch-${newId()}` } },
      'GET',
      '/theme',
    );

    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
    expect(foreign.body).not.toContain('secret');
  });

  it('answers no theme without a token', async () => {
    const ctx = await tenantCtx();
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${ctx.tenant.name}/theme`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('audit', () => {
  it('records each write with ids and versions and no theme body', async () => {
    const ctx = await tenantCtx();
    const secretStyle = '.page { color: #123456; }';
    await saved(ctx, { stylesheet: secretStyle });
    await publish(ctx);
    const versions = await call(ctx, 'GET', '/theme/versions');
    const id = versions.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
    await call(ctx, 'POST', `/theme/versions/${id}/restore`);
    await call(ctx, 'DELETE', '/theme');

    const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.select().from(auditEvents),
    );
    const themeRows = rows.filter((row) => row.action.startsWith('theme.'));

    expect(themeRows.map((row) => row.action).sort()).toEqual([
      'theme.draft_saved',
      'theme.published',
      'theme.reset',
      'theme.restored',
    ]);
    for (const row of themeRows) {
      expect(row.resourceType).toBe('theme');
      expect(row.resourceId).toBe(ctx.tenant.id);
      expect(JSON.stringify(row)).not.toContain('123456');
    }
    const restored = themeRows.find((row) => row.action === 'theme.restored');
    expect(restored?.detail).toMatchObject({ scope: 'tenant', version: 2, from_version: 1 });
  });

  it('writes no row for a refused save', async () => {
    const ctx = await tenantCtx();
    await put(ctx, { nonsense: 1 });
    await put(ctx, { stylesheet: '@import url(x);' });
    const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.select().from(auditEvents),
    );
    expect(rows.filter((row) => row.action.startsWith('theme.'))).toEqual([]);
  });
});

describe('GET /theme', () => {
  it('answers an empty theme with defaults for every piece and no ETag', async () => {
    const ctx = await tenantCtx();

    const res = await call(ctx, 'GET', '/theme');

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeUndefined();
    const view = res.json<{ sources: Record<string, string>; draft_sources: unknown }>();
    expect(view.draft_sources).toBeNull();
    expect(new Set(Object.values(view.sources))).toEqual(new Set(['default']));
    expect(Object.keys(view.sources)).toContain('templates.sign-in');
  });

  it('answers the draft’s ETag, which a write of the same body reproduces', async () => {
    const ctx = await tenantCtx();
    const etag = await saved(ctx, body('red'));

    const res = await call(ctx, 'GET', '/theme');

    expect(res.headers.etag).toBe(etag);
    expect((await put(ctx, body('red'), etag)).headers.etag).toBe(etag);
  });
});
