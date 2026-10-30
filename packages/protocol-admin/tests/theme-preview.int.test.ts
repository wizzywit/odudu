import { createHash } from 'node:crypto';
import { withTenant } from '@odudu/db';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { PAGE_KINDS, newId, type PageKind } from '@odudu/kernel';
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

const KINDS = Object.keys(PAGE_KINDS) as PageKind[];
const SIGN_IN = (marker: string): string =>
  `<div class="${marker}"><h1>{{t "login.title"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>`;

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
  method: 'GET' | 'PUT' | 'POST',
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

const preview = (ctx: Ctx, query = '', base = '') =>
  call(ctx, 'GET', `${base}/theme/preview${query}`);

async function saveDraft(ctx: Ctx, request: Record<string, unknown>, base = ''): Promise<void> {
  const current = await call(ctx, 'GET', `${base}/theme`);
  const etag = current.headers.etag;
  const res = await call(ctx, 'PUT', `${base}/theme`, {
    body: request,
    ...(typeof etag === 'string' ? { headers: { 'if-match': etag } } : {}),
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function publish(ctx: Ctx, base = ''): Promise<void> {
  const res = await call(ctx, 'POST', `${base}/theme/publish`);
  expect(res.statusCode, res.body).toBe(200);
}

async function storeImage(ctx: Ctx, label: string, bytes = Buffer.from(label)): Promise<string> {
  const stored = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
    assetRepository(tx).put({
      tenantId: ctx.tenant.id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mime: 'image/png',
      width: 4,
      height: 3,
      bytes,
      tenantCapBytes: 8 * 1024 * 1024,
    }),
  );
  if (stored === 'over_cap') throw new Error('refused');
  return stored.id;
}

async function plantDraft(ctx: Ctx, draft: Partial<ThemeBody>): Promise<void> {
  const scope = { tenantId: ctx.tenant.id, clientId: null };
  await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
    const themes = themeRepository(tx);
    await themes.saveDraft(
      scope,
      { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...draft },
      (await themes.draft(scope))?.etag ?? null,
    );
  });
}

const header = (res: LightMyRequestResponse, name: string): string => String(res.headers[name]);

describe('the draft preview', () => {
  it('answers a page of the default look for a scope with no draft', async () => {
    const ctx = await tenantCtx();
    const res = await preview(ctx);
    expect(res.statusCode, res.body).toBe(200);
    expect(header(res, 'content-type')).toMatch(/^text\/html/u);
    expect(res.body).toContain('<main class="page">');
    expect(res.body).toContain('/tenants/' + ctx.tenant.name + '/login-actions/authenticate');
  });

  it('shows a draft that nobody has published', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('draft-only') } });
    const res = await preview(ctx, '?kind=sign-in');
    expect(res.body).toContain('<div class="draft-only">');
  });

  it('renders the draft piece by piece as the renderers do, with the stylesheet inlined', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { stylesheet: '.page { color: #123456; }' });
    const res = await preview(ctx);
    const style = /<style>([^<]*)<\/style>/u.exec(res.body)?.[1] ?? '';
    expect(style).toContain('color: #123456');
    const hash = createHash('sha256').update(style).digest('base64');
    expect(header(res, 'content-security-policy')).toContain(`'sha256-${hash}'`);
    expect(res.body).not.toContain('/brand/');
  });

  it('refuses a kind that does not exist, and a parameter the route does not take', async () => {
    const ctx = await tenantCtx();
    for (const query of ['?kind=nonsense', '?kind=sign-in&client=x', '?scheme=sepia']) {
      const res = await preview(ctx, query);
      expect(res.statusCode, query).toBe(400);
      expect(header(res, 'content-type')).toMatch(/^application\/problem\+json/u);
    }
  });

  it('renders every page kind', async () => {
    const ctx = await tenantCtx();
    for (const kind of KINDS) {
      const res = await preview(ctx, `?kind=${kind}`);
      expect(res.statusCode, `${kind}: ${res.body.slice(0, 200)}`).toBe(200);
      expect(res.body, kind).toContain('<main class="page">');
    }
  });

  it('renders a page that needs a script without it, and says so', async () => {
    const ctx = await tenantCtx();
    const res = await preview(ctx, '?kind=passkey-enrolment');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script');
    expect(header(res, 'x-odudu-preview-script')).toBe('omitted');
    expect(header(await preview(ctx, '?kind=consent'), 'x-odudu-preview-script')).toBe('undefined');
  });

  it('renders in the scheme it is asked for', async () => {
    const ctx = await tenantCtx();
    expect((await preview(ctx, '?scheme=dark')).body).toContain('data-theme="dark"');
    expect((await preview(ctx)).body).not.toContain('data-theme');
  });

  it('writes nothing: the draft, the published theme and the audit trail are as they were', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { stylesheet: '.page { color: red; }' });
    const before = await call(ctx, 'GET', '/theme');
    await preview(ctx);
    const after = await call(ctx, 'GET', '/theme');
    expect(after.headers.etag).toBe(before.headers.etag);
    expect(after.json()).toEqual(before.json());
  });
});

