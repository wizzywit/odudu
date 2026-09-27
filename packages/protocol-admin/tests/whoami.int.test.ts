import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@odudu/kernel';
import { MANAGE_TENANTS } from '@odudu/domain-tenant';
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

interface WhoamiBody {
  subjectId: string;
  issuerTenantId: string;
  capabilities: string[];
  crossTenant: boolean;
}

async function whoami(token: string, tenantName: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/whoami`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /whoami', () => {
  it('reports a single capability, not cross-tenant', async () => {
    const t = await fixture.createTenant(`whoami-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await whoami(token, t.name);

    expect(res.statusCode).toBe(200);
    const body = res.json<WhoamiBody>();
    expect(body.capabilities).toEqual(['view-users']);
    expect(body.crossTenant).toBe(false);
  });

  it('reports the composite capability a manage-* holder implies', async () => {
    const t = await fixture.createTenant(`whoami-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await whoami(token, t.name);

    expect(res.statusCode).toBe(200);
    const body = res.json<WhoamiBody>();
    expect(body.capabilities).toEqual(['manage-users', 'view-users']);
    expect(body.crossTenant).toBe(false);
  });

  it('sorts capabilities', async () => {
    const t = await fixture.createTenant(`whoami-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit', 'manage-clients']);

    const res = await whoami(token, t.name);

    expect(res.statusCode).toBe(200);
    expect(res.json<WhoamiBody>().capabilities).toEqual(['manage-clients', 'view-audit']);
  });

  it('reports crossTenant and exactly the system admin client roles for a system admin', async () => {
    const t = await fixture.createTenant(`whoami-${newId()}`);
    const token = await fixture.systemAdminToken([MANAGE_TENANTS, 'view-audit']);

    const res = await whoami(token, t.name);

    expect(res.statusCode).toBe(200);
    const body = res.json<WhoamiBody>();
    expect(body.crossTenant).toBe(true);
    expect(body.capabilities).toEqual([MANAGE_TENANTS, 'view-audit']);
  });
});
