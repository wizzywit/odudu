import { expect, it } from 'vitest';
import {
  readAdminRoles,
  readEffectiveRoles,
  readRequiredActions,
  readSubjectGroups,
  setRequiredActions,
  setSubjectGroups,
} from '#/features/subjects/adapter/access.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const R = '/console/api/admin/tenants/acme';
const S = `${R}/subjects/s1`;
const GROUP = {
  id: 'g1',
  name: 'ops',
  description: null,
  parent_id: null,
  default_for_new_subjects: false,
  path: '/ops',
  created_at: '2026-09-28T08:41:53.858Z',
};

function role(id: string, name: string, clientKey: string | null, clientId: string | null) {
  return {
    id,
    name,
    description: null,
    client_id: clientId,
    client_key: clientKey,
    default_for_new_subjects: false,
    admin_reach: [],
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

it("reads and replaces a subject's groups on the ETag it read", async () => {
  const fake = fakeTransport({
    [`GET ${S}/groups`]: json({ items: [GROUP] }, 200, { etag: '"g1"' }),
    [`PUT ${S}/groups`]: json({ items: [] }, 200, { etag: '"g2"' }),
  });
  expect(await readSubjectGroups(fake.transport.gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    etag: '"g1"',
    data: { items: [GROUP] },
  });
  await setSubjectGroups(fake.transport.gateway, 'acme', 's1', [], '"g1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { group_ids: [] }, ifMatch: '"g1"' });
});

it("reads and replaces a subject's required actions on the ETag it read", async () => {
  const fake = fakeTransport({
    [`GET ${S}/required-actions`]: json({ actions: ['configure-totp'] }, 200, { etag: '"a1"' }),
    [`PUT ${S}/required-actions`]: json({ actions: [] }, 200, { etag: '"a2"' }),
  });
  expect(await readRequiredActions(fake.transport.gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    etag: '"a1"',
    data: { actions: ['configure-totp'] },
  });
  await setRequiredActions(fake.transport.gateway, 'acme', 's1', ['update-password'], '"a1"');
  expect(fake.sent.at(-1)).toMatchObject({
    body: { actions: ['update-password'] },
    ifMatch: '"a1"',
  });
});

it('reads every role a subject holds, with how', async () => {
  const fake = fakeTransport({
    [`GET ${S}/effective-roles`]: json({
      items: [
        { id: 'r1', name: 'x', client_id: null, client_key: null, via: [{ kind: 'direct' }] },
      ],
    }),
  });
  expect(await readEffectiveRoles(fake.transport.gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    data: { items: [{ id: 'r1', via: [{ kind: 'direct' }] }] },
  });
});

it("finds the built-in admin client's roles through the role list, by name", async () => {
  const fake = fakeTransport({
    [`GET ${R}/roles`]: (request) =>
      json({
        items:
          request.search.get('client') === 'c-admin'
            ? [
                role('r-full', 'tenant-admin', 'odudu-admin', 'c-admin'),
                role('r-users', 'manage-users', 'odudu-admin', 'c-admin'),
                role('r-other', 'reporting', 'odudu-admin', 'c-admin'),
              ]
            : [
                role('r-tenant', 'tenant-admin', null, null),
                role('r-full', 'tenant-admin', 'odudu-admin', 'c-admin'),
              ],
      })(request),
  });
  const found = await readAdminRoles(fake.transport.gateway, 'acme');
  expect(found).toMatchObject({ ok: true });
  expect(found.ok ? [...found.data] : null).toEqual([
    ['tenant-admin', 'r-full'],
    ['manage-users', 'r-users'],
  ]);
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'name=tenant-admin',
    'client=c-admin&limit=200',
  ]);
});
