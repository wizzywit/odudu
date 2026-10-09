import { PRIVATE_JWK_MEMBERS } from '@odudu/crypto';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { ClientIdConflictError, clientRepository, clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfig, clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { eq, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendClient, createClient, deleteClient, rotateClientSecret } from '#/usecase/clients';

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

  it('honours every admin field PATCH accepts, in the response and on a later read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `api-${newId()}`,
        name: 'Orders API client',
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
        audiences: ['https://api.example'],
        web_origins: ['https://app.example'],
        post_logout_redirect_uris: ['https://app.example/bye'],
        client_credentials_scopes: ['orders:read'],
        access_token_ttl_seconds: 120,
        refresh_token_ttl_seconds: 3600,
        consent_required: true,
        token_exchange_impersonation_allowed: true,
        full_scope_allowed: true,
        enabled: false,
      },
    });
    expect(res.statusCode).toBe(201);
    const expected = {
      name: 'Orders API client',
      audiences: ['https://api.example'],
      web_origins: ['https://app.example'],
      post_logout_redirect_uris: ['https://app.example/bye'],
      client_credentials_scopes: ['orders:read'],
      access_token_ttl_seconds: 120,
      refresh_token_ttl_seconds: 3600,
      consent_required: true,
      token_exchange_impersonation_allowed: true,
      full_scope_allowed: true,
      enabled: false,
    };
    const created = res.json<{ id: string }>();
    expect(created).toMatchObject(expected);

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject(expected);
  });

  it.each([
    [{ audiences: 'https://api.example' }, 'audiences: audiences must be an array of strings'],
    [{ web_origins: ['https://app.example/path'] }, 'web_origins entry "https://app.example/path"'],
    [{ access_token_ttl_seconds: 1.5 }, 'access_token_ttl_seconds must be an integer'],
    [{ type: 'confidential' }, "type silently changes a live client's security model"],
    [{ colour: 'blue' }, 'colour: colour is not a client field'],
    [{ name: 'One', client_name: 'Other' }, 'name and client_name disagree'],
  ])('400s naming the field for %j and creates nothing', async (extra, detail) => {
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
        ...extra,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain(detail);

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listed = list.json<{ items: { client_id: string }[] }>().items;
    expect(listed.map((c) => c.client_id)).not.toContain(clientId);
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
    // Pinned to the body it was computed from, not merely present — an
    // ETag that stopped tracking the response (stale, or hashing a
    // different shape) would still satisfy `toBeDefined()`.
    // The ETag is taken over the stored fields; what the service account
    // holds is derived, and outside it.
    const { service_account_admin_reach: reach, ...stored } = read.json<{
      service_account_admin_reach: string[];
    }>();
    expect(reach).toEqual([]);
    expect(read.headers.etag).toBe(etagOf(stored));
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

  it('refuses a duplicate client_id with 409, not the generic 500 the driver would raise', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const clientId = `dup-${newId()}`;
    const payload = {
      client_id: clientId,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    };
    const first = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it('records registration_origin as operator, distinct from a seeded client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `op-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ registration_origin: string }>().registration_origin).toBe('operator');
  });

  it('is refused past max_clients, the same way dynamic registration is', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    // The tenant already carries its own built-in admin client, so this
    // caps the tenant at exactly what it already holds.
    const settingsToken = await fixture.adminToken(t.name, ['manage-tenant']);
    const settingsRes = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${settingsToken}`, 'content-type': 'application/json' },
      payload: { max_clients: 1 },
    });
    expect(settingsRes.statusCode).toBe(200);

    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `over-cap-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(403);
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

  it('refuses a jwks holding a private key, on create and on amend', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const privateJwks = { keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'private' }] };
    const description = 'jwks.keys[0] carries the private member d; register public keys only';

    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers,
      payload: {
        client_id: `rp-${newId()}`,
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: privateJwks,
      },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json<{ detail: string }>().detail).toBe(description);

    const client = await fixture.createConfidentialClient(t.name, {});
    const amended = await fixture.patchClient(t.name, client.id, {
      token_endpoint_auth_method: 'private_key_jwt',
      jwks: privateJwks,
    });
    expect(amended.statusCode).toBe(400);
    expect(amended.json<{ detail: string }>().detail).toBe(description);
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

  it('reads builtin_admin: true for the built-in admin client, false for an ordinary one', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);

    const adminRead = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${admin.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(adminRead.json<{ builtin_admin: boolean }>().builtin_admin).toBe(true);

    const create = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `spa-${newId()}`,
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(create.json<{ builtin_admin: boolean }>().builtin_admin).toBe(false);
  });

  it('reads a confidential client’s service_subject_id, and null for a public client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const confidential = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `backend-${newId()}`,
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'client_secret_basic',
      },
    });
    expect(
      typeof confidential.json<{ service_subject_id: string | null }>().service_subject_id,
    ).toBe('string');

    const publicClient = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `spa-${newId()}`,
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(
      publicClient.json<{ service_subject_id: string | null }>().service_subject_id,
    ).toBeNull();
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

  it('advances the cursor to rows the first page did not contain', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const clientIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const clientId = `page-${newId()}`;
      const res = await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/clients`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: {
          client_id: clientId,
          redirect_uris: ['https://app.example/cb'],
          token_endpoint_auth_method: 'none',
        },
      });
      expect(res.statusCode).toBe(201);
      clientIds.push(clientId);
    }
    // The tenant's own built-in admin client already occupies one row, so
    // a page of 1 still leaves more than one further page to walk.
    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: { client_id: string }[]; next?: string }>();
    expect(firstBody.next).toBeDefined();
    expect(first.headers.link).toContain('rel="next"');

    const second = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients?limit=1&cursor=${encodeURIComponent(firstBody.next ?? '')}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ items: { client_id: string }[] }>();
    expect(secondBody.items).toHaveLength(1);
    // The cursor moved: the second page's row is not the first page's row.
    expect(secondBody.items[0]?.client_id).not.toBe(firstBody.items[0]?.client_id);
  });
});

async function seedClient(
  tenantName: string,
  clientId: string,
  options: { readonly name?: string; readonly confidential?: boolean } = {},
): Promise<string> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      client_id: clientId,
      ...(options.name === undefined ? {} : { client_name: options.name }),
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: options.confidential === true ? 'client_secret_basic' : 'none',
    },
  });
  if (res.statusCode !== 201) throw new Error(`could not create ${clientId}: ${res.body}`);
  return res.json<{ id: string }>().id;
}

async function listClientsAt(tenantName: string, query: string): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function clientIdsOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { client_id: string }[] }>().items.map((c) => c.client_id);
}

// PostgreSQL's own answer, in the order a searched listing promises, so no
// expectation here folds a string in JavaScript.
async function nameMatches(tenantId: string, prefix: string): Promise<string[]> {
  const rows = await fixture.owner.db.execute<{ client_id: string }>(sql`
    select client_id from clients
     where tenant_id = ${tenantId} and starts_with(lower(name), lower(${prefix}))
     order by lower(name) collate "C", id
  `);
  return rows.map((row) => row.client_id);
}

describe('GET /admin/tenants/{t}/clients — search and exact filters', () => {
  it('finds a client_id case-insensitively', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedClient(t.name, 'Portal-Web');
    await seedClient(t.name, 'billing');

    const res = await listClientsAt(t.name, 'client_id=portal');
    expect(res.statusCode).toBe(200);
    expect(clientIdsOf(res)).toEqual(['Portal-Web']);
  });

  it('orders name matches by the folded name, then by id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedClient(t.name, 'c1', { name: 'Shop c' });
    await seedClient(t.name, 'c2', { name: 'SHOP A' });
    await seedClient(t.name, 'c3', { name: 'shop b' });
    await seedClient(t.name, 'c4', { name: 'Shop a' });
    await seedClient(t.name, 'c5', { name: 'Stock' });

    const res = await listClientsAt(t.name, 'name=shop');
    expect(res.statusCode).toBe(200);
    const expected = await nameMatches(t.id, 'shop');
    expect(expected).toHaveLength(4);
    expect(clientIdsOf(res)).toEqual(expected);
  });

  it('pages a client_id search one row at a time, each match once and in order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const clientId of ['app-b', 'APP-a', 'app-c', 'other']) await seedClient(t.name, clientId);

    const seen: string[] = [];
    let query = 'client_id=app&limit=1';
    for (let page = 0; page < 5; page += 1) {
      const res = await listClientsAt(t.name, query);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { client_id: string }[]; next?: string }>();
      seen.push(...body.items.map((c) => c.client_id));
      if (body.next === undefined) break;
      query = `client_id=app&limit=1&cursor=${encodeURIComponent(body.next)}`;
    }
    expect(seen).toEqual(['APP-a', 'app-b', 'app-c']);
  });

  it('reads _ and % as ordinary characters', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedClient(t.name, 'axb');
    await seedClient(t.name, 'a_b');
    await seedClient(t.name, 'a%b');

    expect(clientIdsOf(await listClientsAt(t.name, 'client_id=a_b'))).toEqual(['a_b']);
    expect(clientIdsOf(await listClientsAt(t.name, 'client_id=a%25'))).toEqual(['a%b']);
  });

  it('filters by ?type= and ?enabled=, ANDed with a search', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedClient(t.name, 'svc-a', { confidential: true });
    const off = await seedClient(t.name, 'svc-b', { confidential: true });
    await seedClient(t.name, 'spa');
    await fixture.owner.db.update(clients).set({ enabled: false }).where(eq(clients.id, off));

    expect(clientIdsOf(await listClientsAt(t.name, 'client_id=s&type=public'))).toEqual(['spa']);
    expect(clientIdsOf(await listClientsAt(t.name, 'client_id=s&type=confidential'))).toEqual([
      'svc-a',
      'svc-b',
    ]);
    expect(clientIdsOf(await listClientsAt(t.name, 'enabled=false'))).toEqual(['svc-b']);
    expect(clientIdsOf(await listClientsAt(t.name, 'type=confidential&enabled=true'))).toEqual(
      expect.arrayContaining(['svc-a']),
    );
    expect(
      clientIdsOf(await listClientsAt(t.name, 'type=confidential&enabled=true')),
    ).not.toContain('svc-b');
  });

  it('finds nothing searching for a client that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    await seedClient(other.name, 'foreign-app');

    const res = await listClientsAt(t.name, 'client_id=foreign');
    expect(res.statusCode).toBe(200);
    expect(clientIdsOf(res)).toEqual([]);
  });

  it('refuses an unknown parameter with 400 naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await listClientsAt(t.name, 'search=app');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('search');
  });

  it('refuses a search over client_id and name at once', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await listClientsAt(t.name, 'client_id=a&name=b');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('one field at a time');
  });

  it('refuses a type other than public or confidential, and an enabled other than true or false', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    expect((await listClientsAt(t.name, 'type=service')).statusCode).toBe(400);
    expect((await listClientsAt(t.name, 'enabled=yes')).statusCode).toBe(400);
  });

  it.each([
    ['another search', 'client_id=a&limit=1', 'client_id=b&limit=1'],
    ['a filter added', 'client_id=a&limit=1', 'client_id=a&type=public&limit=1'],
    ['a filter dropped', 'client_id=a&type=public&limit=1', 'client_id=a&limit=1'],
  ])('refuses a cursor replayed under %s', async (_label, minted, replayedUnder) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const clientId of ['a-1', 'a-2', 'b-1', 'b-2']) await seedClient(t.name, clientId);

    const first = await listClientsAt(t.name, minted);
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listClientsAt(
      t.name,
      `${replayedUnder}&cursor=${encodeURIComponent(next)}`,
    );
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
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
          audit: (_tx, event) => {
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
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('ok');
    expect(events).toHaveLength(1);
  });

  it('audits a refusal when the client_id is reserved', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: { outcome: string }[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientId: 'odudu-admin',
          metadata: { token_endpoint_auth_method: 'none', grant_types: ['client_credentials'] },
          tenantId: t.id,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('reserved_client_id');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('refused');
  });

  it('audits a refusal when the metadata is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: { outcome: string }[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
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
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('invalid_metadata');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('refused');
  });

  it('does not call audit when the client_id collides with an existing client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const clientId = `dup-usecase-${newId()}`;
    const events: unknown[] = [];
    const deps = {
      hashClientSecret: (secret: string) => Promise.resolve(`hashed:${secret}`),
      tlsClientAuthEnabled: false,
      audit: (_tx: TenantScopedDatabase, event: unknown) => {
        events.push(event);
        return Promise.resolve();
      },
    };
    const metadata = {
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    };
    await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(tx, deps, {
        clientId,
        metadata,
        tenantId: t.id,
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      }),
    );
    events.length = 0;

    // `ClientIdConflictError` propagates out of `createClient` rather than
    // being returned as an outcome (see the comment on its `create` call) —
    // so the second attempt is asserted by its rejection, not its result.
    await expect(
      withTenant(fixture.app.db, t.id, (tx) =>
        createClient(tx, deps, {
          clientId,
          metadata,
          tenantId: t.id,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        }),
      ),
    ).rejects.toThrow(ClientIdConflictError);
    expect(events).toHaveLength(0);
  });
});

describe('PATCH /admin/tenants/{t}/clients/{id}', () => {
  it('amends name with no If-Match and bumps the ETag', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});
    const before = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'Renamed client' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ name: string }>().name).toBe('Renamed client');
    expect(patched.headers.etag).not.toBe(before.headers.etag);
  });

  it("400s naming client_id, quoting refusalFor's reason", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { client_id: 'renamed-client-id' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain(
      'orphans the azp of every issued token',
    );
  });

  it('412s when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale-etag"',
      },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(412);
  });

  it.each([
    ['redirect_uris', ['https://app.example/other-cb']],
    ['post_logout_redirect_uris', ['https://app.example/logout']],
    ['web_origins', ['https://app.example']],
    ['audiences', ['urn:example:audience']],
    ['grant_types', ['client_credentials']],
    ['client_credentials_scopes', ['read:orders']],
  ])('428s amending %s with no If-Match', async (field, value) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { [field]: value },
    });
    expect(res.statusCode, field).toBe(428);
  });

  it('calls audit exactly once on a successful amendment', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.id,
          values: { name: 'Audited rename' },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('ok');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when a field is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.id,
          values: { client_id: 'evasion-attempt' },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('refused_field');
    expect(events).toHaveLength(0);
  });

  it('does not call audit when If-Match is required and missing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.id,
          values: { grant_types: ['client_credentials'] },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('precondition_required');
    expect(events).toHaveLength(0);
  });

  it('calls audit once, with a refused row, when the built-in admin guard refuses it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const admin = await fixture.builtinAdminClient(t.name);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: admin.id,
          values: { enabled: false },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('builtin_admin_guarded');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'refused' });
    expect(typeof (events[0] as { detail?: { reason?: unknown } }).detail?.reason).toBe('string');
  });

  it('409s amending token_endpoint_auth_method across the public/confidential boundary', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const clientId = `spa-${newId()}`;
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: clientId,
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    const id = created.json<{ id: string }>().id;

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { token_endpoint_auth_method: 'client_secret_basic' },
    });
    expect(res.statusCode).toBe(409);
    const detail = res.json<{ detail: string }>().detail;
    expect(detail).toContain('public');
    expect(detail).toContain('confidential');
  });

  it('refuses (no audit) a public client amended to a confidential auth method', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const createDeps = {
      hashClientSecret: (secret: string) => Promise.resolve(`hashed:${secret}`),
      tlsClientAuthEnabled: false,
      audit: () => Promise.resolve(),
    };
    const created = await withTenant(fixture.app.db, t.id, (tx) =>
      createClient(tx, createDeps, {
        clientId: `spa-${newId()}`,
        metadata: {
          redirect_uris: ['https://app.example/callback'],
          token_endpoint_auth_method: 'none',
        },
        tenantId: t.id,
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      }),
    );
    if (created.kind !== 'ok') throw new Error(`fixture setup failed: ${created.kind}`);

    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.client.id,
          values: { token_endpoint_auth_method: 'client_secret_basic' },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('auth_method_changes_type');
    expect(events).toHaveLength(0);
  });

  it('refuses (no audit) a confidential client amended to none', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(
        tx,
        {
          tlsClientAuthEnabled: false,
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.id,
          values: { token_endpoint_auth_method: 'none' },
          ifMatch: undefined,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('auth_method_changes_type');
    expect(events).toHaveLength(0);
  });

  it('allows amending token_endpoint_auth_method within the confidential type', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { token_endpoint_auth_method: 'client_secret_post' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ token_endpoint_auth_method: string }>().token_endpoint_auth_method).toBe(
      'client_secret_post',
    );
  });
});

describe('DELETE /admin/tenants/{t}/clients/{id}', () => {
  it('removes the client and its config', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/clients/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      expect(await clientRepository(tx).byId(created.id)).toBeNull();
      expect(await clientOidcConfigRepository(tx).byClientId(created.id)).toBeNull();
    });
  });

  it('answers 404 for a client that does not exist', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/clients/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('calls audit exactly once on a successful deletion', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteClient(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: created.id,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('deleted');
    expect(events).toHaveLength(1);
  });

  it('calls audit once, with a refused row, when the built-in admin guard refuses it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const admin = await fixture.builtinAdminClient(t.name);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteClient(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          clientDbId: admin.id,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('builtin_admin_guarded');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'refused' });
    expect(typeof (events[0] as { detail?: { reason?: unknown } }).detail?.reason).toBe('string');
  });
});

describe('POST /admin/tenants/{t}/clients/{id}/secret', () => {
  it('returns a new secret once, and the old one stops authenticating at /token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials'],
    });
    const before = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(before.statusCode).toBe(200);

    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients/${client.id}/secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ client_secret: string }>();
    expect(body.client_secret).not.toBe(client.secret);

    const withOldSecret = await fixture.tokenRequest(t.name, client, {
      grant_type: 'client_credentials',
    });
    expect(withOldSecret.statusCode).toBe(401);
    expect(withOldSecret.json<{ error: string }>().error).toBe('invalid_client');

    const withNewSecret = await fixture.tokenRequest(
      t.name,
      { ...client, secret: body.client_secret },
      { grant_type: 'client_credentials' },
    );
    expect(withNewSecret.statusCode).toBe(200);
  });

  it("refuses to rotate a public client's secret", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `spa-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    const { id } = created.json<{ id: string }>();

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients/${id}/secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses to rotate the secret of a client that authenticates with a key', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `keyed-${newId()}`,
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [] },
        grant_types: ['client_credentials'],
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients/${id}/secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('private_key_jwt');
  });

  it("refuses to rotate the built-in admin client's secret, which signs in with the console's key", async () => {
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-clients']);
    const name = `keyed-${newId()}`;
    const made = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });
    expect(made.statusCode).toBe(201);
    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${name}/clients?client_id=odudu-admin`,
      headers: { authorization: `Bearer ${token}` },
    });
    const admin = list
      .json<{ items: { id: string; client_id: string }[] }>()
      .items.find((client) => client.client_id === 'odudu-admin');
    expect(admin).toBeDefined();

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${name}/clients/${admin?.id ?? ''}/secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('calls audit exactly once on a successful rotation', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      rotateClientSecret(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
          now: () => new Date(),
        },
        {
          clientDbId: created.id,
          graceSeconds: 0,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('ok');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when the client is public', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `spa-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    const { id } = created.json<{ id: string }>();
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      rotateClientSecret(
        tx,
        {
          hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
          now: () => new Date(),
        },
        {
          clientDbId: id,
          graceSeconds: 0,
          callerCapabilities: new Set<string>(),
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_confidential');
    expect(events).toHaveLength(0);
  });
});

