import { request as httpRequest } from 'node:http';
import { type AddressInfo } from 'node:net';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import {
  ASSET_LIMITS,
  assetRepository,
  createImageInspector,
  decodeImage,
  themeRepository,
} from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { makeApng, makePng } from '@odudu/testkit';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { deleteThemeAsset } from '#/usecase/theme-assets';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
// Held shut until a test opens it, so a request is "decoding" for as long as
// the test wants.
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => undefined;
const slowInspector = createImageInspector(1, 0, {
  run: async (bytes, limits) => {
    await gate;
    return decodeImage(bytes, limits);
  },
});

beforeAll(async () => {
  fixtureHandle = await startAdminFixture({ inspectImage: slowInspector });
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

function upload(
  ctx: Ctx,
  kind: string | null,
  payload: Buffer | string,
  options: { contentType?: string; token?: string } = {},
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${ctx.tenant.name}/theme/assets${kind === null ? '' : `?kind=${kind}`}`,
    headers: {
      authorization: `Bearer ${options.token ?? ctx.token}`,
      'content-type': options.contentType ?? 'image/png',
    },
    payload,
  });
}

const remove = (ctx: Ctx, id: string, token?: string) =>
  fixture.http.inject({
    method: 'DELETE',
    url: `/admin/tenants/${ctx.tenant.name}/theme/assets/${id}`,
    headers: { authorization: `Bearer ${token ?? ctx.token}` },
  });

async function stored(ctx: Ctx, rgb: [number, number, number], kind = 'logo') {
  const res = await upload(ctx, kind, makePng({ rgb }));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string; sha256: string; mime: string; bytes: number }>();
}

function putTheme(ctx: Ctx, body: unknown, ifMatch?: string) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${ctx.tenant.name}/theme`,
    headers: {
      authorization: `Bearer ${ctx.token}`,
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    payload: body as object,
  });
}

async function draftNaming(ctx: Ctx, assetId: string | null): Promise<string> {
  const current = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${ctx.tenant.name}/theme`,
    headers: { authorization: `Bearer ${ctx.token}` },
  });
  const etag = current.headers.etag;
  const res = await putTheme(
    ctx,
    assetId === null ? {} : { assets: { logo: { assetId, alt: 'Logo' } } },
    typeof etag === 'string' ? etag : undefined,
  );
  expect(res.statusCode, res.body).toBe(200);
  return String(res.headers.etag);
}

const publish = (ctx: Ctx) =>
  fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${ctx.tenant.name}/theme/publish`,
    headers: { authorization: `Bearer ${ctx.token}` },
  });

