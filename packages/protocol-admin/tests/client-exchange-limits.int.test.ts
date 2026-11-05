import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { and, eq } from 'drizzle-orm';
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

const FIELDS = ['token_exchange_allowed_for_public', 'token_exchange_actor_from_other_client'];

function request(
  tenant: string,
  token: string,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function newClient(tenant: string, token: string): Promise<string> {
  const res = await request(tenant, token, 'POST', '/clients', {
    client_id: `ex-${newId()}`,
    redirect_uris: ['https://app.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  expect(res.statusCode, res.payload).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('the per-client token exchange limits', () => {
  it('are off on a new client, in the response and on a later read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const id = await newClient(t.name, token);
    const read = await request(t.name, token, 'GET', `/clients/${id}`);
    expect(read.json()).toMatchObject({
      token_exchange_allowed_for_public: false,
      token_exchange_actor_from_other_client: false,
    });
  });

  it('round-trip through PATCH under If-Match, and the ETag follows them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const id = await newClient(t.name, token);
    const before = await request(t.name, token, 'GET', `/clients/${id}`);
    const etag = String(before.headers.etag);

    const patched = await request(
      t.name,
      token,
      'PATCH',
      `/clients/${id}`,
      { token_exchange_allowed_for_public: true, token_exchange_actor_from_other_client: true },
      { 'if-match': etag },
    );
    expect(patched.statusCode, patched.payload).toBe(200);
    expect(patched.headers.etag).not.toBe(etag);
    expect(patched.json()).toMatchObject({
      token_exchange_allowed_for_public: true,
      token_exchange_actor_from_other_client: true,
    });
    const after = await request(t.name, token, 'GET', `/clients/${id}`);
    expect(after.headers.etag).toBe(patched.headers.etag);
    expect(after.json()).toMatchObject({
      token_exchange_allowed_for_public: true,
      token_exchange_actor_from_other_client: true,
    });

    const stale = await request(
      t.name,
      token,
      'PATCH',
      `/clients/${id}`,
      { token_exchange_allowed_for_public: false },
      { 'if-match': etag },
    );
    expect(stale.statusCode).toBe(412);
  });

  it.each(FIELDS)('400 a %s that is not a boolean, naming the field', async (field) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const id = await newClient(t.name, token);
    const res = await request(t.name, token, 'PATCH', `/clients/${id}`, { [field]: 'yes' });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain(field);
  });

  it('are named, with their values, in the audit row of the amendment', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const id = await newClient(t.name, token);
    await request(t.name, token, 'PATCH', `/clients/${id}`, {
      token_exchange_allowed_for_public: true,
      token_exchange_actor_from_other_client: true,
      token_exchange_impersonation_allowed: true,
    });
    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'client.amend'), eq(auditEvents.resourceId, id))),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.detail)).toContain('token_exchange_allowed_for_public');
    expect(JSON.stringify(rows[0]?.detail)).toContain('token_exchange_actor_from_other_client');
    expect(JSON.stringify(rows[0]?.detail)).toContain('token_exchange_impersonation_allowed');
  });

  it('cannot be turned on on the built-in admin client, whose posture every administrator relies on', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const admin = await fixture.builtinAdminClient(t.name);
    for (const field of FIELDS) {
      const res = await request(t.name, token, 'PATCH', `/clients/${admin.id}`, { [field]: true });
      expect(res.statusCode, field).toBe(409);
    }
  });

  it('cannot be changed by an agent holding mcp:write, whatever its owner may do', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const owner = await fixture.adminToken(t.name, ['manage-clients']);
    const id = await newClient(t.name, owner);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, ['manage-clients'], {
      scope: ['mcp:read', 'mcp:write'],
    });
    for (const field of FIELDS) {
      const res = await request(t.name, token, 'PATCH', `/clients/${id}`, { [field]: true });
      expect(res.statusCode, field).toBe(403);
    }
    const read = await request(t.name, owner, 'GET', `/clients/${id}`);
    expect(read.json()).toMatchObject({
      token_exchange_allowed_for_public: false,
      token_exchange_actor_from_other_client: false,
    });
  });

  it("are not reachable through another tenant's client id", async () => {
    const mine = await fixture.createTenant(`acme-${newId()}`);
    const theirs = await fixture.createTenant(`other-${newId()}`);
    const mineToken = await fixture.adminToken(mine.name, ['manage-clients']);
    const theirToken = await fixture.adminToken(theirs.name, ['manage-clients']);
    const theirClient = await newClient(theirs.name, theirToken);
    const res = await request(mine.name, mineToken, 'PATCH', `/clients/${theirClient}`, {
      token_exchange_allowed_for_public: true,
    });
    expect(res.statusCode).toBe(404);
  });
});
