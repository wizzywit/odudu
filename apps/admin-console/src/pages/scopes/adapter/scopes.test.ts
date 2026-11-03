import { expect, it } from 'vitest';
// scope-list.json and builtins.json are composed from real rows of two tenants:
// the transcript prints only jq projections of those two answers.
import builtins from '#/pages/scopes/adapter/fixtures/builtins.json';
import impact from '#/pages/scopes/adapter/fixtures/impact.json';
import mappers from '#/pages/scopes/adapter/fixtures/mappers.json';
import restored from '#/pages/scopes/adapter/fixtures/restored.json';
import clients from '#/pages/scopes/adapter/fixtures/scope-clients.json';
import list from '#/pages/scopes/adapter/fixtures/scope-list.json';
import scopeRoles from '#/pages/scopes/adapter/fixtures/scope-roles.json';
import detail from '#/pages/scopes/adapter/fixtures/scope.json';
import {
  deleteScope,
  findScope,
  readBuiltinScopes,
  readScope,
  readScopeClients,
  readScopeImpact,
  readScopeMappers,
  readScopeRoles,
  restoreBuiltinScopes,
  setScopeMappers,
  setScopeRoles,
} from '#/pages/scopes/adapter/scopes';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const S = `${ACME_ADMIN}/scopes`;
const [, BILLING] = list.items;

it('finds a scope by its exact name among the ones that start with it, in one full page', async () => {
  const fake = fakeTransport({ [`GET ${S}`]: json(list) });
  const gateway = fake.transport.gateway;
  expect(await findScope(gateway, 'acme', 'billing')).toMatchObject({ ok: true, data: BILLING });
  expect(fake.sent[0]?.search.toString()).toBe('name=billing&limit=200');
  expect(await findScope(gateway, 'acme', 'nobody')).toMatchObject({ ok: true, data: null });
});

it('passes a refusal through', async () => {
  const fake = fakeTransport({ [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden') });
  expect(await findScope(fake.transport.gateway, 'acme', 'orders')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});

it('reads a scope by its id', async () => {
  const fake = fakeTransport({ [`GET ${S}/${detail.id}`]: json(detail) });
  expect(await readScope(fake.transport.gateway, 'acme', detail.id)).toMatchObject({
    ok: true,
    data: detail,
  });
});

it('deletes a scope naming it again, as the server asks of a built-in one', async () => {
  const fake = fakeTransport({
    [`DELETE ${S}/${detail.id}`]: () => new Response(null, { status: 204 }),
  });
  expect(await deleteScope(fake.transport.gateway, 'acme', detail.id, detail.name)).toMatchObject({
    ok: true,
  });
  expect(fake.sent[0]?.search.toString()).toBe('confirm=roles');
});

it('reads what a deletion would take, the built-ins a tenant has and restores the missing ones', async () => {
  const fake = fakeTransport({
    [`GET ${S}/${detail.id}/impact`]: json(impact),
    [`GET ${S}/builtins`]: json(builtins),
    [`POST ${S}/restore-builtins`]: json(restored),
  });
  const gateway = fake.transport.gateway;
  expect(await readScopeImpact(gateway, 'acme', detail.id)).toMatchObject({
    ok: true,
    data: impact,
  });
  expect(await readBuiltinScopes(gateway, 'acme')).toMatchObject({ ok: true, data: builtins });
  expect(await restoreBuiltinScopes(gateway, 'acme')).toMatchObject({ ok: true, data: restored });
});

it('reads the clients that carry a scope, a page at a time', async () => {
  const fake = fakeTransport({ [`GET ${S}/${detail.id}/clients`]: json(clients) });
  expect(
    await readScopeClients(
      fake.transport.gateway,
      'acme',
      detail.id,
      new URLSearchParams({ limit: '1' }),
    ),
  ).toMatchObject({ ok: true, data: clients });
  expect(fake.sent[0]?.search.get('limit')).toBe('1');
});

it('replaces the mapped roles and the claim mappers on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${S}/${detail.id}/roles`]: json(scopeRoles),
    [`PUT ${S}/${detail.id}/roles`]: json(scopeRoles),
    [`GET ${S}/${detail.id}/mappers`]: json(mappers),
    [`PUT ${S}/${detail.id}/mappers`]: json(mappers),
  });
  const gateway = fake.transport.gateway;
  const roleIds = scopeRoles.items.map((role) => role.id);
  expect(await readScopeRoles(gateway, 'acme', detail.id)).toMatchObject({
    ok: true,
    data: scopeRoles,
  });
  expect(await setScopeRoles(gateway, 'acme', detail.id, roleIds, '"r1"')).toMatchObject({
    ok: true,
    data: scopeRoles,
  });
  expect(fake.sent.at(-1)).toMatchObject({ body: { role_ids: roleIds }, ifMatch: '"r1"' });
  expect(await readScopeMappers(gateway, 'acme', detail.id)).toMatchObject({
    ok: true,
    data: mappers,
  });
  expect(await setScopeMappers(gateway, 'acme', detail.id, ['sub'], '"m1"')).toMatchObject({
    ok: true,
    data: mappers,
  });
  expect(fake.sent.at(-1)).toMatchObject({ body: { mapper_names: ['sub'] }, ifMatch: '"m1"' });
});