describe('POST /theme/assets', () => {
  it('stores the re-encoded image and answers 201 with its reference', async () => {
    const ctx = await tenantCtx();

    const res = await upload(ctx, 'logo', makePng({ width: 12, height: 5 }));

    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json<{ sha256: string }>().sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(res.json()).toMatchObject({
      mime: 'image/png',
      width: 12,
      height: 5,
      kind: 'logo',
    });
    expect(res.json<{ bytes: number }>().bytes).toBeGreaterThan(0);
  });

  it('is one image for the same bytes, whichever kind they were uploaded as', async () => {
    const ctx = await tenantCtx();
    const first = await stored(ctx, [1, 2, 3], 'logo');
    const second = await stored(ctx, [1, 2, 3], 'darkLogo');
    expect(second.id).toBe(first.id);
    expect(second.sha256).toBe(first.sha256);
  });

  it('decides the type by the bytes, whatever the request declared', async () => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', makePng(), { contentType: 'application/octet-stream' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mime: 'image/png' });
  });

  it('strips what a polyglot appended', async () => {
    const ctx = await tenantCtx();
    const polyglot = Buffer.concat([makePng(), Buffer.from('<script>alert(1)</script>')]);

    const res = await upload(ctx, 'logo', polyglot);

    expect(res.statusCode, res.body).toBe(201);
    const row = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.execute<{ bytes: Buffer }>(
        `select bytes from theme_assets where id = '${res.json<{ id: string }>().id}'` as never,
      ),
    );
    expect(JSON.stringify(row)).not.toContain('script');
  });

  it.each([
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 415],
    ['a GIF', Buffer.from('GIF89a\u0001\u0000\u0001\u0000'), 415],
    [
      'an AVIF',
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif'), Buffer.alloc(12)]),
      415,
    ],
    ['an HTML page', Buffer.from('<!doctype html><title>x</title>'), 415],
  ])('refuses %s whatever it is called', async (_name, bytes, status) => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', bytes, { contentType: 'image/png' });
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-unsupported-type' });
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses an animated PNG', async () => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', makeApng());
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-animated' });
  });

  it('refuses a truncated image without echoing the decoder', async () => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', makePng({ width: 64, height: 64 }).subarray(0, 40));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-corrupt' });
    expect(res.body).not.toMatch(/vips|sharp|libpng|bad seek|premature/iu);
  });

  it('refuses an image wider than its kind allows, and takes it as a background', async () => {
    const ctx = await tenantCtx();
    const wide = makePng({ width: 1500, height: 2 });

    const asLogo = await upload(ctx, 'logo', wide);
    expect(asLogo.statusCode).toBe(422);
    expect(asLogo.json()).toMatchObject({ type: 'about:blank#asset-dimensions' });
    expect(asLogo.json<{ detail: string }>().detail).toContain('1024');

    expect((await upload(ctx, 'background', wide)).statusCode).toBe(201);
  });

  it('refuses a missing or unknown kind with 400, before the body is read', async () => {
    const ctx = await tenantCtx();
    expect((await upload(ctx, null, makePng())).statusCode).toBe(400);
    const unknown = await upload(ctx, 'banner', makePng());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('kind');
  });

  it('refuses a declared type that is no image type with 415', async () => {
    const ctx = await tenantCtx();
    for (const contentType of ['application/json', 'image/svg+xml', 'text/plain; charset=utf-8']) {
      const res = await upload(ctx, 'logo', makePng(), { contentType });
      expect(res.statusCode, contentType).toBe(415);
      expect(res.headers['content-type'], contentType).toContain('application/problem+json');
      const body = res.json<{ type: string; title: string; detail: string }>();
      expect(body.type, contentType).toBe('about:blank#asset-unsupported-type');
      expect(body.title, contentType).toBe('Unsupported Media Type');
      expect(body.detail, contentType).toContain(
        `the declared type is ${contentType.split(';').at(0) ?? ''}`,
      );
      expect(body.detail, contentType).not.toContain('the image is not');
    }
  });

  it('accepts a valid type however it is written, parameters and case included', async () => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', makePng(), { contentType: 'IMAGE/PNG; x=y' });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses a malformed declared type, naming it only as a safe token and bounded', async () => {
    const ctx = await tenantCtx();
    for (const contentType of ['image/png image/png', 'image/png,image/jpeg', 'image/', ';']) {
      const res = await upload(ctx, 'logo', makePng(), { contentType });
      expect(res.statusCode, contentType).toBe(415);
    }
    const hostile = `text/"><script>${'a'.repeat(5000)}`;
    const res = await upload(ctx, 'logo', makePng(), { contentType: hostile });
    expect(res.statusCode).toBe(415);
    const detail = res.json<{ detail: string }>().detail;
    expect(detail).not.toMatch(/[<>"]/u);
    expect(detail.length).toBeLessThan(200);
  });

  it('refuses a content-type given twice, as a proxy joins the two', async () => {
    const ctx = await tenantCtx();
    const res = await upload(ctx, 'logo', makePng(), { contentType: 'image/png, image/png' });
    expect(res.statusCode, res.body).toBe(415);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-unsupported-type' });
  });

  it('refuses a body with no declared type the same way', async () => {
    const ctx = await tenantCtx();
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${ctx.tenant.name}/theme/assets?kind=logo`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: makePng(),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-unsupported-type' });
  });

  it('refuses an empty body with 400', async () => {
    const ctx = await tenantCtx();
    expect((await upload(ctx, 'logo', '')).statusCode).toBe(400);
  });

  it('refuses a body over the kind’s limit with 413', async () => {
    const ctx = await tenantCtx();
    const over = Buffer.concat([makePng(), Buffer.alloc(ASSET_LIMITS.logo.maxBytes)]);
    const res = await upload(ctx, 'logo', over);
    expect(res.statusCode).toBe(413);
    // The same bytes are within the background's limit and are accepted.
    expect((await upload(ctx, 'background', over)).statusCode).toBe(201);
  });

  it('refuses a body over the largest limit with 413 for any kind', async () => {
    const ctx = await tenantCtx();
    const over = Buffer.concat([makePng(), Buffer.alloc(ASSET_LIMITS.background.maxBytes)]);
    expect((await upload(ctx, 'background', over)).statusCode).toBe(413);
  });

  it('refuses once the tenant’s stored images would pass 8 MiB', async () => {
    const ctx = await tenantCtx();
    await fixture.owner.sql.unsafe(`
      insert into theme_assets (id, tenant_id, sha256, mime, width, height, bytes)
      select gen_random_uuid(), '${ctx.tenant.id}', md5(g::text) || md5('c' || g), 'image/png', 1, 1,
             decode(repeat('00', 1048576), 'hex')
        from generate_series(1, 8) g`);

    const res = await upload(ctx, 'logo', makePng({ rgb: [9, 9, 9] }));

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'about:blank#asset-cap' });
  });

  it('answers 503 with Retry-After while every decode slot is taken', async () => {
    const ctx = await tenantCtx();
    gate = new Promise((resolve) => {
      openGate = resolve;
    });
    const held = upload(ctx, 'logo', makePng());
    // One slot and no queue: wait until the first has the slot.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const refused = await upload(ctx, 'logo', makePng({ rgb: [4, 4, 4] }));
    openGate();
    await held;

    expect(refused.statusCode).toBe(503);
    expect(refused.headers['retry-after']).toBe('2');
    expect(refused.json()).toMatchObject({ type: 'about:blank#asset-busy' });
  });
});

describe('who may upload and delete', () => {
  it('refuses without a token, as it does any admin route', async () => {
    const ctx = await tenantCtx();
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${ctx.tenant.name}/theme/assets?kind=logo`,
      headers: { 'content-type': 'image/png' },
      payload: makePng(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses roles with neither manage-tenant nor manage-clients with 403', async () => {
    const ctx = await tenantCtx();
    for (const capability of ['view-users', 'manage-users', 'manage-keys']) {
      const token = await fixture.adminToken(ctx.tenant.name, [capability]);
      const res = await upload(ctx, 'logo', makePng(), { token });
      expect(res.statusCode, capability).toBe(403);
      expect((await remove(ctx, newId(), token)).statusCode, capability).toBe(403);
    }
  });

  it('admits manage-clients alone, since a client’s theme names tenant images', async () => {
    const ctx = await tenantCtx();
    const token = await fixture.adminToken(ctx.tenant.name, ['manage-clients']);
    const res = await upload(ctx, 'logo', makePng({ rgb: [3, 4, 5] }), { token });
    expect(res.statusCode, res.body).toBe(201);
    const removed = await remove(ctx, res.json<{ id: string }>().id, token);
    expect(removed.statusCode).toBe(204);
  });

  it('answers a tenant that does not exist as it answers no token', async () => {
    const ctx = await tenantCtx();
    const missing = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants/no-such-tenant/theme/assets?kind=logo',
      headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'image/png' },
      payload: makePng(),
    });
    const foreign = await upload(
      { ...ctx, tenant: await fixture.createTenant(`other-${newId()}`) },
      'logo',
      makePng(),
    );
    expect(missing.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(401);
    expect(foreign.body).toEqual(
      missing.body.replace(
        /"instance":"[^"]*"/u,
        `"instance":"${foreign.json<{ instance: string }>().instance}"`,
      ),
    );
  });

  it('keeps one tenant’s images out of another’s reach', async () => {
    const a = await tenantCtx();
    const b = await tenantCtx();
    const image = await stored(a, [7, 7, 7]);

    // B cannot delete A's id, and cannot name it in a theme.
    expect((await remove(b, image.id)).statusCode).toBe(404);
    const named = await putTheme(b, { assets: { logo: { assetId: image.id, alt: 'Logo' } } });
    expect(named.statusCode).toBe(400);
    // The same picture is a separate image of B's own.
    const own = await stored(b, [7, 7, 7]);
    expect(own.id).not.toBe(image.id);
    expect((await remove(a, image.id)).statusCode).toBe(204);
  });
});

