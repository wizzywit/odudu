import { expect, it } from 'vitest';
import {
  amendGroup,
  createGroup,
  deleteGroup,
  findGroup,
  readGroup,
  readGroupCount,
  readGroupPage,
  readGroupRoles,
  setGroupDefault,
  setGroupRoles,
} from '#/features/groups/adapter/groups.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const A = '/console/api/admin/tenants/acme';
const G = `${A}/groups`;

function group(id: string, path: string, parent: string | null = null) {
  return {
    id,
    name: path.split('/').at(-1) ?? path,
    description: null,
    parent_id: parent,
    default_for_new_subjects: false,
    path,
    created_at: '2026-09-28T08:41:53.858Z',
    admin_reach: [],
  };
}

function record(g: ReturnType<typeof group>) {
  return { ...g, subtree_admin_reach: [], holds_default_group: false };
}

const ENG = group('g-eng', '/eng');
const PLATFORM = group('g-plat', '/eng/platform', 'g-eng');

it('reads one level of the tree, and counts it', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: json({ items: [ENG] }),
    [`GET ${G}/count`]: json({ count: 1, capped: false }),
  });
  const gateway = fake.transport.gateway;
  expect(
    await readGroupPage(gateway, 'acme', new URLSearchParams({ parent: 'root' })),
  ).toMatchObject({ ok: true, data: { items: [ENG] } });
  expect(fake.sent.at(-1)?.search.get('parent')).toBe('root');
  await readGroupCount(gateway, 'acme', new URLSearchParams({ name: 'e' }));
  expect(fake.sent.at(-1)?.search.get('name')).toBe('e');
});

it('creates a group under a parent, with a description only when given', async () => {
  const fake = fakeTransport({ [`POST ${G}`]: json(record(PLATFORM), 201, { etag: '"p1"' }) });
  const gateway = fake.transport.gateway;
  await createGroup(gateway, 'acme', { name: 'platform', description: '', parentId: 'g-eng' });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'platform', parent_id: 'g-eng' });
  await createGroup(gateway, 'acme', { name: 'eng', description: 'Builds', parentId: null });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'eng', description: 'Builds' });
});

it('reads, amends, marks and deletes a group, each write on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${G}/g-plat`]: json(record(PLATFORM), 200, { etag: '"p1"' }),
    [`PATCH ${G}/g-plat`]: json(record(PLATFORM), 200, { etag: '"p2"' }),
    [`PUT ${G}/g-plat/default`]: json(record(PLATFORM), 200, { etag: '"p3"' }),
    [`DELETE ${G}/g-plat`]: () => new Response(null, { status: 204 }),
  });
  const gateway = fake.transport.gateway;
  expect(await readGroup(gateway, 'acme', 'g-plat')).toMatchObject({ ok: true, etag: '"p1"' });
  await amendGroup(gateway, 'acme', 'g-plat', { parent_id: null }, '"p1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { parent_id: null }, ifMatch: '"p1"' });
  await setGroupDefault(gateway, 'acme', 'g-plat', true, '"p2"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { default: true }, ifMatch: '"p2"' });
  expect(await deleteGroup(gateway, 'acme', 'g-plat')).toMatchObject({ ok: true });
});

it("reads and replaces a group's roles on the ETag it read", async () => {
  const role = { id: 'r1', name: 'auditor', client_id: null, client_key: null, admin_reach: [] };
  const fake = fakeTransport({
    [`GET ${G}/g-eng/roles`]: json({ items: [role] }, 200, { etag: '"r1"' }),
    [`PUT ${G}/g-eng/roles`]: json({ items: [] }, 200, { etag: '"r2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readGroupRoles(gateway, 'acme', 'g-eng')).toMatchObject({
    ok: true,
    etag: '"r1"',
    data: { items: [role] },
  });
  await setGroupRoles(gateway, 'acme', 'g-eng', [], '"r1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { role_ids: [] }, ifMatch: '"r1"' });
});

it('finds a group by its name under a parent, for a creation whose answer was lost', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: (request) =>
      json({
        items:
          request.search.get('parent') === 'g-eng' && request.search.get('name') === 'platform'
            ? [PLATFORM, group('g-x', '/eng/platformer', 'g-eng')]
            : [],
      })(request),
  });
  const gateway = fake.transport.gateway;
  expect(await findGroup(gateway, 'acme', 'platform', 'g-eng')).toMatchObject({
    ok: true,
    data: PLATFORM,
  });
  expect(await findGroup(gateway, 'acme', 'platform', null)).toMatchObject({
    ok: true,
    data: null,
  });
  expect(fake.sent.at(-1)?.search.get('parent')).toBe('root');
});

it('follows the pages of a prefix search until the names run past the one looked for', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: (request) =>
      json(
        request.search.get('cursor') === null
          ? { items: [group('g-1', '/qa-1'), group('g-2', '/qa')], next: 'c1' }
          : { items: [group('g-3', '/qb')] },
      )(request),
  });
  expect(await findGroup(fake.transport.gateway, 'acme', 'qb', null)).toMatchObject({
    ok: true,
    data: { id: 'g-3' },
  });
  expect(fake.sent).toHaveLength(2);
});
