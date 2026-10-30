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

const JSON_HEADERS = { 'content-type': 'application/json' };

describe('skip_logout_confirmation on the admin API', () => {
  it('is off for a new client, and a create may turn it on', async () => {
    const t = await fixture.createTenant(`skip-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const create = (extra: Record<string, unknown>) =>
      fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/clients`,
        headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS },
        payload: {
          client_id: `c-${newId()}`,
          redirect_uris: ['https://app.example/cb'],
          token_endpoint_auth_method: 'none',
          ...extra,
        },
      });

    const plain = await create({});
    const on = await create({ skip_logout_confirmation: true });

    expect(plain.json<{ skip_logout_confirmation: boolean }>().skip_logout_confirmation).toBe(
      false,
    );
    expect(on.json<{ skip_logout_confirmation: boolean }>().skip_logout_confirmation).toBe(true);
    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    const creates = rows.filter((row) => row.action === 'client.create');
    expect(creates).toHaveLength(2);
    const onRow = creates.find((row) => row.resourceId === on.json<{ id: string }>().id);
    expect(onRow?.outcome).toBe('allowed');
    expect(onRow?.detail).toMatchObject({ skip_logout_confirmation: { after: true } });
    const plainRow = creates.find((row) => row.resourceId === plain.json<{ id: string }>().id);
    expect(plainRow?.detail).toMatchObject({ skip_logout_confirmation: { after: false } });
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${on.json<{ id: string }>().id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<{ skip_logout_confirmation: boolean }>().skip_logout_confirmation).toBe(true);
  });

  it('refuses a value that is not a boolean, naming the field', async () => {
    const t = await fixture.createTenant(`skip-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.patchClient(t.name, created.id, { skip_logout_confirmation: 'yes' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('skip_logout_confirmation');
  });

  it('PATCH requires manage-clients, needs If-Match and is audited', async () => {
    const t = await fixture.createTenant(`skip-${newId()}`);
    const created = await fixture.createConfidentialClient(t.name, {});
    const url = `/admin/tenants/${t.name}/clients/${created.id}`;
    const manage = await fixture.adminToken(t.name, ['manage-clients']);
    const users = await fixture.adminToken(t.name, ['manage-users']);

    const refused = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { authorization: `Bearer ${users}`, ...JSON_HEADERS },
      payload: { skip_logout_confirmation: true },
    });
    expect(refused.statusCode).toBe(403);

    const stale = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { authorization: `Bearer ${manage}`, 'if-match': '"stale"', ...JSON_HEADERS },
      payload: { skip_logout_confirmation: true },
    });
    expect(stale.statusCode).toBe(412);

    const current = await fixture.http.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${manage}` },
    });
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: {
        authorization: `Bearer ${manage}`,
        'if-match': String(current.headers.etag),
        ...JSON_HEADERS,
      },
      payload: { skip_logout_confirmation: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ skip_logout_confirmation: boolean }>().skip_logout_confirmation).toBe(
      true,
    );
    expect(patched.headers.etag).not.toBe(current.headers.etag);

    const stored = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byId(created.id),
    );
    expect(stored?.skipLogoutConfirmation).toBe(true);

    const rows = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    const amends = rows.filter((row) => row.action === 'client.amend');
    expect(amends).toHaveLength(1);
    expect(amends[0]?.outcome).toBe('allowed');
    expect(amends[0]?.resourceId).toBe(created.id);
    expect(amends[0]?.detail).toEqual({ skip_logout_confirmation: { before: false, after: true } });
  });

  it('is held to the built-in admin guard like any field that is not listed as safe', async () => {
    const t = await fixture.createTenant(`skip-${newId()}`);
    const admin = await fixture.builtinAdminClient(t.name);
    const res = await fixture.patchClient(t.name, admin.id, { skip_logout_confirmation: false });
    expect(res.statusCode).toBe(409);
  });
});