describe('the images of a preview', () => {
  it('inlines a draft image that no public address serves', async () => {
    const ctx = await tenantCtx();
    const bytes = Buffer.from('not-yet-published');
    const logo = await storeImage(ctx, 'logo', bytes);
    await saveDraft(ctx, { assets: { logo: { assetId: logo, alt: 'Acme' } } });
    const res = await preview(ctx);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(`src="data:image/png;base64,${bytes.toString('base64')}"`);
    expect(res.body).not.toContain('/brand/');
    expect(res.body).toContain('alt="Acme"');
  });

  it('carries an image the stylesheet names inside the stylesheet', async () => {
    const ctx = await tenantCtx();
    const bytes = Buffer.from('background-bytes');
    const background = await storeImage(ctx, 'background', bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    await saveDraft(ctx, {
      assets: { background: { assetId: background } },
      stylesheet: `.page { background-image: url(/tenants/${ctx.tenant.name}/brand/${sha}.png); }`,
    });
    const res = await preview(ctx);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(`url(data:image/png;base64,${bytes.toString('base64')})`);
    expect(res.body).not.toContain('/brand/');
  });

  it('leaves an image the draft does not name out of the page and out of its weight', async () => {
    const ctx = await tenantCtx();
    await storeImage(ctx, 'unused', Buffer.alloc(1_200_000, 'u'));
    await saveDraft(ctx, { stylesheet: '.logo { display: none; }' });
    const res = await preview(ctx);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.body).not.toContain('data:image');
  });

  it('draws a draft background behind the page, carried inside the stylesheet', async () => {
    const ctx = await tenantCtx();
    const bytes = Buffer.from('backdrop-bytes');
    const background = await storeImage(ctx, 'backdrop', bytes);
    await saveDraft(ctx, { assets: { background: { assetId: background } } });
    const res = await preview(ctx);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(
      `body{background-image:url('data:image/png;base64,${bytes.toString('base64')}');`,
    );
    expect(res.body).not.toContain('/brand/');
    const policy = String(res.headers['content-security-policy']);
    expect(policy.split('; ')).toContain('img-src data:');
    expect(policy).toMatch(/style-src 'self' 'sha256-/u);
  });

  it('previews a background of the largest size an upload can store', async () => {
    const ctx = await tenantCtx();
    const big = await storeImage(ctx, 'bigbackdrop', Buffer.alloc(1_310_720, 'u'));
    await saveDraft(ctx, { assets: { background: { assetId: big } } });
    const res = await preview(ctx);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.body).toContain("background-image:url('data:image/png;base64,");
  });

  it('refuses a background that, with the other images shown, passes the bound', async () => {
    const ctx = await tenantCtx();
    const big = (label: string) => storeImage(ctx, label, Buffer.alloc(1_310_720, label));
    const background = await big('x');
    const logo = await big('y');
    await saveDraft(ctx, {
      assets: { background: { assetId: background }, logo: { assetId: logo, alt: 'Acme' } },
    });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(422);
  });

  it('carries the favicon the page links as a data address', async () => {
    const ctx = await tenantCtx();
    const bytes = Buffer.from('favicon-bytes');
    const favicon = await storeImage(ctx, 'favicon', bytes);
    await saveDraft(ctx, { assets: { favicon: { assetId: favicon } } });
    const res = await preview(ctx);
    expect(res.body).toContain(
      `<link rel="icon" href="data:image/png;base64,${bytes.toString('base64')}">`,
    );
  });

  it('refuses a draft whose inlined files come to over the bound', async () => {
    const ctx = await tenantCtx();
    const big = (label: string) => storeImage(ctx, label, Buffer.alloc(1_100_000, label));
    const logo = await big('a');
    const dark = await big('b');
    await saveDraft(ctx, {
      assets: { logo: { assetId: logo, alt: 'Acme' }, darkLogo: { assetId: dark, alt: 'Acme' } },
    });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ type: 'about:blank#theme-preview-too-large' });
    expect(res.body.length).toBeLessThan(2000);
  });

  it('counts an image once for every place the stylesheet repeats it', async () => {
    const ctx = await tenantCtx();
    const bytes = Buffer.alloc(300_000, 'r');
    const background = await storeImage(ctx, 'repeat', bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const rule = `.page { background-image: url(/tenants/${ctx.tenant.name}/brand/${sha}.png); }\n`;
    await saveDraft(ctx, {
      assets: { background: { assetId: background } },
      stylesheet: rule.repeat(20),
    });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ type: 'about:blank#theme-preview-too-large' });
  });

  it('serves just under the bound', async () => {
    const ctx = await tenantCtx();
    const logo = await storeImage(ctx, 'c', Buffer.alloc(700_000, 'c'));
    await saveDraft(ctx, { assets: { logo: { assetId: logo, alt: 'Acme' } } });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBeLessThanOrEqual(1024 * 1024 + 20_000);
  });
});

