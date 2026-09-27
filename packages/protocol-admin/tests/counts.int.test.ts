import { withTenant } from '@odudu/db';
import { MANAGE_TENANTS } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { COUNT_CAP, countSubjects } from '#/usecase/counts';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function tenantWithSubjects(usernames: readonly string[]) {
  const t = await fixture.createTenant(`count-${newId()}`);
  for (const username of usernames) await fixture.createSubject(t.name, username);
  return t;
}

describe('countSubjects', () => {
  it('counts every subject of the tenant, uncapped', async () => {
    const t = await tenantWithSubjects(['ada', 'alan', 'grace']);
    const counted = await withTenant(fixture.app.db, t.id, (tx) => countSubjects(tx, {}));
    expect(counted).toEqual({ count: 3, capped: false });
  });

  it('counts only the subjects a search matches', async () => {
    const t = await tenantWithSubjects(['ada', 'Alan', 'grace']);
    const counted = await withTenant(fixture.app.db, t.id, (tx) =>
      countSubjects(tx, { username: 'a' }),
    );
    expect(counted).toEqual({ count: 2, capped: false });
  });

  it('stops at the ceiling and says it did', async () => {
    const t = await tenantWithSubjects(['ada', 'alan', 'grace']);
    const counted = await withTenant(fixture.app.db, t.id, (tx) =>
      countSubjects(tx, {}, { cap: 2 }),
    );
    expect(counted).toEqual({ count: 2, capped: true });
  });

  it('is not capped at exactly the ceiling', async () => {
    const t = await tenantWithSubjects(['ada', 'alan']);
    const counted = await withTenant(fixture.app.db, t.id, (tx) =>
      countSubjects(tx, {}, { cap: 2 }),
    );
    expect(counted).toEqual({ count: 2, capped: false });
  });

  it('never counts a foreign tenant’s rows', async () => {
    const t = await tenantWithSubjects(['ada']);
    await tenantWithSubjects(['alan', 'anne', 'arthur']);
    const counted = await withTenant(fixture.app.db, t.id, (tx) =>
      countSubjects(tx, { username: 'a' }),
    );
    expect(counted).toEqual({ count: 1, capped: false });
  });

  it('defaults to a ceiling of ten thousand', () => {
    expect(COUNT_CAP).toBe(10_000);
  });
});

interface CountBody {
  readonly count: number;
  readonly capped: boolean;
}

async function get(url: string, token: string) {
  return fixture.http.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function listedCount(url: string, token: string): Promise<number> {
  const res = await get(`${url}${url.includes('?') ? '&' : '?'}limit=200`, token);
  expect(res.statusCode, url).toBe(200);
  const body = res.json<{ items: unknown[]; next?: string }>();
  expect(body.next, `${url} fitted on one page`).toBeUndefined();
  return body.items.length;
}

// Each count answers what its own list would page through under the same
// query, which is what sharing one predicate is for.
const TENANT_COUNTS = [
  { collection: 'subjects', capability: 'view-users', refused: 'manage-clients', query: '' },
  {
    collection: 'subjects',
    capability: 'view-users',
    refused: 'manage-clients',
    query: 'username=a',
  },
  {
    collection: 'subjects',
    capability: 'view-users',
    refused: 'manage-clients',
    query: 'enabled=true',
  },
  {
    collection: 'clients',
    capability: 'manage-clients',
    refused: 'view-users',
    query: 'type=public',
  },
  { collection: 'clients', capability: 'manage-clients', refused: 'view-users', query: '' },
  {
    collection: 'roles',
    capability: 'manage-tenant',
    refused: 'manage-users',
    query: 'client=tenant',
  },
  { collection: 'roles', capability: 'manage-tenant', refused: 'manage-users', query: '' },
  { collection: 'groups', capability: 'manage-tenant', refused: 'manage-users', query: '' },
  { collection: 'scopes', capability: 'manage-tenant', refused: 'manage-users', query: 'name=o' },
] as const;

describe('GET /admin/tenants/{tenant}/{collection}/count', () => {
  it.each(TENANT_COUNTS)(
    '$collection?$query agrees with its list, and refuses $refused',
    async ({ collection, capability, refused, query }) => {
      const t = await tenantWithSubjects(['ada', 'alan', 'grace']);
      const token = await fixture.adminToken(t.name, [capability]);
      const base = `/admin/tenants/${t.name}/${collection}`;
      const suffix = query === '' ? '' : `?${query}`;

      const res = await get(`${base}/count${suffix}`, token);
      expect(res.statusCode).toBe(200);
      const body = res.json<CountBody>();
      expect(body).toEqual({ count: await listedCount(`${base}${suffix}`, token), capped: false });

      const other = await fixture.adminToken(t.name, [refused]);
      expect((await get(`${base}${suffix}`, other)).statusCode).toBe(403);
      expect((await get(`${base}/count${suffix}`, other)).statusCode).toBe(403);
    },
  );

  it('counts the holders of a role the way the list filters them', async () => {
    const t = await tenantWithSubjects(['ada', 'alan', 'grace']);
    const token = await fixture.adminToken(t.name, ['manage-users', 'manage-tenant']);
    const role = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'auditor' },
    });
    const roleId = role.json<{ id: string }>().id;
    const listed = await get(`/admin/tenants/${t.name}/subjects?username=a`, token);
    const [first] = listed.json<{ items: { id: string }[] }>().items;
    if (first === undefined) throw new Error('no subject matched ?username=a');
    const assigned = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${first.id}/roles`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '*',
      },
      payload: { role_ids: [roleId] },
    });
    expect(assigned.statusCode).toBe(200);

    const res = await get(`/admin/tenants/${t.name}/subjects/count?role=${roleId}`, token);
    expect(res.json<CountBody>()).toEqual({ count: 1, capped: false });
  });

  it('refuses a page control and a second search field, as a query the list would', async () => {
    const t = await tenantWithSubjects([]);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const base = `/admin/tenants/${t.name}/subjects/count`;
    expect((await get(`${base}?limit=5`, token)).statusCode).toBe(400);
    expect((await get(`${base}?cursor=abc`, token)).statusCode).toBe(400);
    expect((await get(`${base}?username=a&email=a`, token)).statusCode).toBe(400);
    expect((await get(`${base}?unknown=1`, token)).statusCode).toBe(400);
  });

  it('routes /count to the count and a subject id to that subject', async () => {
    const t = await tenantWithSubjects(['ada']);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const counted = await get(`/admin/tenants/${t.name}/subjects/count`, token);
    expect(counted.json<CountBody>()).toEqual({ count: 2, capped: false });

    const { id } = await fixture.createSubject(t.name, 'grace');
    const read = await get(`/admin/tenants/${t.name}/subjects/${id}`, token);
    expect(read.statusCode).toBe(200);
    expect(read.json<{ username: string }>().username).toBe('grace');
  });
});

describe('GET /admin/tenants/count', () => {
  it('counts the tenants a search matches, and admits only manage-tenants', async () => {
    const prefix = `tc${newId().slice(0, 8)}`;
    for (const suffix of ['a', 'b', 'c']) await fixture.createTenant(`${prefix}-${suffix}`);
    const token = await fixture.systemAdminToken([MANAGE_TENANTS]);

    const res = await get(`/admin/tenants/count?name=${prefix}`, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<CountBody>()).toEqual({ count: 3, capped: false });
    expect(await listedCount(`/admin/tenants?name=${prefix}`, token)).toBe(3);

    const other = await fixture.systemAdminToken(['manage-tenant']);
    expect((await get('/admin/tenants/count', other)).statusCode).toBe(403);
  });
});
