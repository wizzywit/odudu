import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

async function call(
  tenantName: string,
  capabilities: readonly string[],
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  tail: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, [...capabilities]);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function tenantWith(locales: string[]): Promise<{ id: string; name: string }> {
  const t = await fixture.createTenant(`i18n-${newId()}`);
  const res = await call(t.name, ['manage-tenant'], 'PATCH', '/settings', {
    supported_locales: locales,
  });
  expect(res.statusCode, res.body).toBe(200);
  return t;
}

interface ClientBody {
  id: string;
  name: string;
  name_i18n: Record<string, string>;
  description_i18n: Record<string, string>;
}

async function createClient(
  tenant: { name: string },
  extra: Record<string, unknown> = {},
): Promise<LightMyRequestResponse> {
  return call(tenant.name, ['manage-clients'], 'POST', '/clients', {
    client_id: `app-${newId()}`,
    name: 'Shop',
    redirect_uris: ['https://shop.example/cb'],
    ...extra,
  });
}

async function etagOfClient(tenantName: string, id: string): Promise<string> {
  const res = await call(tenantName, ['manage-clients'], 'GET', `/clients/${id}`);
  return String(res.headers.etag);
}

function problemPaths(res: LightMyRequestResponse): string[] {
  const body = res.json<{ errors?: { path: string }[] }>();
  return (body.errors ?? []).map((e) => e.path);
}