describe('the headers of a preview', () => {
  it('lets only this origin frame it, licenses no script and nothing inline but its stylesheet', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { stylesheet: '.page { color: red; }' });
    const res = await preview(ctx);
    const policy = header(res, 'content-security-policy');
    expect(policy.split('; ')).toContain("frame-ancestors 'self'");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain('img-src data:');
    expect(policy).not.toContain('script-src');
    expect(policy).not.toContain('unsafe-inline');
    expect(header(res, 'cache-control')).toBe('no-store');
    expect(header(res, 'x-content-type-options')).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('renders no script of its own for a hostile draft that skipped the save checks', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, {
      stylesheet: '</style><script>alert(1)</script>',
      templates: {
        'sign-in':
          '<script>alert(2)</script>{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}',
      },
    });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('alert(');
    expect(res.body).not.toContain('<script');
    expect(header(res, 'content-security-policy')).not.toContain('script-src');
  });
});

describe('what a scope with no draft shows', () => {
  it('shows a tenant’s published theme when the draft is gone', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('published-own') } });
    await publish(ctx);
    const scope = { tenantId: ctx.tenant.id, clientId: null };
    await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
      expect(await themeRepository(tx).draft(scope)).toBeNull();
    });
    expect((await preview(ctx)).body).toContain('published-own');
  });

  it('shows a client’s own published theme over its tenant’s', async () => {
    const ctx = await tenantCtx();
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    const base = `/clients/${client.id}`;
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('tenant-look') } });
    await publish(ctx);
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('client-look') } }, base);
    await publish(ctx, base);
    const body = (await preview(ctx, '', base)).body;
    expect(body).toContain('client-look');
    expect(body).not.toContain('tenant-look');
  });
});

describe('a template that cannot be filled', () => {
  it('shows the default page and names the kind in a header', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, {
      templates: {
        'sign-in':
          '<p>{{t "no.such.key"}}</p>{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}',
      },
    });
    const res = await preview(ctx);
    expect(res.statusCode).toBe(200);
    expect(header(res, 'x-odudu-preview-fallback')).toBe('sign-in');
    expect(res.body).not.toContain('no.such.key');
    expect(header(await preview(ctx, '?kind=consent'), 'x-odudu-preview-fallback')).toBe(
      'undefined',
    );
  });
});

describe('a client’s preview', () => {
  async function clientCtx(): Promise<{ ctx: Ctx; base: string }> {
    const ctx = await tenantCtx();
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    return { ctx, base: `/clients/${client.id}` };
  }

  it('shows the client’s draft over its tenant’s published theme', async () => {
    const { ctx, base } = await clientCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('from-tenant') } });
    await publish(ctx);
    await saveDraft(
      ctx,
      {
        templates: {
          consent:
            '<div class="from-client">{{client}}{{form.open}}{{scopes}}{{submit.allow}}{{submit.deny}}{{form.close}}</div>',
        },
      },
      base,
    );

    const consent = await preview(ctx, '?kind=consent', base);
    expect(consent.body).toContain('from-client');
    const signIn = await preview(ctx, '?kind=sign-in', base);
    expect(signIn.body, 'what the client does not set comes from the tenant').toContain(
      'from-tenant',
    );
  });

  it('shows what is below it when it has no draft', async () => {
    const { ctx, base } = await clientCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('from-tenant') } });
    await publish(ctx);
    expect((await preview(ctx, '', base)).body).toContain('from-tenant');
  });

  it('does not show a tenant draft that is not published', async () => {
    const { ctx, base } = await clientCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('unpublished') } });
    expect((await preview(ctx, '', base)).body).not.toContain('unpublished');
  });

  it('answers 404 for a client of another tenant and for one that does not exist', async () => {
    const { ctx } = await clientCtx();
    const other = await clientCtx();
    for (const base of [other.base, `/clients/${newId()}`]) {
      expect((await preview(ctx, '', base)).statusCode).toBe(404);
    }
  });
});

