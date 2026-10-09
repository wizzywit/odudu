import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { createPasswordSubject, REDIRECT_URI, submitPassword } from '#/testing/sign-in';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const PASSWORD = 'correct horse battery staple';

async function call(
  tenantName: string,
  capabilities: readonly string[],
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  tail: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, [...capabilities]);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function scope(tenantName: string, body: Record<string, unknown>): Promise<string> {
  const res = await call(tenantName, ['manage-tenant'], 'POST', '/scopes', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

async function consentPage(
  tenant: { id: string; name: string },
  assignments: Readonly<Record<string, 'default' | 'optional'>>,
  requested: string,
): Promise<string> {
  const created = await call(tenant.name, ['manage-clients'], 'POST', '/clients', {
    client_id: `app-${newId()}`,
    redirect_uris: [REDIRECT_URI],
    consent_required: true,
  });
  expect(created.statusCode, created.body).toBe(201);
  const client = created.json<{ id: string; client_id: string }>();
  const listed = await call(tenant.name, ['manage-tenant'], 'GET', '/scopes?limit=200');
  const ids = new Map(
    listed.json<{ items: { id: string; name: string }[] }>().items.map((s) => [s.name, s.id]),
  );
  for (const [name, assignment] of Object.entries(assignments)) {
    const res = await call(
      tenant.name,
      ['manage-tenant'],
      'PUT',
      `/scopes/${String(ids.get(name))}/clients/${client.id}`,
      { assignment },
    );
    expect(res.statusCode, res.body).toBe(200);
  }
  const username = `ada-${newId()}`;
  await createPasswordSubject(fixture, tenant.id, username, PASSWORD);
  const page = await submitPassword(
    fixture,
    tenant.name,
    client.client_id,
    username,
    PASSWORD,
    requested,
  );
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('login-actions/consent');
  return page.body;
}

describe('a scope’s consent text and display order', () => {
  it('are stored, read back, and amended', async () => {
    const t = await fixture.createTenant(`sct-${newId()}`);
    const id = await scope(t.name, {
      name: 'reports:read',
      consent_text: 'Read your reports',
      display_order: 5,
    });
    const read = await call(t.name, ['manage-tenant'], 'GET', `/scopes/${id}`);
    expect(read.json()).toMatchObject({ consent_text: 'Read your reports', display_order: 5 });

    const amended = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${id}`, {
      consent_text: null,
      display_order: 1,
    });
    expect(amended.statusCode, amended.body).toBe(200);
    expect(amended.json()).toMatchObject({ consent_text: null, display_order: 1 });
    const plain = await call(t.name, ['manage-tenant'], 'GET', '/scopes?name=openid');
    expect(plain.json<{ items: unknown[] }>().items[0]).toMatchObject({
      consent_text: null,
      display_order: 0,
    });
  });

  it.each([
    ['consent_text', 'x'.repeat(501)],
    ['consent_text', ''],
    ['consent_text', 7],
    ['display_order', -1],
    ['display_order', 1.5],
    ['display_order', 'first'],
  ])('refuses %s %j, naming the field', async (field, value) => {
    const t = await fixture.createTenant(`sct-${newId()}`);
    const id = await scope(t.name, { name: 'reports:read' });
    const res = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${id}`, {
      [field]: value,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(field);
  });

  it('orders the consent screen by display order and shows each text, escaped', async () => {
    const t = await fixture.createTenant(`sct-${newId()}`);
    await scope(t.name, {
      name: 'zebra',
      consent_text: 'See your <zebras> & "stripes"',
      display_order: 1,
    });
    await scope(t.name, { name: 'apple', display_order: 2 });
    await scope(t.name, { name: 'mango', consent_text: 'Pick your mangoes', display_order: 0 });
    await scope(t.name, { name: 'kiwi', consent_text: 'Peel your kiwis', display_order: 1 });

    const body = await consentPage(
      t,
      { zebra: 'default', apple: 'default', mango: 'optional', kiwi: 'optional' },
      'openid apple zebra kiwi mango',
    );

    expect(body).toContain('See your &lt;zebras&gt; &amp; &quot;stripes&quot;');
    expect(body).not.toContain('<zebras>');
    expect(body).toContain('value="mango"');
    expect(body).toContain('> Pick your mangoes</label>');
    const order = ['openid', 'See your', 'apple', 'Pick your mangoes', 'Peel your kiwis'].map(
      (marker) => body.indexOf(marker),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('travels in a tenant document', async () => {
    const t = await fixture.createTenant(`sct-${newId()}`);
    await scope(t.name, { name: 'reports:read', consent_text: 'Read reports', display_order: 3 });
    const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exportOf = async (name: string): Promise<TenantDocument> => {
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${name}/export`,
        headers: { authorization: `Bearer ${token}` },
      });
      return tenantDocumentSchema.parse(JSON.parse(res.payload));
    };
    const document = await exportOf(t.name);
    const imported = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: `imp-${newId()}`, document }),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const again = await exportOf(imported.json<{ tenant: { name: string } }>().tenant.name);
    expect(again.scopes.find((entry) => entry.name === 'reports:read')).toMatchObject({
      consent_text: 'Read reports',
      display_order: 3,
    });

    const index = document.scopes.findIndex((entry) => entry.name === 'reports:read');
    const tampered = {
      ...document,
      scopes: document.scopes.map((entry, at) =>
        at === index ? { ...entry, consent_text: 'x'.repeat(501), display_order: -2 } : entry,
      ),
    };
    const refused = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: `imp-${newId()}`, document: tampered }),
    });
    expect(refused.statusCode).toBe(400);
    const paths = refused.json<{ errors: { path: string }[] }>().errors.map((error) => error.path);
    expect(paths).toContain(`document.scopes[${String(index)}].consent_text`);
    expect(paths).toContain(`document.scopes[${String(index)}].display_order`);
  });
});
