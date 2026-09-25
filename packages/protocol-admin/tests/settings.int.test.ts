import { withTenant } from '@odudu/db';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendSettings } from '#/usecase/settings';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('PATCH /admin/tenants/{t}/settings', () => {
  it('applies a setting the CLI also applies, through the same map', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true, password_min_length: 14 },
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ verify_email: true, password_min_length: 14 });
    });
  });

  it('applies the numbers 0 and 1 as numbers, not as booleans', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password_history_depth: 0, max_sessions_per_browser: 1 },
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ password_history_depth: 0, max_sessions_per_browser: 1 });
    });
  });

  it('refuses an unknown setting, naming the known ones', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { not_a_setting: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets the database refuse a value outside its CHECK', async () => {
    // Ranges are CHECK constraints, deliberately not restated in the
    // settings map — a policy no writer may bypass belongs at the database.
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password_min_length: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 412 when If-Match is stale', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = await fixture.http.inject({ method: 'GET', url, headers });
    const etag = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('expected GET to answer an etag');
    await fixture.http.inject({ method: 'PATCH', url, headers, payload: { verify_email: true } });
    const stale = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { verify_email: false },
    });
    expect(stale.statusCode).toBe(412);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a system admin holding manage-tenants but not manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admits a system admin holding manage-tenants and manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('calls audit exactly once when it amends a setting', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSettings(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          tenantId: t.id,
          values: { verify_email: true },
          ifMatch: undefined,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('amended');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when a value is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSettings(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          tenantId: t.id,
          values: { not_a_setting: true },
          ifMatch: undefined,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('unknown_setting');
    expect(events).toHaveLength(0);
  });
});

describe('GET /admin/tenants/{t}/settings', () => {
  it('returns every setting, keyed the same way a write names them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.json<{ verify_email: boolean }>().verify_email).toBe(false);
  });

  it('probes with a foreign tenant_id and finds nothing to leak', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`other-${newId()}`);
    await withTenant(fixture.app.db, t2.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t1.id);
      expect(row).toBeNull();
    });
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a system admin holding manage-tenants but not manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admits a system admin holding manage-tenants and manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
