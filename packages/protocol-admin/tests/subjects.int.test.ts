import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
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

describe('POST /admin/tenants/{t}/subjects', () => {
  it('creates a user subject that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const username = `ada-${newId()}`;
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username, email: `${username}@example.com` },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; username: string | null; type: string }>();
    expect(created.username).toBe(username);
    expect(created.type).toBe('user');

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listed = list.json<{ items: { username: string | null }[] }>().items;
    expect(listed.map((s) => s.username)).toContain(username);
  });

  // No password field exists on this door: creating a subject writes an
  // update-password required action instead, so no operator ever handles a
  // user's password. Zod's default `additionalProperties: false` is what
  // refuses it; this pins the rule rather than the mechanism.
  it('refuses a password field on the request', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}`, password: 'hunter2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a duplicate username with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const payload = { username: `dup-${newId()}` };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/subjects`;

    const first = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /admin/tenants/{t}/subjects', () => {
  // manage-users composes view-users (provisionAdminClient's own
  // viewCounterpart wiring), through role_composites — not a special case
  // in authorizeAdmin, so a caller holding only manage-users passes a read
  // route exactly like one holding view-users.
  it('is read by view-users, and by manage-users alone', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `bob-${newId()}`);
    for (const capability of ['view-users', 'manage-users']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/subjects`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('refuses a caller holding neither capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, []);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('filters by a username prefix with ?search=', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const prefix = `ss-${newId()}`;
    await fixture.createSubject(t.name, `${prefix}-match`);
    await fixture.createSubject(t.name, `other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?search=${prefix}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { username: string | null }[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.username?.startsWith(prefix) === true)).toBe(true);
  });

  it('pages by cursor', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `page-a-${newId()}`);
    await fixture.createSubject(t.name, `page-b-${newId()}`);
    await fixture.createSubject(t.name, `page-c-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ items: unknown[]; next?: string }>();
    expect(body.items.length).toBe(1);
    expect(body.next).toBeDefined();
    expect(first.headers.link).toContain('rel="next"');
  });

  it('lists a service subject, distinguishable by type', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=200`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { type: string }[] }>().items;
    expect(items.some((s) => s.type === 'service')).toBe(true);
  });
});

describe('GET /admin/tenants/{t}/subjects/{id}', () => {
  it('returns the subject with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `read-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no subject holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
