import { expect, it } from 'vitest';
import count from '#/pages/groups/adapter/fixtures/group-count.json';
import list from '#/pages/groups/adapter/fixtures/group-list.json';
import roles from '#/pages/groups/adapter/fixtures/group-roles.json';
import oncall from '#/pages/groups/adapter/fixtures/group.json';
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
} from '#/pages/groups/adapter/groups';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const G = `${ACME_ADMIN}/groups`;
const ONCALL = `${G}/${oncall.id}`;
const [ENGINEERING, OPS] = list.items;

it('reads one level of the tree, and counts it', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: json(list),
    [`GET ${G}/count`]: json(count),
  });
  const gateway = fake.transport.gateway;
  expect(
    await readGroupPage(gateway, 'acme', new URLSearchParams({ parent: 'root' })),
  ).toMatchObject({ ok: true, data: list });
  expect(fake.sent.at(-1)?.search.get('parent')).toBe('root');
  expect(await readGroupCount(gateway, 'acme', new URLSearchParams({ name: 'eng' }))).toMatchObject(
    { ok: true, data: count },
  );
  expect(fake.sent.at(-1)?.search.get('name')).toBe('eng');
});

it('creates a group under a parent, with a description only when given', async () => {
  const fake = fakeTransport({ [`POST ${G}`]: json(oncall, 201, { etag: '"p1"' }) });
  const gateway = fake.transport.gateway;
  expect(
    await createGroup(gateway, 'acme', {
      name: 'oncall',
      description: '',
      parentId: oncall.parent_id,
    }),
  ).toMatchObject({ ok: true, etag: '"p1"', data: oncall });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'oncall', parent_id: oncall.parent_id });
  await createGroup(gateway, 'acme', { name: 'ops', description: 'Runs it', parentId: null });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'ops', description: 'Runs it' });
});

it('reads, amends, marks and deletes a group, each write on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${ONCALL}`]: json(oncall, 200, { etag: '"p1"' }),
    [`PATCH ${ONCALL}`]: json(oncall, 200, { etag: '"p2"' }),
    [`PUT ${ONCALL}/default`]: json(oncall, 200, { etag: '"p3"' }),
    [`DELETE ${ONCALL}`]: () => new Response(null, { status: 204 }),
  });
  const gateway = fake.transport.gateway;
  expect(await readGroup(gateway, 'acme', oncall.id)).toMatchObject({
    ok: true,
    etag: '"p1"',
    data: oncall,
  });
  await amendGroup(gateway, 'acme', oncall.id, { parent_id: null }, '"p1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { parent_id: null }, ifMatch: '"p1"' });
  await amendGroup(gateway, 'acme', oncall.id, { description: '' }, '"p1"');
  expect(fake.sent.at(-1)?.body).toEqual({ description: null });
  await amendGroup(gateway, 'acme', oncall.id, { description: 'Builds' }, '"p1"');
  expect(fake.sent.at(-1)?.body).toEqual({ description: 'Builds' });
  await setGroupDefault(gateway, 'acme', oncall.id, true, '"p2"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { default: true }, ifMatch: '"p2"' });
  expect(await deleteGroup(gateway, 'acme', oncall.id)).toMatchObject({ ok: true });
});

it("reads and replaces a group's roles on the ETag it read", async () => {
  const fake = fakeTransport({
    [`GET ${ONCALL}/roles`]: json(roles, 200, { etag: '"r1"' }),
    [`PUT ${ONCALL}/roles`]: json({ items: [] }, 200, { etag: '"r2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readGroupRoles(gateway, 'acme', oncall.id)).toMatchObject({
    ok: true,
    etag: '"r1"',
    data: roles,
  });
  expect(await setGroupRoles(gateway, 'acme', oncall.id, [], '"r1"')).toMatchObject({
    ok: true,
    etag: '"r2"',
    data: { items: [] },
  });
  expect(fake.sent.at(-1)).toMatchObject({ body: { role_ids: [] }, ifMatch: '"r1"' });
});

it('finds a group by its name under a parent, for a creation whose answer was lost', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: (request) =>
      json({
        items:
          request.search.get('parent') === 'g-eng' && request.search.get('name') === 'engineering'
            ? [OPS, ENGINEERING]
            : [],
      })(request),
  });
  const gateway = fake.transport.gateway;
  expect(await findGroup(gateway, 'acme', 'engineering', 'g-eng')).toMatchObject({
    ok: true,
    data: ENGINEERING,
  });
  expect(await findGroup(gateway, 'acme', 'engineering', null)).toMatchObject({
    ok: true,
    data: null,
  });
  expect(fake.sent.at(-1)?.search.get('parent')).toBe('root');
  expect(fake.sent.at(-1)?.search.get('limit')).toBe('200');
});

it('follows the pages of a prefix search until the names run past the one looked for', async () => {
  const fake = fakeTransport({
    [`GET ${G}`]: (request) =>
      json(
        request.search.get('cursor') === null
          ? { items: [ENGINEERING], next: 'c1' }
          : { items: [OPS] },
      )(request),
  });
  expect(await findGroup(fake.transport.gateway, 'acme', 'Engineering-Ops', null)).toMatchObject({
    ok: true,
    data: OPS,
  });
  expect(fake.sent).toHaveLength(2);
});
