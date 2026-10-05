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
} from '#/features/roles/adapter/roles.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const R = '/console/api/admin/tenants/acme/roles';

function role(id: string, name: string, clientKey: string | null = null) {
  return {
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    admin_reach: [],
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

const AUDITOR = role('r-aud', 'auditor');
const READER = role('r-read', 'reader');

function noContent(etag: string) {
  return () => new Response(null, { status: 204, headers: { etag } });
}

it('lists and counts roles by the query given', async () => {
  const fake = fakeTransport({
    [`GET ${R}`]: json({ items: [AUDITOR] }),
    [`GET ${R}/count`]: json({ count: 1, capped: false }),
  });
  const gateway = fake.transport.gateway;
  expect(
    await readRolePage(gateway, 'acme', new URLSearchParams({ client: 'tenant' })),
  ).toMatchObject({ ok: true, data: { items: [AUDITOR] } });
  expect(fake.sent.at(-1)?.search.get('client')).toBe('tenant');
  await readRoleCount(gateway, 'acme', new URLSearchParams({ name: 'a' }));
  expect(fake.sent.at(-1)?.search.get('name')).toBe('a');
});

it('creates a tenant role, with a description only when given', async () => {
  const fake = fakeTransport({ [`POST ${R}`]: json(AUDITOR, 201) });
  const gateway = fake.transport.gateway;
  await createRole(gateway, 'acme', { name: 'auditor', description: '' });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'auditor' });
  await createRole(gateway, 'acme', { name: 'auditor', description: 'Reads the books' });
  expect(fake.sent.at(-1)?.body).toEqual({ name: 'auditor', description: 'Reads the books' });
});

it('reads, amends, marks and deletes a role, each write on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${R}/r-aud`]: json(AUDITOR, 200, { etag: '"a1"' }),
    [`PATCH ${R}/r-aud`]: json(AUDITOR, 200, { etag: '"a2"' }),
    [`PUT ${R}/r-aud/default`]: json(AUDITOR, 200, { etag: '"a3"' }),
    [`DELETE ${R}/r-aud`]: () => new Response(null, { status: 204 }),
  });
  const gateway = fake.transport.gateway;
  expect(await readRole(gateway, 'acme', 'r-aud')).toMatchObject({ ok: true, etag: '"a1"' });
  await amendRole(gateway, 'acme', 'r-aud', { description: null }, '"a1"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { description: null }, ifMatch: '"a1"' });
  await setRoleDefault(gateway, 'acme', 'r-aud', true, '"a2"');
  expect(fake.sent.at(-1)).toMatchObject({ body: { default: true }, ifMatch: '"a2"' });
  expect(await deleteRole(gateway, 'acme', 'r-aud')).toMatchObject({ ok: true });
});

it("reads a role's composites and changes them one edge at a time, on their ETag", async () => {
  const fake = fakeTransport({
    [`GET ${R}/r-aud/composites`]: json({ items: [READER] }, 200, { etag: '"c1"' }),
    [`POST ${R}/r-aud/composites`]: noContent('"c2"'),
    [`DELETE ${R}/r-aud/composites/r-read`]: noContent('"c3"'),
  });
  const gateway = fake.transport.gateway;
  expect(await readComposites(gateway, 'acme', 'r-aud')).toMatchObject({
    ok: true,
    etag: '"c1"',
    data: { items: [READER] },
  });
  expect(await addComposite(gateway, 'acme', 'r-aud', 'r-read', '"c1"')).toMatchObject({
    ok: true,
    etag: '"c2"',
  });
  expect(fake.sent.at(-1)).toMatchObject({ body: { child_role_id: 'r-read' }, ifMatch: '"c1"' });
  await addComposite(gateway, 'acme', 'r-aud', 'r-read', null);
  expect(fake.sent.at(-1)?.ifMatch).toBeNull();
  expect(await removeComposite(gateway, 'acme', 'r-aud', 'r-read', '"c2"')).toMatchObject({
    ok: true,
    etag: '"c3"',
  });
  expect(fake.sent.at(-1)?.ifMatch).toBe('"c2"');
});

it('finds a tenant role by its exact name, for a creation whose answer was lost', async () => {
  const fake = fakeTransport({
    [`GET ${R}`]: json({ items: [role('r-x', 'auditors'), AUDITOR] }),
  });
  const gateway = fake.transport.gateway;
  expect(await findRole(gateway, 'acme', 'auditor')).toMatchObject({ ok: true, data: AUDITOR });
  expect(fake.sent.at(-1)?.search.get('client')).toBe('tenant');
  expect(await findRole(gateway, 'acme', 'nobody')).toMatchObject({ ok: true, data: null });
});
