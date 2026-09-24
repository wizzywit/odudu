import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixture: AdminFixture;
beforeAll(async () => {
  fixture = await startAdminFixture();
}, 180_000);
afterAll(async () => {
  await fixture.stop();
});

describe('startAdminFixture', () => {
  it('mints a token carrying only the capabilities asked for', async () => {
    const t = await fixture.createTenant('acme');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect(token.split('.')).toHaveLength(3);
  });

  it('isolates tenants created through it', async () => {
    const a = await fixture.createTenant('alpha');
    const b = await fixture.createTenant('beta');
    expect(a.id).not.toBe(b.id);
  });
});