describe('the base name and description bounds', () => {
  it('holds a client name to 256 on create and PATCH, and lets a stored longer one stay', async () => {
    const t = await fixture.createTenant(`i18n-${newId()}`);
    expect((await createClient(t, { name: 'x'.repeat(257) })).statusCode).toBe(400);
    const made = await createClient(t, { name: 'x'.repeat(256) });
    expect(made.statusCode, made.body).toBe(201);
    const client = made.json<ClientBody>();
    const patch = async (body: unknown) =>
      call(t.name, ['manage-clients'], 'PATCH', `/clients/${client.id}`, body);
    expect((await patch({ name: 'y'.repeat(257) })).statusCode).toBe(400);

    // A name stored before the bound: the same value passes, a longer one does not.
    const long = 'z'.repeat(300);
    await fixture.owner.db.execute(sql`update clients set name = ${long} where id = ${client.id}`);
    expect((await patch({ name: long, enabled: true })).statusCode).toBe(200);
    expect((await patch({ description: 'unrelated edit' })).statusCode).toBe(200);
    expect((await patch({ name: long + 'z' })).statusCode).toBe(400);
  });

  it('holds a scope description to 1000 on create and PATCH, and lets a stored longer one stay', async () => {
    const t = await fixture.createTenant(`i18n-${newId()}`);
    expect((await createScope(t, { description: 'x'.repeat(1001) })).statusCode).toBe(400);
    const scope = (await createScope(t, { description: 'x'.repeat(1000) })).json<ScopeBody>();
    const patch = (body: unknown) =>
      call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${scope.id}`, body);
    expect((await patch({ description: 'x'.repeat(1001) })).statusCode).toBe(400);
    const long = 'y'.repeat(1200);
    await fixture.owner.db.execute(
      sql`update client_scopes set description = ${long} where id = ${scope.id}`,
    );
    expect((await patch({ description: long, display_order: 2 })).statusCode).toBe(200);
    expect((await patch({ display_order: 3 })).statusCode).toBe(200);
    expect((await patch({ description: long + 'y' })).statusCode).toBe(400);
  });
});

describe('per-language client text', () => {
  it('is created, read, listed and exported with the client', async () => {
    const t = await tenantWith(['en', 'fr', 'pt-BR']);
    const created = await createClient(t, {
      name_i18n: { fr: 'Boutique', 'pt-br': 'Loja' },
      description_i18n: { fr: 'Une boutique' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const client = created.json<ClientBody>();
    expect(client.name_i18n).toEqual({ fr: 'Boutique', 'pt-BR': 'Loja' });
    expect(client.description_i18n).toEqual({ fr: 'Une boutique' });

    const read = await call(t.name, ['manage-clients'], 'GET', `/clients/${client.id}`);
    expect(read.json<ClientBody>().name_i18n).toEqual({ fr: 'Boutique', 'pt-BR': 'Loja' });
    const listed = await call(t.name, ['manage-clients'], 'GET', '/clients?limit=100');
    const item = listed.json<{ items: ClientBody[] }>().items.find((c) => c.id === client.id);
    expect(item?.name_i18n).toEqual({ fr: 'Boutique', 'pt-BR': 'Loja' });
    expect(item?.name).toBe('Shop');
  });

  it('defaults both maps to empty', async () => {
    const t = await fixture.createTenant(`i18n-${newId()}`);
    const client = (await createClient(t)).json<ClientBody>();
    expect(client.name_i18n).toEqual({});
    expect(client.description_i18n).toEqual({});
  });

  it('replaces the whole map on a PATCH, and an empty one clears it', async () => {
    const t = await tenantWith(['en', 'fr', 'de']);
    const client = (await createClient(t, { name_i18n: { fr: 'Boutique' } })).json<ClientBody>();
    const patch = async (body: unknown) =>
      call(t.name, ['manage-clients'], 'PATCH', `/clients/${client.id}`, body, {
        'if-match': await etagOfClient(t.name, client.id),
      });

    const replaced = await patch({ name_i18n: { de: 'Laden' } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json<ClientBody>().name_i18n).toEqual({ de: 'Laden' });

    const cleared = await patch({ name_i18n: {} });
    expect(cleared.json<ClientBody>().name_i18n).toEqual({});
  });

  it('is replaced under If-Match, which a PATCH naming a map must carry', async () => {
    const t = await tenantWith(['en', 'fr']);
    const client = (await createClient(t)).json<ClientBody>();
    const bare = await call(t.name, ['manage-clients'], 'PATCH', `/clients/${client.id}`, {
      name_i18n: { fr: 'Boutique' },
    });
    expect(bare.statusCode).toBe(428);

    const etag = await etagOfClient(t.name, client.id);
    const ok = await call(
      t.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { name_i18n: { fr: 'Boutique' } },
      { 'if-match': etag },
    );
    expect(ok.statusCode, ok.body).toBe(200);
    expect(String(ok.headers.etag)).not.toBe(etag);
    const stale = await call(
      t.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { name_i18n: { fr: 'Autre' } },
      { 'if-match': etag },
    );
    expect(stale.statusCode).toBe(412);
  });

  it('leaves the base name and the other map alone', async () => {
    const t = await tenantWith(['en', 'fr']);
    const client = (
      await createClient(t, { name_i18n: { fr: 'Boutique' }, description_i18n: { fr: 'Une' } })
    ).json<ClientBody>();
    const res = await call(
      t.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { description_i18n: { fr: 'Deux' } },
      { 'if-match': await etagOfClient(t.name, client.id) },
    );
    expect(res.json<ClientBody>()).toMatchObject({
      name: 'Shop',
      name_i18n: { fr: 'Boutique' },
      description_i18n: { fr: 'Deux' },
    });
  });

  it('a key outside the tenant’s locales is refused, on create and on PATCH', async () => {
    const t = await tenantWith(['en', 'fr']);
    const created = await createClient(t, { name_i18n: { de: 'Laden' } });
    expect(created.statusCode).toBe(400);
    expect(problemPaths(created)).toEqual(['name_i18n']);

    const client = (await createClient(t)).json<ClientBody>();
    const res = await call(
      t.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { description_i18n: { ja: 'x' } },
      { 'if-match': await etagOfClient(t.name, client.id) },
    );
    expect(res.statusCode).toBe(400);
    expect(problemPaths(res)).toEqual(['description_i18n']);
  });

  it('refuses a 33rd entry', async () => {
    const t = await tenantWith(['en', 'fr']);
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [
        `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
        'a',
      ]),
    );
    const res = await createClient(t, { name_i18n: many });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('at most 32');
  });

  it.each([
    ['a key that is not a tag', { 'not a tag': 'x' }],
    ['a script as a key', { '<script>': 'x' }],
    ['a tag spelled twice', { fr: 'a', FR: 'b' }],
    ['an empty value', { fr: '' }],
    ['a number', { fr: 7 }],
    ['an overlong name', { fr: 'x'.repeat(257) }],
    ['a bidirectional control', { fr: 'a‮b' }],
    ['an array', ['fr']],
    ['null', null],
  ])('refuses %s in name_i18n', async (_label, value) => {
    const t = await tenantWith(['en', 'fr']);
    const res = await createClient(t, { name_i18n: value });
    expect(res.statusCode, res.body).toBe(400);
    expect(problemPaths(res)).toEqual(['name_i18n']);
  });

  it('holds a description to 1000 characters and a name to 256', async () => {
    const t = await tenantWith(['en', 'fr']);
    expect((await createClient(t, { description_i18n: { fr: 'x'.repeat(1000) } })).statusCode).toBe(
      201,
    );
    expect((await createClient(t, { description_i18n: { fr: 'x'.repeat(1001) } })).statusCode).toBe(
      400,
    );
    expect((await createClient(t, { name_i18n: { fr: 'x'.repeat(256) } })).statusCode).toBe(201);
  });

  it('is never reachable through another tenant’s admin', async () => {
    const a = await tenantWith(['en', 'fr']);
    const b = await tenantWith(['en', 'fr']);
    const client = (await createClient(a, { name_i18n: { fr: 'Boutique' } })).json<ClientBody>();
    const res = await call(
      b.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { name_i18n: { fr: 'Pirate' } },
      { 'if-match': '*' },
    );
    expect(res.statusCode).toBe(404);
    const still = await call(a.name, ['manage-clients'], 'GET', `/clients/${client.id}`);
    expect(still.json<ClientBody>().name_i18n).toEqual({ fr: 'Boutique' });
  });

  it('is audited with its values', async () => {
    const t = await tenantWith(['en', 'fr']);
    const client = (await createClient(t)).json<ClientBody>();
    await call(
      t.name,
      ['manage-clients'],
      'PATCH',
      `/clients/${client.id}`,
      { name_i18n: { fr: 'Boutique' } },
      { 'if-match': await etagOfClient(t.name, client.id) },
    );
    const events = await call(t.name, ['view-audit'], 'GET', '/audit?action=client.amend');
    expect(events.body).toContain('Boutique');
  });
});

