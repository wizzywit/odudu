import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
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

// Every case shares one fixture and one container (beforeAll above), so
// each gets its own tenant name — `acme` alone would collide across `it`s
// on `tenants_name_unique`, the same reason every other suite built on
// `startAdminFixture`-style fixtures suffixes with `newId()`.
describe('admin authentication', () => {
  it('refuses an ordinary access token from the right tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    // Minted with the tenant's own key and a live grant, but aud is the API
    // the application talks to, not the admin API.
    const token = await fixture.applicationToken(t.name, { audience: 'https://api.example' });
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses a token signed by a third tenant', async () => {
    const target = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`evil-${newId()}`);
    const token = await fixture.adminToken(other.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${target.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token whose grant has been revoked', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    await fixture.revokeGrantsFor(t.name);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token whose client has been disabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    await fixture.disableClientOf(token);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a token from the target tenant with the admin audience', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // The issuer this door checks against is resolved from the request the
  // same way /userinfo resolves the one it checks (tenantIssuerFor), not
  // from a fixed value — so a token minted for a non-default authority
  // must still be accepted when presented under that same authority.
  it('accepts a token minted and presented under the same non-default authority', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminTokenAt(t.name, ['manage-users'], 'idp.example');
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}`, host: 'idp.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a token minted under a different authority than the one presenting it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminTokenAt(t.name, ['manage-users'], 'idp.example');
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}`, host: 'other.example' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin authorization', () => {
  it('refuses a capability the caller does not hold', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows a caller holding the required capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // manage-users composes view-users (@odudu/domain-tenant's
  // viewCounterpart), so effectiveRoles' composite closure must satisfy a
  // route that only asks for the weaker capability without either side
  // special-casing the pair.
  it('admits a route requiring view-users to a caller holding only manage-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // A capability is a role on the built-in admin client. The same name on
  // an application client is that application's own role, and on the tenant
  // it is a tenant role — neither says anything about administering.
  it('refuses a role of the right name held on an ordinary application client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.tokenWithRoleOutsideAdminClient(
      t.name,
      'view-users',
      'application-client',
    );
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a role of the right name held at tenant level', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.tokenWithRoleOutsideAdminClient(t.name, 'view-users', 'tenant');
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a cross-tenant caller whose manage-tenants sits outside the admin client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.tokenWithRoleOutsideAdminClient(
      SYSTEM_TENANT_NAME,
      'manage-tenants',
      'application-client',
    );
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stops honouring a capability the moment it is revoked', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const url = `/admin/tenants/${t.name}/subjects`;
    const headers = { authorization: `Bearer ${token}` };
    expect((await fixture.http.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
    await fixture.revokeCapability(t.name, token, 'view-users');
    expect((await fixture.http.inject({ method: 'GET', url, headers })).statusCode).toBe(403);
  });

  it('allows a system admin holding manage-tenants and the route capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // A system admin who passes the issuer check (401 is not the outcome here)
  // but lacks manage-tenants is refused with 403, not treated as
  // unauthenticated — the two checks stay distinguishable.
  it('refuses a system admin who holds the route capability but not manage-tenants', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // whoami's capability is null, so a caller without any route capability
  // still reaches it locally — but the cross-tenant requirement is not a
  // route capability, and applies here exactly as it does to every other
  // route. Without it, a system admin holding no permission at all could
  // read any tenant's whoami by crossing tenants.
  it("refuses a system admin without manage-tenants at another tenant's whoami", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken([]);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows a system admin holding manage-tenants at another tenant's whoami", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
