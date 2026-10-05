import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { createPasswordSubject, createSignInClient, submitPassword } from '#/testing/sign-in';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const PASSWORD = 'correct horse battery staple';
const EVERY_TYPE = [
  'admin_mutation',
  'admin_access',
  'authentication',
  'session',
  'token',
  'credential',
];

async function settings(
  tenantName: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  return fixture.http.inject({
    method: payload === undefined ? 'GET' : 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function storedTypes(tenantId: string): Promise<string[]> {
  const rows = await withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select({ eventType: auditEvents.eventType }).from(auditEvents),
  );
  return [...new Set(rows.map((row) => row.eventType))].sort();
}

async function signIn(tenant: { id: string; name: string }): Promise<void> {
  const client = await createSignInClient(fixture, tenant.id);
  const username = `ada-${newId()}`;
  await createPasswordSubject(fixture, tenant.id, username, PASSWORD);
  const res = await submitPassword(fixture, tenant.name, client.clientId, username, PASSWORD);
  expect(res.statusCode).toBe(302);
}

describe('the audit_event_types setting', () => {
  it('stores every type by default', async () => {
    const t = await fixture.createTenant(`aet-${newId()}`);
    const res = await settings(t.name);
    expect(res.json<{ audit_event_types: string[] }>().audit_event_types).toEqual(EVERY_TYPE);
  });

  it('skips the types left out, from the moment it is saved, deleting nothing', async () => {
    const t = await fixture.createTenant(`aet-${newId()}`);
    await signIn(t);
    expect(await storedTypes(t.id)).toEqual(['authentication', 'session']);

    const amended = await settings(t.name, {
      audit_event_types: ['admin_mutation', 'admin_access', 'token', 'credential'],
    });
    expect(amended.statusCode, amended.body).toBe(200);
    expect(amended.json<{ audit_event_types: string[] }>().audit_event_types).toEqual([
      'admin_mutation',
      'admin_access',
      'token',
      'credential',
    ]);
    const before = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));

    await signIn(t);
    const after = await withTenant(fixture.app.db, t.id, (tx) => tx.select().from(auditEvents));
    expect(after.filter((row) => row.eventType !== 'admin_mutation')).toEqual(
      before.filter((row) => row.eventType !== 'admin_mutation'),
    );
    expect(after.map((row) => row.action)).toContain('tenant.amend_settings');
  });

  it.each([
    [['admin_access', 'authentication'], 'admin_mutation'],
    [['admin_mutation'], 'admin_access'],
    [[], 'admin_mutation'],
  ])('refuses %j, which turns off %s, with a 400 naming the field', async (value, missing) => {
    const t = await fixture.createTenant(`aet-${newId()}`);
    const res = await settings(t.name, { audit_event_types: value });
    expect(res.statusCode).toBe(400);
    const errors = res.json<{ errors: { path: string; message: string }[] }>().errors;
    expect(errors.map((error) => error.path)).toEqual(['audit_event_types']);
    expect(errors[0]?.message).toContain(missing);
    expect(
      (await settings(t.name)).json<{ audit_event_types: string[] }>().audit_event_types,
    ).toEqual(EVERY_TYPE);
  });

  it.each([[['admin_mutation', 'admin_access', 'logins']], ['admin_mutation'], [7]])(
    'refuses %j, which is not a list of event types',
    async (value) => {
      const t = await fixture.createTenant(`aet-${newId()}`);
      const res = await settings(t.name, { audit_event_types: value });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('audit_event_types');
    },
  );

  it('travels in a tenant document', async () => {
    const t = await fixture.createTenant(`aet-${newId()}`);
    await settings(t.name, { audit_event_types: ['admin_access', 'admin_mutation', 'token'] });
    const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exportOf = async (name: string): Promise<TenantDocument> => {
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${name}/export`,
        headers: { authorization: `Bearer ${token}` },
      });
      return tenantDocumentSchema.parse(JSON.parse(res.payload));
    };
    const document = await exportOf(t.name);
    expect(document.settings.audit_event_types).toEqual([
      'admin_mutation',
      'admin_access',
      'token',
    ]);
    const imported = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: `imp-${newId()}`, document }),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const again = await exportOf(imported.json<{ tenant: { name: string } }>().tenant.name);
    expect(again.settings.audit_event_types).toEqual(['admin_mutation', 'admin_access', 'token']);

    const refused = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: `imp-${newId()}`,
        document: { ...document, settings: { ...document.settings, audit_event_types: ['token'] } },
      }),
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('audit_event_types');
  });
});
