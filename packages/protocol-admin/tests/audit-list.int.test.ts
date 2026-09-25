import { withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
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

function getAudit(token: string, tenantName: string, query = '') {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/audit${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function createClients(token: string, tenantName: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenantName}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: `page-${String(i)}-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
  }
}

function createClient(
  token: string,
  tenantName: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number }> {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...headers,
    },
    payload: {
      client_id: `ctx-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    },
  });
}

describe('GET /admin/tenants/{t}/audit', () => {
  it('pages by cursor over (occurred_at DESC, id DESC), newest first', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    await createClients(token, t.name, 3);

    const first = await getAudit(token, t.name, '?limit=2');
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: { id: string }[]; next?: string }>();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.next).toBeDefined();

    const second = await getAudit(
      token,
      t.name,
      `?limit=2&cursor=${encodeURIComponent(firstBody.next ?? '')}`,
    );
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ items: { id: string }[] }>();
    expect(secondBody.items).toHaveLength(1);
    const seenIds = new Set([...firstBody.items, ...secondBody.items].map((row) => row.id));
    expect(seenIds.size).toBe(3);
  });

  it('refuses a cursor minted for another collection', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    await createClients(token, t.name, 1);

    const clientsPage = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const clientsCursor = clientsPage.json<{ next?: string }>().next;
    expect(clientsCursor).toBeDefined();

    const res = await getAudit(token, t.name, `?cursor=${encodeURIComponent(clientsCursor ?? '')}`);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a hand-written cursor', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const res = await getAudit(token, t.name, '?cursor=not-a-real-cursor');

    expect(res.statusCode).toBe(400);
  });

  it('narrows on action, resource_type and outcome', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    await createClients(token, t.name, 1);
    // A refusal: metadata missing redirect_uris/grant_types.
    await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { client_id: `refused-${newId()}` },
    });

    const onlyRefused = await getAudit(token, t.name, '?outcome=refused');
    const refusedBody = onlyRefused.json<{ items: { outcome: string }[] }>();
    expect(refusedBody.items.length).toBeGreaterThan(0);
    expect(refusedBody.items.every((row) => row.outcome === 'refused')).toBe(true);

    const onlyClients = await getAudit(token, t.name, '?resource_type=client&action=client.create');
    const clientsBody = onlyClients.json<{ items: { action: string; resource_type: string }[] }>();
    expect(clientsBody.items.length).toBeGreaterThan(0);
    expect(
      clientsBody.items.every(
        (row) => row.action === 'client.create' && row.resource_type === 'client',
      ),
    ).toBe(true);
  });

  it('narrows on actor_subject_id and a time range', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    await createClients(token, t.name, 1);

    const all = await getAudit(token, t.name);
    const allBody = all.json<{
      items: { actor_subject_id: string | null; occurred_at: string }[];
    }>();
    const actorId = allBody.items[0]?.actor_subject_id;
    expect(actorId).not.toBeNull();
    if (actorId === null || actorId === undefined) {
      throw new Error('unreachable: asserted above');
    }

    const byActor = await getAudit(token, t.name, `?actor_subject_id=${actorId}`);
    const byActorBody = byActor.json<{ items: unknown[] }>();
    expect(byActorBody.items.length).toBeGreaterThan(0);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const byRange = await getAudit(token, t.name, `?from=${encodeURIComponent(future)}`);
    expect(byRange.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  // audit_events.actor_subject_id is a uuid column: anything that is not
  // one reaches Postgres and fails on syntax rather than filtering.
  it('refuses an actor_subject_id that is not an id with 400, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const res = await getAudit(token, t.name, '?actor_subject_id=abc');

    expect(res.statusCode).toBe(400);
  });

  it('shows a tenant-local admin a system admin own change to their tenant', async () => {
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const systemToken = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);
    const patch = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${u.name}/settings`,
      headers: { authorization: `Bearer ${systemToken}`, 'content-type': 'application/json' },
      payload: { display_name: 'Umbrella Corp' },
    });
    expect(patch.statusCode).toBe(200);

    const localToken = await fixture.adminToken(u.name, ['view-audit']);
    const res = await getAudit(localToken, u.name, '?action=tenant.amend_settings');

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { action: string; actor_tenant_id: string | null }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.action).toBe('tenant.amend_settings');
    // The row is visible under U's own tenant_id, but the actor is named as
    // the system tenant, not U — this is the whole reason tenant_id is kept
    // as the target rather than the actor's own.
    expect(body.items[0]?.actor_tenant_id).toBe(fixture.systemTenantId);
    expect(body.items[0]?.actor_tenant_id).not.toBe(u.id);
  });

  it('is refused for every capability but view-audit', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const nonAuditToken = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await getAudit(nonAuditToken, t.name);

    expect(res.statusCode).toBe(403);
  });

  it('records the caller’s request id and address on the row', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);

    const created = await createClient(token, t.name, { 'x-request-id': 'probe-123' });
    expect(created.statusCode).toBe(201);

    const res = await getAudit(token, t.name, '?action=client.create');
    const body = res.json<{ items: { request_id: string | null; ip: string | null }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.request_id).toBe('probe-123');
    expect(body.items[0]?.ip).toBe('127.0.0.1');
  });

  it('ignores x-forwarded-for while trust-proxy is off', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);

    const created = await createClient(token, t.name, { 'x-forwarded-for': '203.0.113.9' });
    expect(created.statusCode).toBe(201);

    const res = await getAudit(token, t.name, '?action=client.create');
    const body = res.json<{ items: { ip: string | null }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.ip).toBe('127.0.0.1');
  });

  it('truncates a request id longer than 128 characters', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    const longRequestId = 'x'.repeat(500);

    const created = await createClient(token, t.name, { 'x-request-id': longRequestId });
    expect(created.statusCode).toBe(201);

    const res = await getAudit(token, t.name, '?action=client.create');
    const body = res.json<{ items: { request_id: string | null }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.request_id).toBe(longRequestId.slice(0, 128));
  });

  it('narrows on event_type and refuses one the vocabulary does not name', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    await createClients(token, t.name, 1);
    // A row of another event type, so `?event_type=admin_mutation` narrowing
    // to only `admin_mutation` rows is not vacuously true of every row here.
    await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).record({
        eventType: 'session',
        action: 'session.created',
        outcome: 'allowed',
      }),
    );

    const mutations = await getAudit(token, t.name, '?event_type=admin_mutation');
    expect(mutations.statusCode).toBe(200);
    const mutationsBody = mutations.json<{ items: { event_type: string }[] }>();
    expect(mutationsBody.items.length).toBeGreaterThan(0);
    expect(mutationsBody.items.every((row) => row.event_type === 'admin_mutation')).toBe(true);

    const sessions = await getAudit(token, t.name, '?event_type=session');
    expect(sessions.statusCode).toBe(200);
    const sessionsBody = sessions.json<{ items: { action: string }[] }>();
    expect(sessionsBody.items).toHaveLength(1);
    expect(sessionsBody.items[0]?.action).toBe('session.created');

    const tokens = await getAudit(token, t.name, '?event_type=token');
    expect(tokens.statusCode).toBe(200);
    expect(tokens.json<{ items: unknown[] }>().items).toEqual([]);

    const bogus = await getAudit(token, t.name, '?event_type=bogus');
    expect(bogus.statusCode).toBe(400);
  });
});
