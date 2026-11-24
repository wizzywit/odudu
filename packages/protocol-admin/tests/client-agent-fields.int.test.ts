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

function request(
  tenant: string,
  token: string,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  payload?: Record<string, unknown>,
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function newClient(
  tenant: string,
  token: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; clientId: string; status: number; body: string }> {
  const clientId = `ag-${newId()}`;
  const res = await request(tenant, token, 'POST', '/clients', {
    client_id: clientId,
    redirect_uris: ['https://app.example/callback'],
    token_endpoint_auth_method: 'none',
    ...extra,
  });
  return {
    id: res.statusCode === 201 ? res.json<{ id: string }>().id : '',
    clientId,
    status: res.statusCode,
    body: res.payload,
  };
}

describe('the agent fields of a client', () => {
  it('are off and empty on a new client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await newClient(t.name, token);
    const read = await request(t.name, token, 'GET', `/clients/${created.id}`);
    expect(read.json()).toMatchObject({ agent_type: false, delegated_actors: [] });
  });

  it('are set on create and returned', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const peer = await newClient(t.name, token);
    const created = await newClient(t.name, token, {
      agent_type: true,
      delegated_actors: [peer.clientId],
    });
    expect(created.status, created.body).toBe(201);
    const read = await request(t.name, token, 'GET', `/clients/${created.id}`);
    expect(read.json()).toMatchObject({ agent_type: true, delegated_actors: [peer.clientId] });
  });

  it('round-trip through PATCH, and the audit row names them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const peer = await newClient(t.name, token);
    const created = await newClient(t.name, token);

    const patched = await request(t.name, token, 'PATCH', `/clients/${created.id}`, {
      agent_type: true,
      delegated_actors: [peer.clientId],
    });
    expect(patched.statusCode, patched.payload).toBe(200);
    expect(patched.json()).toMatchObject({ agent_type: true, delegated_actors: [peer.clientId] });

    const cleared = await request(t.name, token, 'PATCH', `/clients/${created.id}`, {
      delegated_actors: [],
    });
    expect(cleared.json()).toMatchObject({ agent_type: true, delegated_actors: [] });

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'client.amend'), eq(auditEvents.resourceId, created.id))),
    );
    expect(rows.map((row) => row.detail)).toContainEqual({
      agent_type: { before: false, after: true },
      delegated_actors: { before: [], after: [peer.clientId] },
    });
  });

  it('400 an agent_type that is not a boolean, naming the field', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await newClient(t.name, token);
    const res = await request(t.name, token, 'PATCH', `/clients/${created.id}`, {
      agent_type: 'yes',
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('agent_type');
  });

  it('400 a delegated actor that is no client of the tenant, creating nothing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await newClient(t.name, token);
    const res = await request(t.name, token, 'PATCH', `/clients/${created.id}`, {
      delegated_actors: ['no-such-client'],
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('delegated_actors');
    expect(res.payload).toContain('no-such-client');
    const list = await request(t.name, token, 'GET', '/clients');
    expect(list.payload).not.toContain('no-such-client');

    const onCreate = await newClient(t.name, token, { delegated_actors: ['no-such-client'] });
    expect(onCreate.status).toBe(400);
    expect(onCreate.body).toContain('no-such-client');
  });

  it('refuses a client id of another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const otherToken = await fixture.adminToken(other.name, ['manage-clients']);
    const foreign = await newClient(other.name, otherToken);
    const created = await newClient(t.name, token);
    const res = await request(t.name, token, 'PATCH', `/clients/${created.id}`, {
      delegated_actors: [foreign.clientId],
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain(foreign.clientId);
  });

  it('refuses a duplicate, an over-long list and a non-string entry', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const peer = await newClient(t.name, token);
    const created = await newClient(t.name, token);
    const patch = (delegated_actors: unknown) =>
      request(t.name, token, 'PATCH', `/clients/${created.id}`, { delegated_actors });

    expect((await patch([peer.clientId, peer.clientId])).statusCode).toBe(400);
    expect((await patch(Array.from({ length: 21 }, (_, i) => `c${String(i)}`))).statusCode).toBe(
      400,
    );
    expect((await patch([7])).statusCode).toBe(400);
    expect((await patch('abc')).statusCode).toBe(400);
  });

  it('refuses the built-in admin client, a metadata-document client and the client itself', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const created = await newClient(t.name, token);
    const metadataClient = `https://cimd-${newId()}.example/client.json`;
    await fixture.owner.sql`
      insert into clients (id, tenant_id, client_id, name, type, registration_origin, metadata_used_at)
      values (${newId()}, ${t.id}, ${metadataClient}, 'cimd', 'public', 'cimd', now())`;
    const admin = await fixture.builtinAdminClient(t.name);
    const patch = (actor: string) =>
      request(t.name, token, 'PATCH', `/clients/${created.id}`, { delegated_actors: [actor] });

    for (const actor of [admin.clientId, metadataClient, created.clientId]) {
      const res = await patch(actor);
      expect(res.statusCode, actor).toBe(400);
      expect(res.payload).toContain('delegated_actors');
      expect(res.payload).toContain(actor);
    }
    const onCreate = await newClient(t.name, token, { delegated_actors: [admin.clientId] });
    expect(onCreate.status).toBe(400);
  });
});
