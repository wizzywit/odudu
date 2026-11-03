import { expect, it, vi } from 'vitest';
import capabilities from '#/entities/subject/adapter/fixtures/admin-capabilities.json';
import effectiveRoles from '#/entities/subject/adapter/fixtures/effective-roles.json';
import groups from '#/entities/subject/adapter/fixtures/groups.json';
import requiredActions from '#/entities/subject/adapter/fixtures/required-actions.json';
import {
  readAdminCapabilities,
  readAdminRoles,
  readEffectiveRoles,
  readRequiredActions,
  readSubjectGroups,
  setRequiredActions,
  setSubjectGroups,
} from '#/entities/subject/adapter/subjectAccess';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const S = `${ACME_ADMIN}/subjects/s1`;
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
    [`GET ${S}/groups`]: json(groups, 200, { etag: '"g1"' }),
    [`PUT ${S}/groups`]: json({ items: [] }, 200, { etag: '"g2"' }),
  });
  expect(await readSubjectGroups(fake.transport.gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    etag: '"g1"',
    data: groups,
  });
  await setSubjectGroups(fake.transport.gateway, 'acme', 's1', [], '"g1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { group_ids: [] }, ifMatch: '"g1"' });
});

it("reads and replaces a subject's required actions on the ETag it read", async () => {
  const fake = fakeTransport({
    [`GET ${S}/required-actions`]: json(requiredActions, 200, { etag: '"a1"' }),
    [`PUT ${S}/required-actions`]: json({ actions: [] }, 200, { etag: '"a2"' }),
  });
  expect(await readRequiredActions(fake.transport.gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    etag: '"a1"',
    data: { actions: ['update-password'] },
  });
  await setRequiredActions(fake.transport.gateway, 'acme', 's1', ['update-password'], '"a1"');
  expect(fake.sent.at(-1)).toMatchObject({
    body: { actions: ['update-password'] },
    ifMatch: '"a1"',
  });
});

it('reads a page of the roles a subject holds, with how, from the cursor it is given', async () => {
  const fake = fakeTransport({ [`GET ${S}/effective-roles`]: json(effectiveRoles) });
  const first = await readEffectiveRoles(
    fake.transport.gateway,
    'acme',
    's1',
    new URLSearchParams(),
  );
  expect(first).toMatchObject({
    ok: true,
    data: {
      items: [{ name: 'role-reader', via: [{ kind: 'direct' }] }, {}],
      next: effectiveRoles.next,
    },
  });
  await readEffectiveRoles(
    fake.transport.gateway,
    'acme',
    's1',
    new URLSearchParams({ cursor: 'c1' }),
  );
  expect(fake.sent.at(-1)?.search.get('cursor')).toBe('c1');
});

it('reads the admin capabilities a subject holds, whole', async () => {
  const fake = fakeTransport({ [`GET ${S}/admin-capabilities`]: json(capabilities) });
  const read = await readAdminCapabilities(fake.transport.gateway, 'acme', 's1');
  expect(read).toMatchObject({ ok: true, data: { complete: true } });
  expect(read.ok && read.data.items.map((item) => item.name)).toEqual([
    'view-users',
    'manage-users',
    'manage-keys',
    'view-audit',
    'key-keepers',
  ]);
});

it("finds the built-in admin client's roles through the role list, by name", async () => {
  const fake = fakeTransport({
    [`GET ${ACME_ADMIN}/roles`]: (request) =>
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

it('refuses to judge from admin capabilities the server says it did not return whole', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const fake = fakeTransport({
    [`GET ${S}/admin-capabilities`]: json({ items: [], complete: false }),
  });
  expect(await readAdminCapabilities(fake.transport.gateway, 'acme', 's1')).toEqual({
    ok: false,
    kind: 'defect',
  });
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});
