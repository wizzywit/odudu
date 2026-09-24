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
