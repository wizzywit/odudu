import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
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

const CODE = 'allowed_actions_need_me_read';

interface Refusal {
  readonly detail?: string;
  readonly errors?: readonly { path: string; message: string; code?: string }[];
}

async function setup() {
  const t = await fixture.createTenant(`aa-${newId()}`);
  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients', 'view-audit']);
  const client = await fixture.createConfidentialClient(t.name, {});
  const scopeId = new Map<string, string>();
  for (const name of ['me:read', 'me:write']) {
    const [row] = await fixture.owner.sql<{ id: string }[]>`
      select id from client_scopes where tenant_id = ${t.id} and name = ${name}`;
    scopeId.set(name, row?.id ?? '');
  }
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const read = (id = client.id) =>
    fixture.http.inject({
      url: `/admin/tenants/${t.name}/clients/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const patch = async (body: Record<string, unknown>, id = client.id) => {
    const etag = (await read(id)).headers.etag;
    return fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${id}`,
      headers: { ...headers, ...(typeof etag === 'string' ? { 'if-match': etag } : {}) },
      payload: JSON.stringify(body),
    });
  };
  const scopeUrl = (scope: string, id = client.id) =>
    `/admin/tenants/${t.name}/scopes/${scopeId.get(scope) ?? ''}/clients/${id}`;
  const assign = (scope: string, id = client.id) =>
    fixture.http.inject({
      method: 'PUT',
      url: scopeUrl(scope, id),
      headers,
      payload: { assignment: 'optional' },
    });
  const unassign = (scope: string) =>
    fixture.http.inject({
      method: 'DELETE',
      url: scopeUrl(scope),
      headers: { authorization: `Bearer ${token}` },
    });
  const create = (body: Record<string, unknown>) =>
    fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers,
      payload: JSON.stringify(body),
    });
  return { t, token, client, scopeId, headers, read, patch, assign, unassign, create };
}

function codes(res: LightMyRequestResponse): (string | undefined)[] {
  return (res.json<Refusal>().errors ?? []).map((error) => error.code);
}