describe('DELETE /theme/assets/:assetId', () => {
  it('deletes an image no theme names with 204, and then it is gone', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [11, 11, 11]);

    expect((await remove(ctx, image.id)).statusCode).toBe(204);
    expect((await remove(ctx, image.id)).statusCode).toBe(404);
  });

  it('is 404 for an id that never existed, as for another tenant’s', async () => {
    const ctx = await tenantCtx();
    const other = await tenantCtx();
    const image = await stored(other, [12, 12, 12]);
    const foreign = await remove(ctx, image.id);
    const missing = await remove(ctx, newId());
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
  });

  it('is refused with 409 while a draft names it, listing the theme', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [13, 13, 13]);
    await draftNaming(ctx, image.id);

    const res = await remove(ctx, image.id);

    expect(res.statusCode, res.body).toBe(409);
    const body = res.json<{ type: string; errors: { path: string; message: string }[] }>();
    expect(body.type).toBe('about:blank#asset-in-use');
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.path).toBe('theme');
    expect(body.errors[0]?.message).toContain('draft');
  });

  it('is refused while a published version names it, and allowed once a newer one drops it', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [14, 14, 14]);
    await draftNaming(ctx, image.id);
    expect((await publish(ctx)).statusCode).toBe(200);

    const refused = await remove(ctx, image.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ errors: { message: string }[] }>().errors[0]?.message).toContain(
      'published version 1',
    );

    await draftNaming(ctx, null);
    expect((await publish(ctx)).statusCode).toBe(200);
    expect((await remove(ctx, image.id)).statusCode).toBe(204);
  });

  it('lists at most 20 of the versions that name it', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [15, 15, 15]);
    // Thirty clients' published themes naming the image, written directly.
    await fixture.owner.sql.unsafe(`
      insert into clients (id, tenant_id, client_id, name, type, secret_hash)
      select gen_random_uuid(), '${ctx.tenant.id}', 'c-' || g, 'C', 'public', null
        from generate_series(1, 30) g;
      insert into theme_versions (id, tenant_id, client_id, state, version, body)
      select gen_random_uuid(), '${ctx.tenant.id}', c.id, 'published', 1, '{}'::jsonb
        from clients c where c.tenant_id = '${ctx.tenant.id}' and c.client_id like 'c-%';
      insert into theme_version_assets (version_id, tenant_id, asset_id)
      select v.id, '${ctx.tenant.id}', '${image.id}' from theme_versions v where v.tenant_id = '${ctx.tenant.id}';`);

    const res = await remove(ctx, image.id);

    expect(res.statusCode).toBe(409);
    const body = res.json<{ detail: string; errors: { path: string }[] }>();
    expect(body.errors).toHaveLength(20);
    expect(body.errors[0]?.path).toMatch(/^clients\/[0-9a-f-]{36}\/theme$/u);
    expect(body.detail).toContain('more than');
  });
});

