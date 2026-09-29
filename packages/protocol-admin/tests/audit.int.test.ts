import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
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

function createClientRequest(token: string, tenantName: string, body: Record<string, unknown>) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body,
  });
}

describe('audit', () => {
  it('writes exactly one row for a committed mutation', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await createClientRequest(token, t.name, {
      client_id: `audited-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });

    expect(res.statusCode).toBe(201);
    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', action: 'client.create' });
    // The caller's own tenant and client, not the target's — a tenant-local
    // admin's own tenant happens to equal the target here, so this alone
    // does not prove the two are kept apart; audit-list.int.test.ts's
    // cross-tenant case does that.
    expect(rows[0]?.actorTenantId).toBe(t.id);
    expect(rows[0]?.actorClientId).not.toBeNull();
  });

  it('writes no row when the mutation rolls back', async () => {
    // An audit log that can disagree with the database is worse than none:
    // this makes the mutation fail immediately after its audit row is
    // written, in the same transaction, and asserts the row does not
    // survive the rollback either.
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    await fixture.failNextWriteAfterAudit();

    const clientId = `doomed-${newId()}`;
    const res = await createClientRequest(token, t.name, {
      client_id: clientId,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });

    expect(res.statusCode).toBe(500);
    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(0);
    // The other direction: the rollback took the mutation itself with it,
    // not only the audit row — a client that persisted here would be a
    // worse bug than a missing audit row, a mutation nobody can see.
    const persisted = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byClientId(clientId),
    );
    expect(persisted).toBeNull();
  });

  it('records a refusal as well as a success', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    // No redirect_uris or grant_types: parseClientMetadata refuses this
    // inside the usecase, after the route's own schema already accepted it
    // (client_id is all createClientRequestSchema requires).
    const res = await createClientRequest(token, t.name, {
      client_id: `nope-${newId()}`,
      name: 'N',
    });

    expect(res.statusCode).toBe(400);
    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'refused', action: 'client.create' });
  });

  it('redacts a rotated client secret out of its own audit row', async () => {
    // Assert no secret can appear: rotate a confidential client's secret
    // and check the serialised detail contains neither the returned value
    // nor anything resembling it.
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const create = await createClientRequest(token, t.name, {
      client_id: `rotates-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(create.statusCode).toBe(201);
    const clientDbId = create.json<{ id: string }>().id;

    const rotate = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients/${clientDbId}/secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rotate.statusCode).toBe(200);
    const secret = rotate.json<{ client_secret: string }>().client_secret;

    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    const rotated = rows.find((row) => row.action === 'client.rotate_secret');
    expect(rotated).toBeDefined();
    // The detail names that the hash changed without ever holding it — a
    // detail of `{}` would also pass `not.toContain`, so the row is pinned
    // to what it actually records, not merely to what it omits.
    expect(rotated?.detail).toEqual({ secret_hash: { changed: true } });
    expect(JSON.stringify(rotated?.detail ?? {})).not.toContain(secret);
  });

  it('refuses a cursor replayed under a different filter, and pages under the same one', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    for (let i = 0; i < 3; i += 1) {
      await createClientRequest(token, t.name, {
        client_id: `filtered-${String(i)}-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      });
    }

    const getAudit = (query: string) =>
      fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/audit${query}`,
        headers: { authorization: `Bearer ${token}` },
      });

    const first = await getAudit('?event_type=admin_mutation&limit=1');
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: { id: string }[]; next?: string }>();
    expect(firstBody.next).toBeDefined();
    const cursor = encodeURIComponent(firstBody.next ?? '');

    const wrongFilter = await getAudit(`?event_type=token&limit=1&cursor=${cursor}`);
    expect(wrongFilter.statusCode).toBe(400);

    const sameFilter = await getAudit(`?event_type=admin_mutation&limit=1&cursor=${cursor}`);
    expect(sameFilter.statusCode).toBe(200);
    const sameFilterBody = sameFilter.json<{ items: { id: string }[] }>();
    expect(sameFilterBody.items).toHaveLength(1);
    expect(sameFilterBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
  });

  it('narrows to one resource by resource_type and resource_id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);

    const first = await createClientRequest(token, t.name, {
      client_id: `resource-a-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json<{ id: string }>().id;

    const second = await createClientRequest(token, t.name, {
      client_id: `resource-b-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(second.statusCode).toBe(201);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?resource_type=client&resource_id=${firstId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { resource_id: string | null }[] }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((row) => row.resource_id === firstId)).toBe(true);
  });

  it('refuses resource_id without resource_type, naming both', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?resource_id=${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toBe('resource_id requires resource_type');
  });

  it('refuses an action longer than the free-text filter bound', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);
    const tooLong = 'a'.repeat(257);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?action=${tooLong}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('refuses a cursor replayed with resource_id added to the filter set', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    for (let i = 0; i < 2; i += 1) {
      await createClientRequest(token, t.name, {
        client_id: `resource-cursor-${String(i)}-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      });
    }

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?resource_type=client&limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: { resource_id: string | null }[]; next?: string }>();
    expect(firstBody.next).toBeDefined();
    const resourceId = firstBody.items[0]?.resource_id;
    if (resourceId === null || resourceId === undefined) {
      throw new Error('unreachable: every row here is a client.create with a resource_id');
    }
    const cursor = encodeURIComponent(firstBody.next ?? '');

    const withResourceIdAdded = await fixture.http.inject({
      method: 'GET',
      url:
        `/admin/tenants/${t.name}/audit?resource_type=client&resource_id=${resourceId}` +
        `&limit=1&cursor=${cursor}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(withResourceIdAdded.statusCode).toBe(400);
  });
});
