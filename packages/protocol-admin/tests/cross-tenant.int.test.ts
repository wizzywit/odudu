import { withTenant } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { userRepository } from '@odudu/domain-identity';
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

// Every case shares one fixture and one container (beforeAll above), so
// each gets its own tenant name — `acme` alone would collide across `it`s
// on `tenants_name_unique`.
describe('cross-tenant administration', () => {
  it('refuses a tenant-local admin of T at U, with every capability held, and audits it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);

    // Refused before the signature is even checked, so no row of U was
    // read or written — except the audit row itself, which names no actor
    // because nothing about the caller has been verified yet.
    const rows = await withTenant(fixture.app.db, u.id, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'admin.cross_tenant_refused',
      outcome: 'refused',
      actorSubjectId: null,
    });
  });

  it('admits a system admin holding manage-tenants', async () => {
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a system admin without manage-tenants', async () => {
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${u.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('reads no row of U even when the authorization check is bypassed', async () => {
    // RLS is the second defence for a tenant-local caller: bind T's
    // context and ask for U's subject directly, the way a bug in the
    // authorization check would. A real row in U proves this is RLS
    // refusing it, not U simply having nothing to find.
    const t = await fixture.createTenant(`acme-${newId()}`);
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    await fixture.createSubject(u.name, 'victim');

    const seenFromU = await withTenant(fixture.app.db, u.id, (tx) =>
      userRepository(tx).byUsername('victim'),
    );
    expect(seenFromU).not.toBeNull();

    const seenFromT = await withTenant(fixture.app.db, t.id, (tx) =>
      userRepository(tx).byUsername('victim'),
    );
    expect(seenFromT).toBeNull();
  });
});
