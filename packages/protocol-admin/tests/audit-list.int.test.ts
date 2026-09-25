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
    const body = res.json<{ items: { action: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.action).toBe('tenant.amend_settings');
  });

  it('is refused for every capability but view-audit', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const nonAuditToken = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await getAudit(nonAuditToken, t.name);

    expect(res.statusCode).toBe(403);
  });
});