describe('allowed_actions on a client', () => {
  it('is empty on a client that never set it', async () => {
    const s = await setup();
    expect((await s.read()).json()).toMatchObject({ allowed_actions: [] });
  });

  it('refuses an entry that is not a required action, naming the field and the entry', async () => {
    const s = await setup();
    await s.assign('me:read');
    const res = await s.patch({ allowed_actions: ['update-password', 'delete-account'] });
    expect(res.statusCode, res.body).toBe(400);
    const errors = res.json<Refusal>().errors ?? [];
    expect(errors.map((error) => error.path)).toEqual(['allowed_actions']);
    expect(errors[0]?.message).toContain('delete-account');
    expect((await s.read()).json()).toMatchObject({ allowed_actions: [] });
  });

  it('may start the address check and the profile, and never the tenant’s terms', async () => {
    const s = await setup();
    await s.assign('me:read');
    const started = await s.patch({ allowed_actions: ['verify-email', 'update-profile'] });
    expect(started.statusCode, started.body).toBe(200);
    expect((await s.read()).json()).toMatchObject({
      allowed_actions: ['verify-email', 'update-profile'],
    });

    const terms = await s.patch({ allowed_actions: ['verify-email', 'accept-terms'] });
    expect(terms.statusCode, terms.body).toBe(400);
    const errors = terms.json<Refusal>().errors ?? [];
    expect(errors.map((error) => error.path)).toEqual(['allowed_actions']);
    expect(errors[0]?.message).toContain('accept-terms');
    expect((await s.read()).json()).toMatchObject({
      allowed_actions: ['verify-email', 'update-profile'],
    });
  });

  it('refuses a value that is not a list of strings', async () => {
    const s = await setup();
    for (const value of ['update-password', [1], null]) {
      const res = await s.patch({ allowed_actions: value });
      expect(res.statusCode, JSON.stringify(value)).toBe(400);
    }
  });

  it('refuses an action when the client does not hold me:read, with a stable code', async () => {
    const s = await setup();
    const res = await s.patch({ allowed_actions: ['update-password'] });
    expect(res.statusCode, res.body).toBe(400);
    expect(codes(res)).toEqual([CODE]);
    expect((await s.read()).json()).toMatchObject({ allowed_actions: [] });
  });

  it('is stored, read back and listed in the audit detail once me:read is held', async () => {
    const s = await setup();
    expect((await s.assign('me:read')).statusCode).toBe(200);
    const res = await s.patch({
      allowed_actions: ['configure-totp', 'update-password', 'configure-totp'],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ allowed_actions: string[] }>().allowed_actions).toEqual([
      'configure-totp',
      'update-password',
    ]);
    expect((await s.read()).json()).toMatchObject({
      allowed_actions: ['configure-totp', 'update-password'],
    });

    const audit = await fixture.http.inject({
      url: `/admin/tenants/${s.t.name}/audit?resource_type=client&resource_id=${s.client.id}&action=client.amend`,
      headers: { authorization: `Bearer ${s.token}` },
    });
    const changes = audit
      .json<{ items: { detail: { allowed_actions?: { before: unknown; after: unknown } } }[] }>()
      .items.flatMap((row) =>
        row.detail.allowed_actions === undefined ? [] : [row.detail.allowed_actions],
      );
    expect(changes).toEqual([{ before: [], after: ['configure-totp', 'update-password'] }]);
  });

  it('is replaced whole and needs If-Match, like every list on a client', async () => {
    const s = await setup();
    await s.assign('me:read');
    const bare = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${s.t.name}/clients/${s.client.id}`,
      headers: s.headers,
      payload: JSON.stringify({ allowed_actions: ['update-password'] }),
    });
    expect(bare.statusCode).toBe(428);

    await s.patch({ allowed_actions: ['update-password', 'configure-totp'] });
    const narrowed = await s.patch({ allowed_actions: ['configure-passkey'] });
    expect(narrowed.json()).toMatchObject({ allowed_actions: ['configure-passkey'] });
    const cleared = await s.patch({ allowed_actions: [] });
    expect(cleared.json()).toMatchObject({ allowed_actions: [] });
  });

  it('lets an empty list be set on a client without me:read', async () => {
    const s = await setup();
    expect((await s.patch({ allowed_actions: [] })).statusCode).toBe(200);
  });

  it('keeps me:read from being removed while an action is allowed, with the same code', async () => {
    const s = await setup();
    await s.assign('me:read');
    await s.patch({ allowed_actions: ['update-password'] });
    const refused = await s.unassign('me:read');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(codes(refused)).toEqual([CODE]);
    expect(refused.json<Refusal>().detail).toContain('clear');
    expect((await s.patch({ allowed_actions: [] })).statusCode).toBe(200);
    expect((await s.unassign('me:read')).statusCode).toBe(204);
  });

  it('is refused on create without me:read, and accepted where me:read is assigned to every new client', async () => {
    const s = await setup();
    const body = {
      client_id: `spa-${newId()}`,
      token_endpoint_auth_method: 'none',
      redirect_uris: ['https://spa.example/callback'],
      allowed_actions: ['update-password'],
    };
    const refused = await s.create(body);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(codes(refused)).toEqual([CODE]);

    const marked = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${s.t.name}/scopes/${s.scopeId.get('me:read') ?? ''}`,
      headers: s.headers,
      payload: JSON.stringify({ default_client_assignment: 'optional' }),
    });
    expect(marked.statusCode, marked.body).toBe(200);
    const created = await s.create(body);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ allowed_actions: ['update-password'] });
  });

  it('is not reachable on another tenant’s client through this tenant’s route', async () => {
    const mine = await setup();
    const theirs = await setup();
    await theirs.assign('me:read');
    const res = await mine.patch({ allowed_actions: ['update-password'] }, theirs.client.id);
    expect(res.statusCode).toBe(404);
    expect((await theirs.read()).json()).toMatchObject({ allowed_actions: [] });
  });
});

