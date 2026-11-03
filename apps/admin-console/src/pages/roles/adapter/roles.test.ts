import { expect, it } from 'vitest';
import {
  addComposite,
  amendRole,
  createRole,
  deleteRole,
  findRole,
  readComposites,
  readRole,
  readRoleCount,
  readRolePage,
  removeComposite,
  setRoleDefault,
} from '#/pages/roles/adapter/roles';
import composites from '#/pages/roles/adapter/fixtures/role-composites.json';
import count from '#/pages/roles/adapter/fixtures/role-count.json';
import list from '#/pages/roles/adapter/fixtures/role-list.json';
import bundle from '#/pages/roles/adapter/fixtures/role.json';
import { fakeTransport, json } from '#/testing/fakeTransport';

const R = '/console/api/admin/tenants/acme/roles';

const BUNDLE = `${R}/${bundle.id}`;
const CHILD = composites.items.at(0)?.id ?? '';
const BILLING_VIEWER = list.items.find((each) => each.name === 'billing-viewer');

function noContent(etag: string) {
  return () => new Response(null, { status: 204, headers: { etag } });
}

it('lists and counts roles by the query given', async () => {
  const fake = fakeTransport({
    [`GET ${R}`]: json(list),
    [`GET ${R}/count`]: json(count),
  });
  const gateway = fake.transport.gateway;
  expect(
    await readRolePage(gateway, 'acme', new URLSearchParams({ client: 'tenant' })),
  ).toMatchObject({ ok: true, data: list });
  expect(fake.sent.at(-1)?.search.get('client')).toBe('tenant');
  expect(
    await readRoleCount(gateway, 'acme', new URLSearchParams({ name: 'billing' })),
  ).toMatchObject({ ok: true, data: count });
  expect(fake.sent.at(-1)?.search.get('name')).toBe('billing');
});

it('creates a tenant role, with a description only when given', async () => {
  const fake = fakeTransport({ [`POST ${R}`]: json(bundle, 201) });
  const gateway = fake.transport.gateway;
  expect(
    await createRole(gateway, 'acme', { name: 'audit-bundle', description: '' }),
  ).toMatchObject({ ok: true, data: bundle });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'audit-bundle' });
  await createRole(gateway, 'acme', { name: 'audit-bundle', description: 'Reads the books' });
  expect(fake.sent.at(-1)?.body).toEqual({
    name: 'audit-bundle',
    description: 'Reads the books',
  });
});

it('reads, amends, marks and deletes a role, each write on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${BUNDLE}`]: json(bundle, 200, { etag: '"a1"' }),
    [`PATCH ${BUNDLE}`]: json(bundle, 200, { etag: '"a2"' }),
    [`PUT ${BUNDLE}/default`]: json(bundle, 200, { etag: '"a3"' }),
    [`DELETE ${BUNDLE}`]: () => new Response(null, { status: 204 }),
  });
  const gateway = fake.transport.gateway;
  expect(await readRole(gateway, 'acme', bundle.id)).toMatchObject({
    ok: true,
    etag: '"a1"',
    data: bundle,
  });
  await amendRole(gateway, 'acme', bundle.id, { description: null }, '"a1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { description: null }, ifMatch: '"a1"' });
  await amendRole(gateway, 'acme', bundle.id, { description: '' }, '"a1"');
  expect(fake.sent.at(-1)?.body).toEqual({ description: null });
  await amendRole(gateway, 'acme', bundle.id, { description: 'Reads' }, '"a1"');
  expect(fake.sent.at(-1)?.body).toEqual({ description: 'Reads' });
  await setRoleDefault(gateway, 'acme', bundle.id, true, '"a2"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { default: true }, ifMatch: '"a2"' });
  expect(await deleteRole(gateway, 'acme', bundle.id)).toMatchObject({ ok: true });
});

it("reads a role's composites and changes them one edge at a time, on their ETag", async () => {
  const fake = fakeTransport({
    [`GET ${BUNDLE}/composites`]: json(composites, 200, { etag: '"c1"' }),
    [`POST ${BUNDLE}/composites`]: noContent('"c2"'),
    [`DELETE ${BUNDLE}/composites/${CHILD}`]: noContent('"c3"'),
  });
  const gateway = fake.transport.gateway;
  expect(await readComposites(gateway, 'acme', bundle.id)).toMatchObject({
    ok: true,
    etag: '"c1"',
    data: composites,
  });
  expect(await addComposite(gateway, 'acme', bundle.id, CHILD, '"c1"')).toMatchObject({
    ok: true,
    etag: '"c2"',
  });
  expect(fake.sent.at(-1)).toMatchObject({ body: { child_role_id: CHILD }, ifMatch: '"c1"' });
  await addComposite(gateway, 'acme', bundle.id, CHILD, null);
  expect(fake.sent.at(-1)?.ifMatch).toBeNull();
  expect(await removeComposite(gateway, 'acme', bundle.id, CHILD, '"c2"')).toMatchObject({
    ok: true,
    etag: '"c3"',
  });
  expect(fake.sent.at(-1)?.ifMatch).toBe('"c2"');
});

it('finds a tenant role by its exact name, for a creation whose answer was lost', async () => {
  const fake = fakeTransport({ [`GET ${R}`]: json(list) });
  const gateway = fake.transport.gateway;
  expect(await findRole(gateway, 'acme', 'billing-viewer')).toMatchObject({
    ok: true,
    data: BILLING_VIEWER,
  });
  expect(fake.sent.at(-1)?.search.get('client')).toBe('tenant');
  expect(fake.sent.at(-1)?.search.get('limit')).toBe('200');
  expect(await findRole(gateway, 'acme', 'billing')).toMatchObject({ ok: true, data: null });
});
