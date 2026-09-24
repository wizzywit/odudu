import { withTenant } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { createClient } from '#/usecase/clients';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

// The tenant a caller needs before it can register a client through the
// dynamic-registration door at all — closed by default (ADR 0026), so the
// jwks/jwks_uri comparison test below opens it the same way an operator
// would.
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

describe('POST /admin/tenants/{t}/clients', () => {
  it('creates a public client that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const clientId = `spa-${newId()}`;
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: clientId,
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ client_secret?: string }>().client_secret).toBeUndefined();

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listed = list.json<{ items: { client_id: string }[] }>().items;
    expect(listed.map((c) => c.client_id)).toContain(clientId);
  });

  it('returns a confidential client secret once, and never on a read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `backend-${newId()}`,
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'client_secret_basic',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; client_secret: string }>();
    expect(typeof created.client_secret).toBe('string');

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    // The serialised body, not a mapped object — a leak through a field
    // toWireClient forgot to omit would not show up any other way. The
    // quoted key, not the bare word: `token_endpoint_auth_method` legitimately
    // carries the value `client_secret_basic`.
    expect(read.body).not.toContain('"client_secret"');
    expect(read.body).not.toContain(created.client_secret);
    expect(read.headers.etag).toBeDefined();
  });

  it('refuses the reserved client_id odudu-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: 'odudu-admin',
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses jwks and jwks_uri together the same way dynamic registration does', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const metadata = {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: { keys: [] },
      jwks_uri: 'https://app.example/jwks.json',
    };

    const adminRes = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { client_id: `rp-${newId()}`, ...metadata },
    });
    expect(adminRes.statusCode).toBe(400);

    const registrationRes = await fixture.registerClient(t.name, metadata);
    expect(registrationRes.statusCode).toBe(400);

    expect(adminRes.json<{ detail: string }>().detail).toBe(
      registrationRes.json<{ error_description: string }>().error_description,
    );
  });

  it('refuses a caller holding only manage-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `x-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/tenants/{t}/clients and /clients/{id}', () => {
  it('probes with a foreign tenant_id and finds nothing to leak', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`other-${newId()}`);
    const token1 = await fixture.adminToken(t1.name, ['manage-clients']);
    const create = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t1.name}/clients`,
      headers: { authorization: `Bearer ${token1}`, 'content-type': 'application/json' },
      payload: {
        client_id: `iso-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    const { id } = create.json<{ id: string }>();

    await withTenant(fixture.app.db, t2.id, async (tx) => {
      expect(await clientRepository(tx).byId(id)).toBeNull();
    });

    const token2 = await fixture.adminToken(t2.name, ['manage-clients']);
    const crossRead = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t2.name}/clients/${id}`,
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(crossRead.statusCode).toBe(404);
  });

  it('answers 404 for an unknown client id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a caller holding only manage-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admits a system admin holding manage-tenants and manage-clients', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-clients']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a system admin holding manage-tenants but not manage-clients', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('createClient', () => {
  it('calls audit exactly once when it creates a client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          tlsClientAuthEnabled: false,
          audit: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientId: `audited-${newId()}`,
          metadata: {
            redirect_uris: ['https://app.example/cb'],
            token_endpoint_auth_method: 'none',
          },
          tenantId: t.id,
          actorSubjectId: 'test-subject',
        },
      ),
    );
    expect(outcome.kind).toBe('ok');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when the client_id is reserved', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          tlsClientAuthEnabled: false,
          audit: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientId: 'odudu-admin',
          metadata: { token_endpoint_auth_method: 'none', grant_types: ['client_credentials'] },
          tenantId: t.id,
          actorSubjectId: 'test-subject',
        },
      ),
    );
    expect(outcome.kind).toBe('reserved_client_id');
    expect(events).toHaveLength(0);
  });

  it('does not call audit when the metadata is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          tlsClientAuthEnabled: false,
          audit: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientId: `refused-${newId()}`,
          metadata: {
            grant_types: ['client_credentials'],
            token_endpoint_auth_method: 'private_key_jwt',
            jwks: { keys: [] },
            jwks_uri: 'https://app.example/jwks.json',
          },
          tenantId: t.id,
          actorSubjectId: 'test-subject',
        },
      ),
    );
    expect(outcome.kind).toBe('invalid_metadata');
    expect(events).toHaveLength(0);
  });
});