describe('a delete racing a save that names the image', () => {
  it('waits for the save to commit, then finds the reference', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [31, 31, 31]);
    const actor = { actorSubjectId: newId(), actorTenantId: ctx.tenant.id, actorClientId: newId() };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saving: () => void = () => undefined;
    const saveStarted = new Promise<void>((resolve) => {
      saving = resolve;
    });

    // The save holds the image and writes the draft that names it, and keeps
    // its transaction open.
    const save = withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
      const found = await assetRepository(tx).hold(ctx.tenant.id, [image.id]);
      expect(found).toHaveLength(1);
      await themeRepository(tx).saveDraft(
        { tenantId: ctx.tenant.id, clientId: null },
        {
          tokens: {},
          stylesheet: null,
          templates: {},
          assets: { logo: { assetId: image.id, alt: 'Logo' } },
        },
        null,
      );
      saving();
      await held;
    });
    await saveStarted;

    let settled = false;
    const deleting = withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      deleteThemeAsset(tx, { audit: () => Promise.resolve() }, actor, {
        tenantId: ctx.tenant.id,
        assetId: image.id,
      }),
    ).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled, 'the delete is blocked by the save').toBe(false);

    release();
    await save;
    expect(await deleting).toMatchObject({ kind: 'in_use' });
    expect((await remove(ctx, image.id)).statusCode).toBe(409);
  });
});

