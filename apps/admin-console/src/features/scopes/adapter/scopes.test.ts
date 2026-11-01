import { expect, it } from 'vitest';
import {
  deleteScope,
  findScope,
  readBuiltinScopes,
  readScopeImpact,
  restoreBuiltinScopes,
} from '#/features/scopes/adapter/scopes';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';

const S = '/console/api/admin/tenants/acme/scopes';

function scope(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    include_in_id_token: true,
    include_in_access_token: true,
    default_client_assignment: 'optional',
    consent_text: null,
    description_i18n: {},
    consent_text_i18n: {},
    display_order: 0,
    builtin: false,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

it('finds a scope by its exact name among the ones that start with it, in one full page', async () => {
  const fake = fakeTransport({
    [`GET ${S}`]: json({ items: [scope('s1', 'orders:write'), scope('s2', 'orders')] }),
  });
  const gateway = fake.transport.gateway;
  expect(await findScope(gateway, 'acme', 'orders')).toMatchObject({
    ok: true,
    data: { id: 's2', name: 'orders' },
  });
  expect(fake.sent[0]?.search.toString()).toBe('name=orders&limit=200');
  expect(await findScope(gateway, 'acme', 'nobody')).toMatchObject({ ok: true, data: null });
});

it('passes a refusal through', async () => {
  const fake = fakeTransport({ [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden') });
  expect(await findScope(fake.transport.gateway, 'acme', 'orders')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});

it('deletes a scope naming it again, as the server asks of a built-in one', async () => {
  const fake = fakeTransport({ [`DELETE ${S}/s1`]: () => new Response(null, { status: 204 }) });
  expect(await deleteScope(fake.transport.gateway, 'acme', 's1', 'profile')).toMatchObject({
    ok: true,
  });
  expect(fake.sent[0]?.search.toString()).toBe('confirm=profile');
});

it('reads what a deletion would take, the built-ins a tenant has and restores the missing ones', async () => {
  const fake = fakeTransport({
    [`GET ${S}/s1/impact`]: json({
      builtin: true,
      client_assignments: { count: 2, capped: false },
      role_mappings: { count: 0, capped: false },
    }),
    [`GET ${S}/builtins`]: json({ items: [{ name: 'openid', present: true }] }),
    [`POST ${S}/restore-builtins`]: json({ created: ['roles'] }),
  });
  const gateway = fake.transport.gateway;
  expect(await readScopeImpact(gateway, 'acme', 's1')).toMatchObject({
    ok: true,
    data: { builtin: true, client_assignments: { count: 2 } },
  });
  expect(await readBuiltinScopes(gateway, 'acme')).toMatchObject({
    ok: true,
    data: { items: [{ name: 'openid', present: true }] },
  });
  expect(await restoreBuiltinScopes(gateway, 'acme')).toMatchObject({
    ok: true,
    data: { created: ['roles'] },
  });
});
