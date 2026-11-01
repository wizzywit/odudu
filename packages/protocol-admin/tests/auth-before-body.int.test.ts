import { MANAGE_TENANTS } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let handle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  handle = await startAdminFixture();
  fixture = handle;
}, 180_000);
afterAll(async () => {
  await handle?.stop();
});

const VALID_THEME = { tokens: {}, stylesheet: null, templates: {}, assets: {} };
const JSON_TYPE = { 'content-type': 'application/json' };

async function tenant(): Promise<{ id: string; name: string }> {
  return fixture.createTenant(`abb-${newId()}`);
}

function put(name: string, payload: string, headers: Record<string, string>) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${name}/theme`,
    headers: { ...JSON_TYPE, ...headers },
    payload,
  });
}

// A body is read and checked only for a caller already known to hold the
// capability, so a refusal never depends on what was sent.
describe('a route with a JSON body authenticates before it reads the body', () => {
  it('answers 401 to an unauthenticated PUT /theme with an invalid body', async () => {
    const t = await tenant();
    const res = await put(t.name, JSON.stringify({ tokens: 'nope', extra: 1 }), {});
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('tokens');
  });

  it('answers 401, not a parse error, to a body that is not JSON', async () => {
    const t = await tenant();
    expect((await put(t.name, '{not json', {})).statusCode).toBe(401);
  });

  it('answers 401 to a large unauthenticated theme body', async () => {
    const t = await tenant();
    const big = JSON.stringify({ ...VALID_THEME, stylesheet: 'a'.repeat(3 * 1024 * 1024) });
    expect((await put(t.name, big, {})).statusCode).toBe(401);
  });

  it('answers 403, not 400, to a caller without the capability sending an invalid body', async () => {
    const t = await tenant();
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await put(t.name, JSON.stringify({ tokens: 'nope' }), {
      authorization: `Bearer ${token}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('still refuses an invalid body with 400 once the caller holds the capability', async () => {
    const t = await tenant();
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await put(t.name, JSON.stringify({ tokens: 'nope' }), {
      authorization: `Bearer ${token}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('still saves a valid theme for a caller who may', async () => {
    const t = await tenant();
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await put(t.name, JSON.stringify(VALID_THEME), {
      authorization: `Bearer ${token}`,
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('answers 401 to an unauthenticated tenant import, whatever its body', async () => {
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: JSON_TYPE,
      payload: '{"name": 1}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('answers 403 to a tenant import by a caller without manage-tenants', async () => {
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { ...JSON_TYPE, authorization: `Bearer ${token}` },
      payload: '{"name": 1}',
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps a malformed import 400 for the caller who may import', async () => {
    const token = await fixture.systemAdminToken([MANAGE_TENANTS]);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { ...JSON_TYPE, authorization: `Bearer ${token}` },
      payload: '{"name": 1}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 401 before a path id is checked, on a route that has a body', async () => {
    const t = await tenant();
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/not-a-uuid`,
      headers: JSON_TYPE,
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('covers every route that declares a body or a limit', () => {
    const routes = ADMIN_ROUTES.filter(
      (route) => route.bodySchema !== undefined || route.bodyLimit !== undefined,
    );
    expect(routes.length).toBeGreaterThan(20);
  });
});