describe('a delete racing an upload of bytes already stored', () => {
  it('waits for the upload’s transaction, so the id it returned still exists inside it', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [41, 41, 41]);
    const actor = { actorSubjectId: newId(), actorTenantId: ctx.tenant.id, actorClientId: newId() };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      reading = resolve;
    });

    const again = withTenant(fixture.app.db, ctx.tenant.id, async (tx) => {
      const found = await assetRepository(tx).put({
        tenantId: ctx.tenant.id,
        sha256: image.sha256,
        mime: image.mime,
        width: 1,
        height: 1,
        bytes: Buffer.from('x'),
        tenantCapBytes: 1_000_000,
      });
      reading();
      await held;
      return found;
    });
    await readStarted;

    let settled = false;
    const deleting = withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      deleteThemeAsset(tx, { audit: () => Promise.resolve() }, actor, {
        tenantId: ctx.tenant.id,
        assetId: image.id,
      }),
    ).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled, 'the delete waits for the upload').toBe(false);

    release();
    expect(await again).toMatchObject({ id: image.id });
    expect(await deleting).toEqual({ kind: 'deleted' });
  });
});

describe('audit', () => {
  it('records an upload and a delete with ids, hash, kind and size, and never the bytes', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [21, 21, 21], 'favicon');
    await remove(ctx, image.id);
    await upload(ctx, 'logo', Buffer.from('GIF89a'));

    const rows = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      tx.select().from(auditEvents),
    );
    const themeRows = rows.filter((row) => row.action.startsWith('theme.asset'));

    expect(themeRows.map((row) => row.action).sort()).toEqual([
      'theme.asset_deleted',
      'theme.asset_uploaded',
    ]);
    const uploaded = themeRows.find((row) => row.action === 'theme.asset_uploaded');
    expect(uploaded?.resourceId).toBe(image.id);
    expect(uploaded?.detail).toEqual({ sha256: image.sha256, kind: 'favicon', bytes: image.bytes });
  });
});

describe('before the body is read', () => {
  let port = 0;
  beforeAll(async () => {
    await fixture.http.listen({ port: 0, host: '127.0.0.1' });
    port = (fixture.http.server.address() as AddressInfo).port;
  });

  // Declares a body and never sends it: an answer at all proves the route
  // answered without waiting for one.
  function declaredButUnsent(
    ctx: Ctx,
    query: string,
    length: number,
    token: string | null,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/admin/tenants/${ctx.tenant.name}/theme/assets${query}`,
          headers: {
            'content-type': 'image/png',
            'content-length': String(length),
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('no answer before the body was sent'));
      }, 4000);
      req.on('close', () => {
        clearTimeout(timer);
      });
      req.flushHeaders();
    });
  }

  it('answers an unauthenticated 1 MiB upload 401 without the body', async () => {
    const ctx = await tenantCtx();
    expect(await declaredButUnsent(ctx, '?kind=background', 1024 * 1024, null)).toBe(401);
  });

  it('answers a read-only caller 403 without the body', async () => {
    const ctx = await tenantCtx();
    const token = await fixture.adminTokenAt(
      ctx.tenant.name,
      ['view-users'],
      `127.0.0.1:${String(port)}`,
    );
    expect(await declaredButUnsent(ctx, '?kind=logo', 1024 * 1024, token)).toBe(403);
  });

  // Sends `chunks` and never ends the request: an answer at all means the
  // route stopped reading on its own.
  function streamed(
    ctx: Ctx,
    token: string,
    headers: Record<string, string>,
    chunks: Buffer[],
  ): Promise<number | 'closed'> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/admin/tenants/${ctx.tenant.name}/theme/assets?kind=logo`,
          headers: { 'content-type': 'image/png', authorization: `Bearer ${token}`, ...headers },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on('error', () => {
        resolve('closed');
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('no answer while the body was still arriving'));
      }, 4000);
      req.on('close', () => {
        clearTimeout(timer);
      });
      for (const chunk of chunks) req.write(chunk);
    });
  }

  it('stops a chunked body at the kind’s limit with 413, though it declares no length', async () => {
    const ctx = await tenantCtx();
    const token = await fixture.adminTokenAt(
      ctx.tenant.name,
      ['manage-tenant'],
      `127.0.0.1:${String(port)}`,
    );
    const chunk = Buffer.alloc(64 * 1024, 1);
    const status = await streamed(ctx, token, { 'transfer-encoding': 'chunked' }, [
      chunk,
      chunk,
      chunk,
      chunk,
      chunk,
    ]);
    expect(status).toBe(413);
  });

  it('answers 413 for a declared length over the kind’s limit without the body', async () => {
    const ctx = await tenantCtx();
    const token = await fixture.adminTokenAt(
      ctx.tenant.name,
      ['manage-tenant'],
      `127.0.0.1:${String(port)}`,
    );
    expect(await declaredButUnsent(ctx, '?kind=logo', ASSET_LIMITS.logo.maxBytes + 1, token)).toBe(
      413,
    );
    expect(await declaredButUnsent(ctx, '?kind=banner', 100, token)).toBe(400);
  });
});

