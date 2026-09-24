import { newId } from '@odudu/kernel';
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

// A GET's own `ETag`, for the tests below that amend one of the five
// wholesale list fields — `amendClient` requires `If-Match` on those
// (packages/protocol-admin/src/usecase/clients.ts), so a valid amendment to
// one still has to carry the precondition the amendment design added.
// The tenant a caller needs before dynamic registration answers anything
// but `404` at all — closed by default (ADR 0026); mirrors
// `openRegistration` in clients.int.test.ts.
async function openRegistration(tenantName: string): Promise<void> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { client_registration_policy: 'open' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`could not open registration for ${tenantName}: ${res.body}`);
  }
}

async function currentEtag(tenantName: string, clientDbId: string, token: string): Promise<string> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients/${clientDbId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const etag = res.headers.etag;
  if (typeof etag !== 'string') {
    throw new Error(`fixture: no ETag on GET /clients/${clientDbId}`);
  }
  return etag;
}

describe('an amendment that changes what a client may do', () => {
  it('narrowing grant_types stops the next /token call using the removed grant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials', 'refresh_token'],
    });
    const before = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(before.statusCode).toBe(200);

    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { grant_types: ['refresh_token'] },
    });
    expect(patched.statusCode).toBe(200);

    const after = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(after.statusCode).toBe(400);
    expect(after.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('refuses a redirect list registration would refuse, with the same detail', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { redirect_uris: ['https://app.example/cb#fragment'] },
    });
    expect(res.statusCode).toBe(400);
    const registration = await fixture.registerClient(t.name, {
      redirect_uris: ['https://app.example/cb#fragment'],
    });
    expect(res.json<{ detail: string }>().detail).toContain(
      registration.json<{ error_description: string }>().error_description,
    );
  });

  it('replaces a redirect list rather than appending to it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      redirectUris: ['https://a.example/cb', 'https://b.example/cb'],
    });
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { redirect_uris: ['https://a.example/cb'] },
    });
    expect(patched.statusCode).toBe(200);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<{ redirect_uris: string[] }>().redirect_uris).toEqual([
      'https://a.example/cb',
    ]);
  });
});
