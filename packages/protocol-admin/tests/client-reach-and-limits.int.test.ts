import { CLIENT_LIST_LIMIT, listLimitMessage, listLimitProblem } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
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

interface Wire {
  readonly id: string;
  readonly client_id: string;
  readonly service_subject_id: string | null;
  readonly service_account_admin_reach: readonly string[];
  readonly redirect_uris: readonly string[];
  readonly web_origins: readonly string[];
}

const many = (count: number, make: (i: number) => string): string[] =>
  Array.from({ length: count }, (_, i) => make(i));

function call(
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { payload?: unknown; ifMatch?: string } = {},
) {
  return fixture.http.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
    },
    ...(options.payload === undefined ? {} : { payload: JSON.stringify(options.payload) }),
  });
}

async function read(token: string, tenant: string, id: string) {
  const res = await call(token, 'GET', `/admin/tenants/${tenant}/clients/${id}`);
  expect(res.statusCode, res.payload).toBe(200);
  return { client: res.json<Wire>(), etag: String(res.headers.etag) };
}

async function holdOnServiceAccount(
  tenant: { id: string },
  serviceSubjectId: string,
  roleName: string,
): Promise<void> {
  await withTenant(fixture.app.db, tenant.id, async (tx) => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (admin === null) throw new Error('fixture: no built-in admin client');
    const role = await roleRepository(tx).byName(roleName, admin.id);
    if (role === null) throw new Error(`fixture: no role ${roleName}`);
    await roleRepository(tx).assignToSubject(serviceSubjectId, role.id);
  });
}

describe("a client's service account reach", () => {
  it('is carried by a read, a list and a lookup, and by no client that has no service account', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const holding = await fixture.createServiceAccountClient(t.name, ['view-users']);
    const plain = await fixture.createServiceAccountClient(t.name, []);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const publicClient = await call(token, 'POST', `/admin/tenants/${t.name}/clients`, {
      payload: {
        client_id: 'public-one',
        token_endpoint_auth_method: 'none',
        redirect_uris: ['https://public.example/cb'],
      },
    });
    expect(publicClient.statusCode, publicClient.payload).toBe(201);

    expect((await read(token, t.name, holding.id)).client.service_account_admin_reach).toEqual([
      'view-users',
    ]);
    expect((await read(token, t.name, plain.id)).client.service_account_admin_reach).toEqual([]);
    const created = publicClient.json<Wire>();
    expect(created.service_subject_id).toBeNull();
    expect(created.service_account_admin_reach).toEqual([]);

    const listed = await call(token, 'GET', `/admin/tenants/${t.name}/clients`);
    const byClient = new Map(
      listed.json<{ items: Wire[] }>().items.map((item) => [item.client_id, item]),
    );
    expect(byClient.get(holding.clientId)?.service_account_admin_reach).toEqual(['view-users']);
    expect(byClient.get(plain.clientId)?.service_account_admin_reach).toEqual([]);
  });

  it('counts what a role nests, and stays out of the ETag, which is the stored fields alone', async () => {
    const t = await fixture.createTenant(`reach-etag-${newId()}`);
    const client = await fixture.createServiceAccountClient(t.name, []);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const before = await read(token, t.name, client.id);
    expect(before.client.service_account_admin_reach).toEqual([]);

    await holdOnServiceAccount(t, before.client.service_subject_id ?? '', 'manage-users');

    const after = await read(token, t.name, client.id);
    // manage-users nests view-users.
    expect(after.client.service_account_admin_reach).toEqual(['view-users', 'manage-users']);
    expect(after.etag).toBe(before.etag);
    const amended = await call(token, 'PATCH', `/admin/tenants/${t.name}/clients/${client.id}`, {
      payload: { description: 'noted' },
      ifMatch: before.etag,
    });
    expect(amended.statusCode, amended.payload).toBe(403);
    expect(amended.json<{ detail: string }>().detail).toContain('manage-users');
  });
});

