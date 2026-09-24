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

describe('admin error responses', () => {
  it('answers an unknown admin path with problem details', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/no-such-route`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json<{ status: number; instance: string }>();
    expect(body.status).toBe(404);
    expect(body.instance.length).toBeGreaterThan(0);
  });

  it('leaves the OIDC error body alone on the same instance', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${t.name}/protocol/openid-connect/token`,
      payload: 'grant_type=nonsense',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toHaveProperty('error');
  });
});