const content = (ctx: Ctx, id: string, token?: string) =>
  fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${ctx.tenant.name}/theme/assets/${id}/content`,
    headers: { authorization: `Bearer ${token ?? ctx.token}` },
  });

describe('GET /theme/assets/:assetId/content', () => {
  it('answers an uploaded image no theme names, as stored, under its own type', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [21, 22, 23]);
    const stored_ = await withTenant(fixture.app.db, ctx.tenant.id, (tx) =>
      assetRepository(tx).get(ctx.tenant.id, image.sha256),
    );

    const res = await content(ctx, image.id);

    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toBe(image.mime);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.rawPayload.equals(stored_?.bytes ?? Buffer.alloc(0))).toBe(true);
    expect(res.rawPayload.length).toBe(image.bytes);
  });

  it('answers the same image once a published theme names it, and after it is dropped', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [24, 25, 26]);
    await draftNaming(ctx, image.id);
    expect((await publish(ctx)).statusCode).toBe(200);
    expect((await content(ctx, image.id)).statusCode).toBe(200);
    await draftNaming(ctx, null);
    expect((await publish(ctx)).statusCode).toBe(200);
    expect((await content(ctx, image.id)).statusCode).toBe(200);
  });

  it('is 404 for an unknown id and for another tenant’s, alike, and 400 for a malformed one', async () => {
    const ctx = await tenantCtx();
    const other = await tenantCtx();
    const image = await stored(other, [27, 28, 29]);
    const bodyOf = (res: LightMyRequestResponse): string =>
      res.body.replace(/"instance":"[^"]*"/u, '');

    const foreign = await content(ctx, image.id);
    const missing = await content(ctx, newId());

    expect([foreign.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(bodyOf(foreign)).toBe(bodyOf(missing));
    expect((await content(ctx, 'not-a-uuid')).statusCode).toBe(400);
    expect(foreign.headers['content-type']).toContain('application/problem+json');
  });

  it('is refused without a token, to another tenant’s token and to roles with no theme', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [31, 32, 33]);
    const anonymous = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${ctx.tenant.name}/theme/assets/${image.id}/content`,
    });
    const other = await tenantCtx();
    expect(anonymous.statusCode).toBe(401);
    expect((await content(ctx, image.id, other.token)).statusCode).toBe(401);
    for (const capability of ['view-users', 'manage-users', 'manage-keys']) {
      const token = await fixture.adminToken(ctx.tenant.name, [capability]);
      expect((await content(ctx, image.id, token)).statusCode, capability).toBe(403);
    }
  });

  it('admits manage-clients alone, since a client’s theme names tenant images', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [34, 35, 36]);
    const token = await fixture.adminToken(ctx.tenant.name, ['manage-clients']);
    expect((await content(ctx, image.id, token)).statusCode).toBe(200);
  });

  it('writes no audit event, since it changes nothing', async () => {
    const ctx = await tenantCtx();
    const image = await stored(ctx, [37, 38, 39]);
    const events = () =>
      withTenant(
        fixture.app.db,
        ctx.tenant.id,
        async (tx) => (await tx.select().from(auditEvents)).length,
      );
    const before = await events();
    await content(ctx, image.id);
    expect(await events()).toBe(before);
  });
});

describe('the route table', () => {
  it('names the asset routes, under manage-tenant', () => {
    const routes = ADMIN_ROUTES.filter((route) => route.pattern.includes('/theme/assets'));
    expect(routes.map((route) => `${route.method} ${route.capability ?? ''}`).sort()).toEqual([
      'DELETE manage-tenant',
      'GET manage-tenant',
      'POST manage-tenant',
    ]);
  });

  it('documents the content route as an image of any type', () => {
    const route = ADMIN_ROUTES.find((found) =>
      found.pattern.endsWith('/theme/assets/:assetId/content'),
    );
    expect(route?.successMediaType).toBe('image/*');
  });
});