describe('GET /clients?client_id_exact=', () => {
  it('finds one client by its exact id, and not by a prefix, a case variant or another tenant', async () => {
    const t = await fixture.createTenant(`exact-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    for (const clientId of ['billing', 'billing-two', 'Billing']) {
      const res = await call(token, 'POST', `/admin/tenants/${t.name}/clients`, {
        payload: {
          client_id: clientId,
          token_endpoint_auth_method: 'none',
          redirect_uris: ['https://b.example/cb'],
        },
      });
      expect(res.statusCode, res.payload).toBe(201);
    }
    const ids = async (query: string) =>
      (await call(token, 'GET', `/admin/tenants/${t.name}/clients?${query}`))
        .json<{ items: Wire[] }>()
        .items.map((item) => item.client_id);
    expect(await ids('client_id_exact=billing')).toEqual(['billing']);
    expect(await ids('client_id_exact=Billing')).toEqual(['Billing']);
    expect(await ids('client_id_exact=bill')).toEqual([]);
    const both = await call(
      token,
      'GET',
      `/admin/tenants/${t.name}/clients?client_id_exact=billing&name=bill`,
    );
    expect(both.statusCode).toBe(400);
  });
});

async function overLimitClient(): Promise<{
  tenant: { id: string; name: string };
  token: string;
  id: string;
}> {
  const tenant = await fixture.createTenant(`over-${newId()}`);
  const client = await fixture.createConfidentialClient(tenant.name, {
    grantTypes: ['authorization_code'],
    redirectUris: ['https://app.example/callback'],
  });
  // Registered before the bound existed: written past the API.
  await fixture.owner.db.execute(sql`
    UPDATE client_oidc_config
    SET redirect_uris = (SELECT array_agg('https://app.example/cb/' || g) FROM generate_series(0, ${CLIENT_LIST_LIMIT}) g),
        web_origins = (SELECT array_agg('https://o' || g || '.example') FROM generate_series(0, ${CLIENT_LIST_LIMIT}) g)
    WHERE client_id = ${client.id}::uuid
  `);
  const token = await fixture.adminToken(tenant.name, ['manage-clients', 'manage-tenant']);
  return { tenant, token, id: client.id };
}

describe('a client stored over the limit', () => {
  it('still has a field it does not list amended', async () => {
    const { tenant, token, id } = await overLimitClient();
    const { etag } = await read(token, tenant.name, id);
    const res = await call(token, 'PATCH', `/admin/tenants/${tenant.name}/clients/${id}`, {
      payload: { client_uri: 'https://app.example/about', description: 'still editable' },
      ifMatch: etag,
    });
    expect(res.statusCode, res.payload).toBe(200);
  });

  it('is brought under the limit by a write that changes the list, and refused by one that does not', async () => {
    const { tenant, token, id } = await overLimitClient();
    const { etag } = await read(token, tenant.name, id);
    const url = `/admin/tenants/${tenant.name}/clients/${id}`;
    const still = await call(token, 'PATCH', url, {
      payload: {
        redirect_uris: many(CLIENT_LIST_LIMIT + 1, (i) => `https://x.example/${String(i)}`),
      },
      ifMatch: etag,
    });
    expect(still.statusCode).toBe(400);
    expect(still.json<{ errors: unknown[] }>().errors).toEqual([
      { path: 'redirect_uris', message: listLimitProblem('redirect_uris', CLIENT_LIST_LIMIT + 1) },
    ]);
    const trimmed = await call(token, 'PATCH', url, {
      payload: { redirect_uris: ['https://app.example/callback'], web_origins: [] },
      ifMatch: etag,
    });
    expect(trimmed.statusCode, trimmed.payload).toBe(200);
  });

  it('is exported as it is stored, and refused on re-import, naming the field, count and limit', async () => {
    const { tenant, id } = await overLimitClient();
    const operator = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exported = await call(operator, 'GET', `/admin/tenants/${tenant.name}/export`);
    expect(exported.statusCode, exported.payload).toBe(200);
    const document = exported.json<{ clients: { client_id: string; redirect_uris: string[] }[] }>();
    const stored = document.clients.find((entry) => entry.redirect_uris.length > 1);
    expect(stored?.redirect_uris).toHaveLength(CLIENT_LIST_LIMIT + 1);
    expect(id).toBeTruthy();

    const refused = await call(operator, 'POST', '/admin/tenant-imports', {
      payload: { name: `reimport-${newId()}`, document },
    });
    expect(refused.statusCode).toBe(400);
    const index = document.clients.findIndex((entry) => entry.redirect_uris.length > 1);
    expect(refused.json<{ errors: { path: string; message: string }[] }>().errors).toContainEqual({
      path: `document.clients[${String(index)}].redirect_uris`,
      message: listLimitMessage(CLIENT_LIST_LIMIT + 1),
    });
  });
});

describe('a create over the limit', () => {
  it.each(['redirect_uris', 'web_origins', 'post_logout_redirect_uris'])(
    'is refused on %s, naming the field, and makes no client',
    async (field) => {
      const t = await fixture.createTenant(`create-over-${newId()}`);
      const token = await fixture.adminToken(t.name, ['manage-clients']);
      const entries = many(CLIENT_LIST_LIMIT + 1, (i) => `https://o${String(i)}.example`);
      const res = await call(token, 'POST', `/admin/tenants/${t.name}/clients`, {
        payload: {
          client_id: 'too-many',
          token_endpoint_auth_method: 'none',
          redirect_uris: field === 'redirect_uris' ? entries : ['https://a.example/cb'],
          ...(field === 'redirect_uris' ? {} : { [field]: entries }),
        },
      });
      expect(res.statusCode, res.payload).toBe(400);
      const [error] = res.json<{ errors: { path: string; message: string }[] }>().errors;
      expect(error?.path).toBe(field);
      expect(error?.message).toContain(listLimitMessage(CLIENT_LIST_LIMIT + 1));
      const listed = await call(
        token,
        'GET',
        `/admin/tenants/${t.name}/clients?client_id_exact=too-many`,
      );
      expect(listed.json<{ items: unknown[] }>().items).toEqual([]);
    },
  );
});

describe('the sentence a refusal is made of', () => {
  it('names the field once on PATCH, in the path and the message', async () => {
    const t = await fixture.createTenant(`sentence-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const { etag } = await read(token, t.name, client.id);
    const res = await call(token, 'PATCH', `/admin/tenants/${t.name}/clients/${client.id}`, {
      payload: { web_origins: many(CLIENT_LIST_LIMIT + 1, (i) => `https://o${String(i)}.example`) },
      ifMatch: etag,
    });
    expect(res.json<{ detail: string }>().detail).toBe(
      `web_origins: ${listLimitMessage(CLIENT_LIST_LIMIT + 1)}`,
    );
  });
});
