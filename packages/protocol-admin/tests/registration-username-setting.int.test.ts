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

type Patch = (payload: Record<string, unknown>) => Promise<LightMyRequestResponse>;

async function patcher(): Promise<Patch> {
  const tenant = await fixture.createTenant(`regname-${newId()}`);
  const token = await fixture.adminToken(tenant.name, ['manage-tenant']);
  const url = `/admin/tenants/${tenant.name}/settings`;
  const headers = { authorization: `Bearer ${token}` };
  return (payload) => fixture.http.inject({ method: 'PATCH', url, headers, payload });
}

describe('the registration_username setting', () => {
  it('reads back as required for a new tenant', async () => {
    const tenant = await fixture.createTenant(`regname-${newId()}`);
    const token = await fixture.adminToken(tenant.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      url: `/admin/tenants/${tenant.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({ registration_username: 'required' });
  });

  it('is refused while email sign-in or verification is off, and accepted once both are on', async () => {
    const patch = await patcher();

    const refused = await patch({ registration_username: 'optional' });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.body).toContain('needs login_with_email and verify_email on');
    expect(refused.json<{ detail: string }>().detail).toBe(
      '3 tenant setting(s) refused, listed under errors',
    );

    const accepted = await patch({
      registration_username: 'optional',
      login_with_email: true,
      verify_email: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ registration_username: 'optional' });
  });

  it('does not call a mix of a range and a rule problem a range', async () => {
    const patch = await patcher();
    const res = await patch({ registration_username: 'optional', password_min_length: 100000 });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json<{ detail: string }>().detail).toBe(
      '4 tenant setting(s) refused, listed under errors',
    );
  });

  it('holds verify_email and login_with_email on while a username is not required', async () => {
    const patch = await patcher();
    const on = await patch({
      registration_username: 'generated',
      login_with_email: true,
      verify_email: true,
    });
    expect(on.statusCode, on.body).toBe(200);

    const off = await patch({ verify_email: false });
    expect(off.statusCode, off.body).toBe(400);
    expect(off.body).toContain('must stay on while registration_username is optional or generated');

    const released = await patch({ registration_username: 'required', verify_email: false });
    expect(released.statusCode, released.body).toBe(200);
  });

  it('refuses a value that is none of the three', async () => {
    const patch = await patcher();
    const res = await patch({ registration_username: 'sometimes' });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('travels in a tenant document, judged with verify_email from the registration policy', async () => {
    const tenant = await fixture.createTenant(`regname-${newId()}`);
    const tenantToken = await fixture.adminToken(tenant.name, ['manage-tenant']);
    const set = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenant.name}/settings`,
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: { registration_username: 'generated', login_with_email: true, verify_email: true },
    });
    expect(set.statusCode, set.body).toBe(200);

    const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exported = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${tenant.name}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    const document: TenantDocument = tenantDocumentSchema.parse(JSON.parse(exported.payload));
    expect(document.settings.registration_username).toBe('generated');

    const importWith = (candidate: TenantDocument) =>
      fixture.http.inject({
        method: 'POST',
        url: '/admin/tenant-imports',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: `imp-${newId()}`, document: candidate }),
      });

    const imported = await importWith(document);
    expect(imported.statusCode, imported.body).toBe(201);

    const refused = await importWith({
      ...document,
      registration_policy: { ...document.registration_policy, verify_email: false },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.body).toContain('document.settings.registration_username');
    const { errors } = refused.json<{ errors: { path: string; message: string }[] }>();
    expect(errors.map((error) => error.path)).toEqual([
      'document.settings.registration_username',
      'document.registration_policy.verify_email',
    ]);
    const both = await importWith({
      ...document,
      settings: { ...document.settings, login_with_email: false },
      registration_policy: { ...document.registration_policy, verify_email: false },
    });
    expect(both.statusCode, both.body).toBe(400);
    expect(both.json<{ errors: { path: string }[] }>().errors.map((error) => error.path)).toEqual([
      'document.settings.registration_username',
      'document.settings.login_with_email',
      'document.registration_policy.verify_email',
    ]);
    expect(errors[1]?.message).toBe(
      'is off, which registration_username optional or generated needs',
    );
  });
});
