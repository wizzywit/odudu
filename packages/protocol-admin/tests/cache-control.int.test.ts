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

// Every admin response is specific to its caller, and several carry a
// secret shown once — none may be kept by a shared or private cache.
describe('cache-control on admin API responses', () => {
  it('is no-store on the responses that carry a secret, and on an ordinary read', async () => {
    const t = await fixture.createTenant(`cache-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `ann-${newId()}`);
    const token = await fixture.adminToken(t.name, [
      'manage-clients',
      'manage-users',
      'view-users',
    ]);
    const headers = { authorization: `Bearer ${token}` };

    const mint = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/registration-tokens`,
      headers,
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers,
      payload: { client_id: `cache-client-${newId()}`, grant_types: ['client_credentials'] },
    });
    const clientId = created.json<{ id: string }>().id;
    const rotated = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients/${clientId}/secret`,
      headers,
    });
    const issued = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/password`,
      headers,
    });
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}`,
      headers,
    });

    for (const res of [mint, created, rotated, issued, read]) {
      expect(res.statusCode, res.body).toBeLessThan(300);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('is no-store on a refusal too', async () => {
    const t = await fixture.createTenant(`cache-refused-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const forbidden = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    const unauthenticated = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
    });

    expect(forbidden.statusCode).toBe(403);
    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.headers['cache-control']).toBe('no-store');
    expect(unauthenticated.headers['cache-control']).toBe('no-store');
  });
});