describe('allowed_actions in a tenant document', () => {
  async function exportOf(token: string, name: string): Promise<TenantDocument> {
    const res = await fixture.http.inject({
      url: `/admin/tenants/${name}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.payload).toBe(200);
    return tenantDocumentSchema.parse(JSON.parse(res.payload));
  }

  async function postImport(name: string, document: unknown): Promise<LightMyRequestResponse> {
    const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    return fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name, document }),
    });
  }

  async function sourceWithActions() {
    const s = await setup();
    await s.assign('me:read');
    const made = await s.create({
      client_id: 'portal',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['https://portal.example/callback'],
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json<{ id: string }>().id;
    await s.assign('me:read', id);
    const set = await s.patch(
      { allowed_actions: ['generate-recovery-codes', 'update-password'] },
      id,
    );
    expect(set.statusCode, set.body).toBe(200);
    return s;
  }

  it('is exported with the client and imported again unchanged', async () => {
    const s = await sourceWithActions();
    const original = await exportOf(s.token, s.t.name);
    expect(
      original.clients.find((client) => client.client_id === 'portal')?.allowed_actions,
    ).toEqual(['generate-recovery-codes', 'update-password']);

    const name = `aa-copy-${newId()}`;
    const imported = await postImport(name, { ...original, omitted: [] });
    expect(imported.statusCode, imported.payload).toBe(201);
    const operator = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const copy = await exportOf(operator, name);
    expect(copy.clients.find((client) => client.client_id === 'portal')?.allowed_actions).toEqual([
      'generate-recovery-codes',
      'update-password',
    ]);
  });

  it('is refused with its code when the document leaves me:read off the client', async () => {
    const s = await sourceWithActions();
    const original = await exportOf(s.token, s.t.name);
    const without: TenantDocument = {
      ...original,
      omitted: [],
      scopes: original.scopes.map((scope) =>
        scope.name === 'me:read'
          ? { ...scope, clients: scope.clients.filter((entry) => entry.client_id !== 'portal') }
          : scope,
      ),
    };
    const name = `aa-bad-${newId()}`;
    const res = await postImport(name, without);
    expect(res.statusCode, res.payload).toBe(400);
    const errors = res.json<Refusal>().errors ?? [];
    const index = without.clients.findIndex((client) => client.client_id === 'portal');
    expect(errors).toEqual([
      expect.objectContaining({
        path: `document.clients[${String(index)}].allowed_actions`,
        code: CODE,
      }),
    ]);
  });

  it('is refused when an entry is not a required action', async () => {
    const s = await sourceWithActions();
    const original = await exportOf(s.token, s.t.name);
    const res = await postImport(`aa-unk-${newId()}`, {
      ...original,
      omitted: [],
      clients: original.clients.map((client) =>
        client.client_id === 'portal' ? { ...client, allowed_actions: ['delete-account'] } : client,
      ),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json<Refusal>().errors ?? []).map((error) => error.path)[0]).toContain(
      'allowed_actions',
    );
  });

  it('is absent from an older document, which imports with none', async () => {
    const s = await sourceWithActions();
    const original = await exportOf(s.token, s.t.name);
    const older = {
      ...original,
      omitted: [],
      clients: original.clients.map((client) =>
        Object.fromEntries(Object.entries(client).filter(([key]) => key !== 'allowed_actions')),
      ),
    };
    const name = `aa-old-${newId()}`;
    const res = await postImport(name, older);
    expect(res.statusCode, res.payload).toBe(201);
    const operator = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const copy = await exportOf(operator, name);
    expect(copy.clients.every((client) => client.allowed_actions.length === 0)).toBe(true);
  });
});

describe('deleting the me:read scope', () => {
  const ME_WRITE_MESSAGE = 'the scope me:write is held only together with me:read';

  async function remove(s: Awaited<ReturnType<typeof setup>>) {
    return fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${s.t.name}/scopes/${s.scopeId.get('me:read') ?? ''}?confirm=me:read`,
      headers: { authorization: `Bearer ${s.token}` },
    });
  }

  it('is refused while a client holding it may start an action, and goes once that is cleared', async () => {
    const s = await setup();
    await s.assign('me:read');
    await s.patch({ allowed_actions: ['update-password'] });
    const refused = await remove(s);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(codes(refused)).toEqual([CODE]);
    expect(refused.json<Refusal>().detail).toContain('clear');
    expect((await s.read()).json()).toMatchObject({ allowed_actions: ['update-password'] });
    await s.patch({ allowed_actions: [] });
    expect((await remove(s)).statusCode).toBe(204);
  });

  it('is refused while a client holding it also holds me:write, and goes once that is removed', async () => {
    const s = await setup();
    await s.assign('me:read');
    await s.assign('me:write');
    const refused = await remove(s);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<Refusal>().detail).toBe(ME_WRITE_MESSAGE);
    await s.unassign('me:write');
    expect((await remove(s)).statusCode).toBe(204);
  });

  it('is not held up by another tenant’s clients', async () => {
    const mine = await setup();
    const theirs = await setup();
    await theirs.assign('me:read');
    await theirs.patch({ allowed_actions: ['update-password'] });
    expect((await remove(mine)).statusCode).toBe(204);
    const kept = (await theirs.read()).json<{
      allowed_actions: string[];
      scopes: { name: string }[];
    }>();
    expect(kept.allowed_actions).toEqual(['update-password']);
    expect(kept.scopes.map((scope) => scope.name)).toContain('me:read');
  });
});