describe('access', () => {
  const routes = ADMIN_ROUTES.filter((route) => route.pattern.endsWith('/theme/preview'));

  it('is two routes, each needing the capability its scope’s theme routes need', () => {
    expect(routes.map((route) => [route.pattern, route.capability])).toEqual([
      ['/admin/tenants/:tenant/theme/preview', 'manage-tenant'],
      ['/admin/tenants/:tenant/clients/:id/theme/preview', 'manage-clients'],
    ]);
  });

  it('is refused without a token, with a read-only one, and with the other scope’s capability', async () => {
    const readOnly = await tenantCtx(['view-users', 'view-audit']);
    const tenantOnly = await tenantCtx(['manage-tenant']);
    const clientsOnly = await tenantCtx(['manage-clients']);
    const client = await fixture.createConfidentialClient(tenantOnly.tenant.name, {});
    const base = `/clients/${client.id}`;

    const anonymous = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${readOnly.tenant.name}/theme/preview`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await preview(readOnly)).statusCode).toBe(403);
    expect((await preview(clientsOnly)).statusCode).toBe(403);
    expect((await preview(tenantOnly, '', base)).statusCode).toBe(403);
    expect((await preview(tenantOnly)).statusCode).toBe(200);
    const own = await fixture.createConfidentialClient(clientsOnly.tenant.name, {});
    expect((await preview(clientsOnly, '', `/clients/${own.id}`)).statusCode).toBe(200);
  });

  it('answers a foreign tenant exactly as a missing one', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    await saveDraft(theirs, { stylesheet: '.page { color: #333333; }' });
    const foreign = await preview({ ...mine, tenant: theirs.tenant });
    const missing = await preview({
      ...mine,
      tenant: { id: newId(), name: `nonesuch-${newId()}` },
    });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
  });
});

describe('what the preview says about itself', () => {
  const info = (ctx: Ctx, query = '', base = '') =>
    call(ctx, 'GET', `${base}/theme/preview/info${query}`);
  interface Info {
    kind: string;
    from: string;
    shown: string;
    faults: { layer: string; code: string }[];
    refused: { layer: string; codes: string[] }[];
    unfilled: boolean;
  }
  const read = async (ctx: Ctx, query = '', base = ''): Promise<Info> =>
    (await info(ctx, query, base)).json<Info>();
  const NO_FORM = '<p>nothing placed</p>';
  const UNFILLABLE =
    '<p>{{t "no.such.key"}}</p>{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}';

  async function clientCtx(): Promise<{ ctx: Ctx; base: string }> {
    const ctx = await tenantCtx();
    const client = await fixture.createConfidentialClient(ctx.tenant.name, {});
    return { ctx, base: `/clients/${client.id}` };
  }

  it('says there is nothing of the scope’s own and the default look is shown', async () => {
    const res = await info(await tenantCtx());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      kind: 'sign-in',
      from: 'none',
      shown: 'default',
      faults: [],
      refused: [],
      unfilled: false,
    });
  });

  it('says a draft is shown, and a published theme when there is no draft', async () => {
    const ctx = await tenantCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('mine') } });
    expect(await read(ctx)).toMatchObject({
      from: 'draft',
      shown: 'tenant',
      faults: [],
    });
    await publish(ctx);
    expect(await read(ctx)).toMatchObject({
      from: 'published',
      shown: 'tenant',
    });
  });

  it('names a template that failed the checks, and the codes', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, { templates: { 'sign-in': NO_FORM } });
    const body = await read(ctx);
    expect(body.refused).toHaveLength(1);
    expect(body.refused[0]?.layer).toBe('tenant');
    expect(body.refused[0]?.codes.length).toBeGreaterThan(0);
    expect(header(await preview(ctx), 'x-odudu-preview-fallback')).toBe('sign-in');
    expect((await read(ctx, '?kind=consent')).refused).toEqual([]);
  });

  it('says a template that passed the checks could not be filled', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, { templates: { 'sign-in': UNFILLABLE } });
    expect(await read(ctx)).toMatchObject({
      unfilled: true,
      refused: [],
    });
    expect(header(await preview(ctx), 'x-odudu-preview-fallback')).toBe('sign-in');
    expect(await read(ctx, '?kind=consent')).toMatchObject({
      unfilled: false,
    });
  });

  it('names a layer that names an image that is gone, and shows the default look', async () => {
    const ctx = await tenantCtx();
    await plantDraft(ctx, {
      assets: { logo: { assetId: newId(), alt: 'Acme' } },
      templates: { 'sign-in': SIGN_IN('gone') },
    });
    expect(await read(ctx)).toMatchObject({
      shown: 'default',
      faults: [{ layer: 'tenant', code: 'image_gone' }],
    });
    expect((await preview(ctx)).body).not.toContain('class="gone"');
  });

  it('reports a client’s draft and the tenant layer it falls back to', async () => {
    const { ctx, base } = await clientCtx();
    await saveDraft(ctx, { templates: { 'sign-in': SIGN_IN('from-tenant') } });
    await publish(ctx);
    expect(await read(ctx, '', base)).toMatchObject({
      from: 'none',
      shown: 'tenant',
      faults: [],
    });
    const scope = { tenantId: ctx.tenant.id, clientId: base.split('/').pop() ?? '' };
    await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
      await themeRepository(tx).saveDraft(
        scope,
        { tokens: {}, stylesheet: null, templates: { 'sign-in': NO_FORM }, assets: {} },
        null,
      );
    });
    const body = await read(ctx, '', base);
    expect(body.from).toBe('draft');
    expect(body.shown, 'its own layer is used, only that template is not').toBe('client');
    expect(body.refused.map((entry) => entry.layer)).toEqual(['client']);

    await withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft(
        scope,
        {
          tokens: {},
          stylesheet: null,
          templates: {},
          assets: { logo: { assetId: newId(), alt: 'Gone' } },
        },
        (await themes.draft(scope))?.etag ?? null,
      );
    });
    expect(await read(ctx, '', base)).toMatchObject({
      shown: 'tenant',
      faults: [{ layer: 'client', code: 'image_gone' }],
    });
  });

  it('answers 404 for a client of another tenant and for one that does not exist', async () => {
    const { ctx } = await clientCtx();
    const other = await clientCtx();
    for (const base of [other.base, `/clients/${newId()}`]) {
      expect((await info(ctx, '', base)).statusCode).toBe(404);
    }
  });

  it('is a query of the preview’s own: an unknown kind is refused', async () => {
    expect((await info(await tenantCtx(), '?kind=nonesuch')).statusCode).toBe(400);
  });

  it('is two routes with the capabilities of the previews, and refuses without them', async () => {
    const routes = ADMIN_ROUTES.filter((route) => route.pattern.endsWith('/theme/preview/info'));
    expect(routes.map((route) => [route.pattern, route.capability])).toEqual([
      ['/admin/tenants/:tenant/theme/preview/info', 'manage-tenant'],
      ['/admin/tenants/:tenant/clients/:id/theme/preview/info', 'manage-clients'],
    ]);
    const readOnly = await tenantCtx(['view-users']);
    const clientsOnly = await tenantCtx(['manage-clients']);
    const anonymous = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${readOnly.tenant.name}/theme/preview/info`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await info(readOnly)).statusCode).toBe(403);
    expect((await info(clientsOnly)).statusCode).toBe(403);
    const own = await fixture.createConfidentialClient(clientsOnly.tenant.name, {});
    expect((await info(clientsOnly, '', `/clients/${own.id}`)).statusCode).toBe(200);
  });

  it('answers a foreign tenant exactly as a missing one', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    await saveDraft(theirs, { stylesheet: '.page { color: #333333; }' });
    const foreign = await info({ ...mine, tenant: theirs.tenant });
    const missing = await info({ ...mine, tenant: { id: newId(), name: `nonesuch-${newId()}` } });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
  });
});