describe("the built-in admin client's guards", () => {
  it('refuses to disable it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${admin.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toMatch(/built-in/iu);
  });

  it('refuses to delete it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/clients/${admin.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toMatch(/built-in/iu);
  });

  it('refuses to PATCH the fields that would lock administrators out', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);
    for (const body of [
      { grant_types: ['refresh_token'] },
      { token_endpoint_auth_method: 'none' },
      { redirect_uris: [] },
      // `aud` naming the admin API's resource identifier is what admits a
      // token here at all, and that identifier is stored in this column:
      // clearing it locks every administrator of the tenant out while the
      // client stays enabled and its grants untouched.
      { audiences: [] },
    ]) {
      const res = await fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/clients/${admin.id}`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: body,
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
    }
  });

  it("still amends the built-in client's ordinary fields", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${admin.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'Administration' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reads builtin_admin, not the client_id, so a rename does not evade it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const admin = await fixture.builtinAdminClient(t.name);
    await fixture.renameClientIdDirectly(t.id, admin.id, `something-else-${newId()}`);
    // A system admin, not a tenant-local one: `authorizeAdmin`
    // (#/usecase/authorize-admin.ts) itself resolves a capability by
    // matching a role's client against `ADMIN_CLIENT_ID` on the
    // *principal's own issuer tenant* — the system tenant here, untouched
    // by the rename above — so this token's own authorization survives it,
    // leaving the request free to prove what the guard alone does.
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-clients']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${admin.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(409);
  });

  it('allows disabling an ordinary admin-capable client, locking that caller out', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const provisioner = await fixture.createServiceAccountClient(t.name, ['manage-users']);
    // `manage-users` too: the caller must cover what the service account holds.
    const token = await fixture.adminToken(t.name, ['manage-clients', 'manage-users']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${provisioner.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${provisioner.token}` },
    });
    expect(after.statusCode).toBe(401);
  });
});