interface ScopeBody {
  id: string;
  consent_text: string | null;
  description_i18n: Record<string, string>;
  consent_text_i18n: Record<string, string>;
}

const createScope = (tenant: { name: string }, extra: Record<string, unknown> = {}) =>
  call(tenant.name, ['manage-tenant'], 'POST', '/scopes', { name: `s-${newId()}`, ...extra });

describe('per-language scope text', () => {
  it('is created and read back, canonically spelled', async () => {
    const t = await tenantWith(['en', 'fr-CA']);
    const created = await createScope(t, {
      consent_text: 'Read your reports',
      consent_text_i18n: { 'FR-ca': 'Lire vos rapports' },
      description_i18n: { 'fr-CA': 'Rapports' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const scope = created.json<ScopeBody>();
    expect(scope.consent_text_i18n).toEqual({ 'fr-CA': 'Lire vos rapports' });
    const read = await call(t.name, ['manage-tenant'], 'GET', `/scopes/${scope.id}`);
    expect(read.json<ScopeBody>()).toMatchObject({
      consent_text: 'Read your reports',
      consent_text_i18n: { 'fr-CA': 'Lire vos rapports' },
      description_i18n: { 'fr-CA': 'Rapports' },
    });
    const listed = await call(t.name, ['manage-tenant'], 'GET', '/scopes?limit=200');
    const item = listed.json<{ items: ScopeBody[] }>().items.find((s) => s.id === scope.id);
    expect(item?.consent_text_i18n).toEqual({ 'fr-CA': 'Lire vos rapports' });
  });

  it('replaces a map whole on PATCH and leaves the other alone', async () => {
    const t = await tenantWith(['en', 'fr', 'de']);
    const scope = (
      await createScope(t, { consent_text_i18n: { fr: 'a' }, description_i18n: { fr: 'd' } })
    ).json<ScopeBody>();
    const res = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${scope.id}`, {
      consent_text_i18n: { de: 'b' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ScopeBody>()).toMatchObject({
      consent_text_i18n: { de: 'b' },
      description_i18n: { fr: 'd' },
    });
  });

  it('a key outside the tenant’s locales is refused', async () => {
    const t = await tenantWith(['en', 'fr']);
    const created = await createScope(t, { consent_text_i18n: { de: 'x' } });
    expect(created.statusCode).toBe(400);
    expect(problemPaths(created)).toEqual(['consent_text_i18n']);
    const scope = (await createScope(t)).json<ScopeBody>();
    const patched = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${scope.id}`, {
      description_i18n: { de: 'x' },
    });
    expect(patched.statusCode).toBe(400);
    expect(problemPaths(patched)).toEqual(['description_i18n']);
  });

  it.each([
    ['consent_text_i18n', { fr: 'x'.repeat(501) }],
    ['consent_text_i18n', { fr: '' }],
    ['consent_text_i18n', { fr: 'a‮b' }],
    ['consent_text_i18n', { fr_FR: 'x' }],
    ['description_i18n', { fr: 'x'.repeat(1001) }],
    ['description_i18n', { fr: 1 }],
  ])('refuses %s of %j', async (field, value) => {
    const t = await tenantWith(['en', 'fr']);
    const scope = (await createScope(t)).json<ScopeBody>();
    const res = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${scope.id}`, {
      [field]: value,
    });
    expect([400, 422]).toContain(res.statusCode);
    expect(problemPaths(res)).toEqual([field]);
  });

  it('refuses a 33rd entry', async () => {
    const t = await tenantWith(['en', 'fr']);
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [
        `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
        'a',
      ]),
    );
    const res = await createScope(t, { consent_text_i18n: many });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('at most 32');
  });

  it('is never reachable through another tenant’s admin', async () => {
    const a = await tenantWith(['en', 'fr']);
    const b = await tenantWith(['en', 'fr']);
    const scope = (await createScope(a, { consent_text_i18n: { fr: 'a' } })).json<ScopeBody>();
    const res = await call(b.name, ['manage-tenant'], 'PATCH', `/scopes/${scope.id}`, {
      consent_text_i18n: { fr: 'pirate' },
    });
    expect(res.statusCode).toBe(404);
    const still = await call(a.name, ['manage-tenant'], 'GET', `/scopes/${scope.id}`);
    expect(still.json<ScopeBody>().consent_text_i18n).toEqual({ fr: 'a' });
  });
});

