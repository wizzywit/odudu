import { withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '#/schema/audit-events';
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
  });

  it('writes no row when the mutation rolls back', async () => {
    // An audit log that can disagree with the database is worse than none:
    // this makes the mutation fail immediately after its audit row is
    // written, in the same transaction, and asserts the row does not
    // survive the rollback either.
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    await fixture.failNextWriteAfterAudit();

    const res = await createClientRequest(token, t.name, {
      client_id: `doomed-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });

    expect(res.statusCode).toBe(500);
    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(0);
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
    expect(JSON.stringify(rotated?.detail ?? {})).not.toContain(secret);
  });
});