// A private member stored before registration and the admin API refused
// one: nothing serves it back, and no amendment is refused because of it.
describe('a jwks stored with a private member', () => {
  const publicKey = { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y', kid: 'one' };

  async function legacyClient(): Promise<{ tenantName: string; id: string; secrets: string[] }> {
    const t = await fixture.createTenant(`jwks-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const privateValues = Object.fromEntries(
      PRIVATE_JWK_MEMBERS.map((member) => [member, `private-${member}-${newId()}`]),
    );
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .update(clientOidcConfig)
        .set({ jwks: { keys: [{ ...publicKey, ...privateValues }] } })
        .where(eq(clientOidcConfig.clientId, client.id)),
    );
    return { tenantName: t.name, id: client.id, secrets: Object.values(privateValues) };
  }

  it('is served without it, by the read and by the list', async () => {
    const legacy = await legacyClient();
    const headers = {
      authorization: `Bearer ${await fixture.adminToken(legacy.tenantName, ['manage-clients'])}`,
    };
    const base = `/admin/tenants/${legacy.tenantName}/clients`;

    const read = await fixture.http.inject({ method: 'GET', url: `${base}/${legacy.id}`, headers });
    const list = await fixture.http.inject({ method: 'GET', url: base, headers });

    expect(read.json<{ jwks: unknown }>().jwks).toEqual({ keys: [publicKey] });
    for (const secret of legacy.secrets) {
      expect(read.payload).not.toContain(secret);
      expect(list.payload).not.toContain(secret);
    }
  });

  it('does not refuse an amendment of another metadata field, and is stored without it', async () => {
    const legacy = await legacyClient();
    const token = await fixture.adminToken(legacy.tenantName, ['manage-clients']);
    const url = `/admin/tenants/${legacy.tenantName}/clients/${legacy.id}`;
    const read = await fixture.http.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': String(read.headers.etag),
      },
      payload: { redirect_uris: ['https://app.example/other'] },
    });

    expect(res.statusCode, res.payload).toBe(200);
    const [stored] = await fixture.owner.db
      .select({ jwks: clientOidcConfig.jwks })
      .from(clientOidcConfig)
      .where(eq(clientOidcConfig.clientId, legacy.id));
    expect(stored?.jwks).toEqual({ keys: [publicKey] });
  });
});