async function operatorToken(): Promise<string> {
  return fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
}

async function exportOf(token: string, tenantName: string): Promise<TenantDocument> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/export`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.payload).toBe(200);
  return tenantDocumentSchema.parse(JSON.parse(res.payload));
}

function postImport(token: string, body: unknown): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: '/admin/tenant-imports',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

describe('the base bounds and the tenant document', () => {
  it('round-trips a legacy long client name and scope description, and bounds the maps', async () => {
    const t = await fixture.createTenant(`i18n-long-${newId()}`);
    const client = (await createClient(t, { client_id: 'long' })).json<ClientBody>();
    const scope = (await createScope(t, { name: 'long:scope' })).json<ScopeBody>();
    const name = 'n'.repeat(300);
    const description = 'd'.repeat(1200);
    await fixture.owner.db.execute(sql`update clients set name = ${name} where id = ${client.id}`);
    await fixture.owner.db.execute(
      sql`update client_scopes set description = ${description} where id = ${scope.id}`,
    );
    const token = await operatorToken();
    const document = await exportOf(token, t.name);
    expect(document.clients.find((c) => c.client_id === 'long')?.name).toBe(name);
    const copy = `i18n-long-copy-${newId()}`;
    const res = await postImport(token, { name: copy, document });
    expect(res.statusCode, res.payload).toBe(201);
    const again = await exportOf(token, copy);
    expect(again.clients.find((c) => c.client_id === 'long')?.name).toBe(name);
    expect(again.scopes.find((s) => s.name === 'long:scope')?.description).toBe(description);

    const tooLong: TenantDocument = {
      ...document,
      clients: document.clients.map((c) =>
        c.client_id === 'long' ? { ...c, name_i18n: { en: 'x'.repeat(257) } } : c,
      ),
      scopes: document.scopes.map((s) =>
        s.name === 'long:scope' ? { ...s, description_i18n: { en: 'x'.repeat(1001) } } : s,
      ),
    };
    const refused = await postImport(token, {
      name: `i18n-long-bad-${newId()}`,
      document: tooLong,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toMatch(/document\.clients\[\d+\]\.name_i18n/u);
    expect(refused.body).toMatch(/document\.scopes\[\d+\]\.description_i18n/u);
  });

  it('compares an unchanged name as stored, padding included', async () => {
    const t = await fixture.createTenant(`i18n-pad-${newId()}`);
    const client = (await createClient(t)).json<ClientBody>();
    const padded = `${'p'.repeat(300)}   `;
    await fixture.owner.db.execute(
      sql`update clients set name = ${padded} where id = ${client.id}`,
    );
    const res = await call(t.name, ['manage-clients'], 'PATCH', `/clients/${client.id}`, {
      name: padded,
    });
    expect(res.statusCode, res.body).toBe(200);
    const trimmed = await call(t.name, ['manage-clients'], 'PATCH', `/clients/${client.id}`, {
      name: padded.trim(),
    });
    expect(trimmed.statusCode).toBe(400);
  });
});

describe('per-language text in the tenant document', () => {
  it('round-trips through export and import', async () => {
    const t = await tenantWith(['en', 'fr', 'pt-BR']);
    await createClient(t, {
      client_id: 'shop',
      name_i18n: { fr: 'Boutique' },
      description_i18n: { 'pt-BR': 'Loja' },
    });
    await createScope(t, {
      name: 'reports:read',
      consent_text: 'Read',
      consent_text_i18n: { fr: 'Lire' },
      description_i18n: { fr: 'Rapports' },
    });
    const token = await operatorToken();
    const document = await exportOf(token, t.name);
    const shop = document.clients.find((c) => c.client_id === 'shop');
    expect(shop).toMatchObject({
      name_i18n: { fr: 'Boutique' },
      description_i18n: { 'pt-BR': 'Loja' },
    });
    const name = `i18n-copy-${newId()}`;
    const res = await postImport(token, { name, document });
    expect(res.statusCode, res.payload).toBe(201);
    const again = await exportOf(token, name);
    expect(again.clients.find((c) => c.client_id === 'shop')).toMatchObject({
      name_i18n: { fr: 'Boutique' },
      description_i18n: { 'pt-BR': 'Loja' },
    });
    expect(again.scopes.find((s) => s.name === 'reports:read')).toMatchObject({
      consent_text_i18n: { fr: 'Lire' },
      description_i18n: { fr: 'Rapports' },
    });
  });

  it('imports a document exported before the maps existed', async () => {
    const t = await fixture.createTenant(`i18n-old-${newId()}`);
    await createClient(t, { client_id: 'shop' });
    const token = await operatorToken();
    const exported = await exportOf(token, t.name);
    const strip = (record: object, ...names: string[]) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !names.includes(key)));
    const document = {
      ...exported,
      clients: exported.clients.map((c) => strip(c, 'name_i18n', 'description_i18n')),
      scopes: exported.scopes.map((s) => strip(s, 'description_i18n', 'consent_text_i18n')),
    };
    const name = `i18n-old-copy-${newId()}`;
    const res = await postImport(token, { name, document });
    expect(res.statusCode, res.payload).toBe(201);
    const again = await exportOf(token, name);
    expect(again.clients.find((c) => c.client_id === 'shop')?.name_i18n).toEqual({});
  });

  it('refuses a document with a language outside its own settings, naming the path', async () => {
    const t = await tenantWith(['en', 'fr']);
    await createClient(t, { client_id: 'shop' });
    const token = await operatorToken();
    const document = await exportOf(token, t.name);
    const broken: TenantDocument = {
      ...document,
      clients: document.clients.map((c) =>
        c.client_id === 'shop' ? { ...c, name_i18n: { de: 'Laden' } } : c,
      ),
    };
    const res = await postImport(token, { name: `i18n-bad-${newId()}`, document: broken });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/document\.clients\[\d+\]\.name_i18n/u);
  });
});
