import { expect, it } from 'vitest';
import { grantTenantAdmin, revokeAdministrator } from '#/shared/repository/administratorRoles.ts';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport.ts';
import { administratorRoutes } from '#/testing/tenantsFixtures.ts';

const S = '/console/api/admin/tenants/system';
const ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
const SUBJECT = { id: ID, username: 'ada' };

function role(id: string, name: string, client: string | null) {
  return {
    id,
    name,
    description: null,
    client_id: client,
    client_key: client === null ? null : 'odudu-admin',
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

function holder(id: string) {
  return {
    id,
    type: 'user',
    username: 'ada',
    email: null,
    enabled: true,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

function systemRoles(
  held: readonly string[],
  after: readonly string[] = [],
): Record<string, Answer> {
  const base = administratorRoutes('system', ID, 'unused');
  const assigned = (ids: readonly string[]) => ({
    items: ids.map((id) => ({ id, name: id, client_id: null, client_key: null })),
  });
  return {
    [`GET ${S}/clients`]: base[`GET ${S}/clients`] ?? json({ items: [] }),
    [`GET ${S}/roles`]: json({
      items: [
        role('r-admin', 'tenant-admin', 'c-admin'),
        role('r-tenants', 'manage-tenants', 'c-admin'),
        role('r-users', 'manage-users', 'c-admin'),
        role('r-own', 'tenant-admin', null),
      ],
    }),
    [`GET ${S}/subjects/${ID}/roles`]: json(assigned(held), 200, { etag: '"roles-1"' }),
    [`PUT ${S}/subjects/${ID}/roles`]: json(assigned([]), 200, { etag: '"roles-2"' }),
    [`GET ${S}/subjects`]: json({ items: after.map(holder) }),
  };
}

it('grants tenant-admin on the built-in client beside what the subject holds', async () => {
  const fake = fakeTransport(administratorRoutes('acme', ID, 'unused'));
  expect(await grantTenantAdmin(fake.transport.gateway, 'acme', ID)).toBeNull();
  expect(fake.sent.at(-1)).toMatchObject({
    method: 'PUT',
    ifMatch: '"roles-1"',
    body: { role_ids: ['r-default', 'r-admin'] },
  });
});

it("takes the built-in client's tenant-admin and manage-tenants away, keeping the rest", async () => {
  const fake = fakeTransport(systemRoles(['r-own', 'r-admin', 'r-users', 'r-tenants']));
  expect(await revokeAdministrator(fake.transport.gateway, 'system', SUBJECT)).toEqual({
    kind: 'revoked',
    stillHolds: false,
  });
  const put = fake.sent.find((sent) => sent.method === 'PUT');
  expect(put).toMatchObject({ ifMatch: '"roles-1"', body: { role_ids: ['r-own', 'r-users'] } });
  const check = fake.sent.at(-1);
  expect(check?.path).toBe(`${S}/subjects`);
  expect(check?.search.get('capability')).toBe('manage-tenants');
  expect(check?.search.get('username')).toBe('ada');
});

it('says so when the subject still holds manage-tenants some other way', async () => {
  const fake = fakeTransport(systemRoles(['r-admin'], [ID]));
  expect(await revokeAdministrator(fake.transport.gateway, 'system', SUBJECT)).toEqual({
    kind: 'revoked',
    stillHolds: true,
  });
});

it('changes nothing for a subject holding neither role directly', async () => {
  const fake = fakeTransport(systemRoles(['r-own', 'r-users']));
  expect(await revokeAdministrator(fake.transport.gateway, 'system', SUBJECT)).toEqual({
    kind: 'not-direct',
  });
  expect(fake.sent.some((sent) => sent.method === 'PUT')).toBe(false);
});

it("hands back the guard's refusal, and the request it answered", async () => {
  const routes = systemRoles(['r-admin']);
  routes[`PUT ${S}/subjects/${ID}/roles`] = problem(
    409,
    'about:blank#last-administrator',
    'Conflict',
    { detail: 'this would leave no enabled subject holding manage-tenants' },
  );
  const fake = fakeTransport(routes);
  const revoked = await revokeAdministrator(fake.transport.gateway, 'system', SUBJECT);
  expect(revoked).toMatchObject({
    kind: 'refused',
    request: 'set-roles',
    failure: { kind: 'problem', problem: { status: 409, type: 'about:blank#last-administrator' } },
  });
});
