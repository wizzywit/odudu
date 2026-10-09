import { tenantDocumentSchema } from '@odudu/contracts/admin';
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

const METADATA = {
  description: 'Bills customers <monthly>',
  client_uri: 'https://billing.example/about?a=1&b=<x>',
  policy_uri: 'https://billing.example/privacy',
  tos_uri: 'http://127.0.0.1:8080/terms',
};

async function createClient(
  tenantName: string,
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}` },
    payload: { client_id: `app-${newId()}`, redirect_uris: [REDIRECT_URI], ...body },
  });
}

async function consentPage(
  tenant: { id: string; name: string },
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const created = await createClient(tenant.name, { consent_required: true, ...body });
  expect(created.statusCode, created.body).toBe(201);
  const username = `ada-${newId()}`;
  await createPasswordSubject(fixture, tenant.id, username, PASSWORD);
  const page = await submitPassword(
    fixture,
    tenant.name,
    created.json<{ client_id: string }>().client_id,
    username,
    PASSWORD,
  );
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('login-actions/consent');
  return page;
}

describe('a client’s description and its three RFC 7591 pages', () => {
  it('stores what a create names and reads it back', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const res = await createClient(t.name, METADATA);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject(METADATA);
  });

  it('reads a client created without them back as null', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const res = await createClient(t.name, {});
    expect(res.json()).toMatchObject({
      description: null,
      client_uri: null,
      policy_uri: null,
      tos_uri: null,
    });
  });

  it.each([
    ['client_uri', 'http://billing.example/about'],
    ['policy_uri', 'javascript:alert(1)'],
    ['tos_uri', '/terms'],
    ['client_uri', 'https://billing.example/about#top'],
  ])('refuses %s %s, which is not an https page', async (field, value) => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.patchClient(t.name, client.id, { [field]: value });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain(field);
  });

  it('amends each field and clears it with null', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const set = await fixture.patchClient(t.name, client.id, METADATA);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject(METADATA);

    const cleared = await fixture.patchClient(t.name, client.id, {
      description: null,
      client_uri: null,
      policy_uri: null,
      tos_uri: null,
    });
    expect(cleared.json()).toMatchObject({
      description: null,
      client_uri: null,
      policy_uri: null,
      tos_uri: null,
    });
  });

  it('refuses a description longer than 1000 characters', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.patchClient(t.name, client.id, { description: 'x'.repeat(1001) });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('description');
  });

  it('registers and echoes the three pages through RFC 7591 registration', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { client_registration_policy: 'open' },
    });
    const pages = {
      client_uri: METADATA.client_uri,
      policy_uri: METADATA.policy_uri,
      tos_uri: METADATA.tos_uri,
    };

    const registered = await fixture.registerClient(t.name, {
      redirect_uris: [REDIRECT_URI],
      ...pages,
    });
    expect(registered.statusCode, registered.body).toBe(201);
    expect(registered.json()).toMatchObject(pages);

    const refused = await fixture.registerClient(t.name, {
      redirect_uris: [REDIRECT_URI],
      policy_uri: 'ftp://billing.example/privacy',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('links the three pages from the consent screen, escaped, under the same policy', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const plain = await consentPage(t, {});
    const linked = await consentPage(t, METADATA);

    expect(linked.body).toContain('href="https://billing.example/about?a=1&amp;b=&lt;x&gt;"');
    expect(linked.body).toContain('href="https://billing.example/privacy"');
    expect(linked.body).toContain('href="http://127.0.0.1:8080/terms"');
    expect(linked.body).not.toContain('<x>');
    expect(plain.body).not.toContain('<a ');
    expect(linked.headers['content-security-policy']).toBe(
      plain.headers['content-security-policy'],
    );
  });

  it('carries all four through an export and an import', async () => {
    const t = await fixture.createTenant(`meta-${newId()}`);
    const created = await createClient(t.name, METADATA);
    const clientId = created.json<{ client_id: string }>().client_id;
    const operator = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exported = await fixture.http.inject({
      url: `/admin/tenants/${t.name}/export`,
      headers: { authorization: `Bearer ${operator}` },
    });
    expect(exported.statusCode).toBe(200);
    const document = tenantDocumentSchema.parse(exported.json());
    expect(document.clients.find((client) => client.client_id === clientId)).toMatchObject(
      METADATA,
    );

    const name = `meta-copy-${newId()}`;
    const imported = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${operator}` },
      payload: { name, document },
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const listed = await fixture.http.inject({
      url: `/admin/tenants/${name}/clients?client_id=${clientId}`,
      headers: { authorization: `Bearer ${operator}` },
    });
    expect(listed.json<{ items: unknown[] }>().items[0]).toMatchObject(METADATA);
  });
});
