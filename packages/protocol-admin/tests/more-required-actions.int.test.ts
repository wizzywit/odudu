import { withTenant } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture, etagAt } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function setup(options: { email?: string | null; verified?: boolean } = {}) {
  const t = await fixture.createTenant(`acme-${newId()}`);
  const { id } = await fixture.createSubject(t.name, `req-${newId()}`);
  const email = options.email === undefined ? `${id}@example.com` : options.email;
  await withTenant(fixture.app.db, t.id, async (tx) => {
    if (email !== null) await userRepository(tx).updateEmail(id, email);
    if (options.verified === true) await userRepository(tx).markEmailVerified(id);
  });
  const token = await fixture.adminToken(t.name, ['manage-users', 'manage-tenant']);
  const url = `/admin/tenants/${t.name}/subjects/${id}/required-actions`;
  const put = async (actions: string[]) =>
    fixture.http.inject({
      method: 'PUT',
      url,
      headers: {
        'if-match': await etagAt(fixture.http, url, token),
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { actions },
    });
  const patchSettings = (payload: Record<string, unknown>) =>
    fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload,
    });
  return { t, id, put, patchSettings, token };
}

describe('PUT …/required-actions with the three actions that ask more of a person', () => {
  it('owes verify-email to a subject with an address, verified or not', async () => {
    const unverified = await setup();
    const owed = await unverified.put(['verify-email']);
    expect(owed.statusCode).toBe(200);
    expect(owed.json<{ actions: string[] }>().actions).toEqual(['verify-email']);

    const verified = await setup({ verified: true });
    expect((await verified.put(['verify-email'])).statusCode).toBe(200);
  });

  it('refuses verify-email for a subject with no address, as no-email', async () => {
    const { put } = await setup({ email: null });
    const res = await put(['verify-email']);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#no-email');
  });

  it('owes update-profile, since a person may edit their profile at every tenant', async () => {
    const { put } = await setup();
    const res = await put(['update-profile']);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ actions: string[] }>().actions).toEqual(['update-profile']);
  });

  it('refuses accept-terms until the tenant has terms, as terms-not-configured', async () => {
    const { put, patchSettings } = await setup();
    const refused = await put(['accept-terms']);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ type: string }>().type).toBe('about:blank#terms-not-configured');

    expect((await patchSettings({ terms_uri: 'https://example.com/terms' })).statusCode).toBe(200);
    const owed = await put(['accept-terms']);
    expect(owed.statusCode).toBe(200);
    expect(owed.json<{ actions: string[] }>().actions).toEqual(['accept-terms']);
  });

  it('lets a list keep an action that has since become impossible, and refuses to add it', async () => {
    const { put, patchSettings } = await setup();
    expect((await patchSettings({ terms_uri: 'https://example.com/terms' })).statusCode).toBe(200);
    expect((await put(['accept-terms'])).statusCode).toBe(200);
    expect((await patchSettings({ terms_uri: '' })).statusCode).toBe(200);

    const kept = await put(['accept-terms', 'update-password']);
    expect(kept.statusCode).toBe(200);
    expect(kept.json<{ actions: string[] }>().actions.sort()).toEqual([
      'accept-terms',
      'update-password',
    ]);
    expect((await put(['update-password'])).statusCode).toBe(200);
    expect((await put(['update-password', 'accept-terms'])).statusCode).toBe(409);
  });

  it('writes nothing when one action of the list is refused', async () => {
    const { put, id, t, token } = await setup({ email: null });
    expect((await put(['update-password', 'verify-email'])).statusCode).toBe(409);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<{ actions: string[] }>().actions).toEqual([]);
  });

  it('still refuses a name it does not know', async () => {
    const { put } = await setup();
    expect((await put(['accept-tos'])).statusCode).toBe(400);
  });

  it('does not let a mailed link carry them', async () => {
    const { id, t, token } = await setup();
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects/${id}/actions-email`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { actions: ['verify-email'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
