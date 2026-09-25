import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { ClientIdConflictError, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
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
    expect(read.headers.etag).toBe(etagOf(read.json()));
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
          actorSubjectId: 'test-subject',
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
          actorSubjectId: 'test-subject',
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
          actorSubjectId: 'test-subject',
        },
      ),
    );
    expect(outcome.kind).toBe('precondition_required');
    expect(events).toHaveLength(0);
  });

  it('does not call audit when the built-in admin guard refuses it', async () => {
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
          actorSubjectId: 'test-subject',
        },
      ),
    );
    expect(outcome.kind).toBe('builtin_admin_guarded');
    expect(events).toHaveLength(0);
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
          actorSubjectId: 'test-subject',
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
          actorSubjectId: 'test-subject',
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
        { clientDbId: created.id, actorSubjectId: 'test-subject' },
      ),
    );
    expect(outcome.kind).toBe('deleted');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when the built-in admin guard refuses it', async () => {
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
        { clientDbId: admin.id, actorSubjectId: 'test-subject' },
      ),
    );
    expect(outcome.kind).toBe('builtin_admin_guarded');
    expect(events).toHaveLength(0);
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
        },
        { clientDbId: created.id, actorSubjectId: 'test-subject' },
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
        },
        { clientDbId: id, actorSubjectId: 'test-subject' },
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
    const token = await fixture.adminToken(t.name, ['manage-clients']);
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
