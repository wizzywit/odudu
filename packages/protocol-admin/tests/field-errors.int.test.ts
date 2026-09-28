import { MANAGE_TENANTS, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface FieldRefusal {
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

const jsonSchemaShape = z.object({ properties: z.record(z.string(), z.unknown()).optional() });

const ABSENT_ID = '0199aa00-0000-7000-8000-0000000000ff';

function expectFieldRefusal(res: LightMyRequestResponse, path: string, detail?: string): void {
  expect(res.statusCode, res.body).toBe(400);
  const body = res.json<FieldRefusal>();
  expect(
    body.errors?.map((error) => error.path),
    res.body,
  ).toContain(path);
  for (const error of body.errors ?? []) expect(error.message.length).toBeGreaterThan(0);
  if (detail !== undefined) expect(body.detail).toBe(detail);
}

interface Caller {
  readonly tenant: string;
  readonly token: string;
  call(
    method: Method,
    tail: string,
    payload?: unknown,
    ifMatch?: string,
  ): Promise<LightMyRequestResponse>;
  create(tail: string, payload: unknown): Promise<string>;
  etagOf(tail: string): Promise<string>;
}

async function tenantCaller(): Promise<Caller> {
  const t = await fixture.createTenant(`fe-${newId()}`);
  const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
  const call = (method: Method, tail: string, payload?: unknown, ifMatch?: string) =>
    fixture.http.inject({
      method,
      url: `/admin/tenants/${t.name}${tail}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  return {
    tenant: t.name,
    token,
    call,
    async create(tail, payload) {
      const res = await call('POST', tail, payload);
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ id: string }>().id;
    },
    async etagOf(tail) {
      const res = await call('GET', tail);
      expect(res.statusCode, res.body).toBe(200);
      const etag = res.headers.etag;
      if (typeof etag !== 'string') throw new Error(`no ETag on GET ${tail}`);
      return etag;
    },
  };
}

// Every refusal ajv makes names where it was made, so a route validated
// against a schema carries `errors` for free — the matrix below proves
// that holds on every route, not only the ones written out by hand.
describe('a refusal of the request shape names the field', () => {
  const queried = ADMIN_ROUTES.filter((route) => route.querystringSchema !== undefined);

  it.each(queried)('$method $pattern names an unknown query parameter', async (route) => {
    const caller = await tenantCaller();
    const system = await fixture.systemAdminToken([MANAGE_TENANTS]);
    const url = route.pattern.replace(':tenant', caller.tenant).replace(/:(\w+)/gu, ABSENT_ID);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `${url}?unexpected=1`,
      headers: {
        authorization: `Bearer ${route.pattern.includes(':tenant') ? caller.token : system}`,
      },
    });
    expectFieldRefusal(res, 'unexpected');
  });

  const cursored = queried.filter((route: AdminRoute) => {
    const schema = route.querystringSchema;
    if (schema === undefined) return false;
    const json = jsonSchemaShape.parse(z.toJSONSchema(schema));
    return json.properties?.cursor !== undefined;
  });

  // A route under a row reads its cursor only once the row is found, so
  // each is given a real one; a route missing here fails the case below.
  const SEEDED: Readonly<Record<string, (caller: Caller) => Promise<string>>> = {
    '/admin/tenants/:tenant/subjects/:id/sessions': (caller) =>
      caller.create('/subjects', { username: `u-${newId()}` }),
    '/admin/tenants/:tenant/scopes/:id/clients': (caller) =>
      caller.create('/scopes', { name: `s-${newId()}` }),
  };

  it.each(cursored)('$method $pattern names a cursor it cannot read', async (route) => {
    const caller = await tenantCaller();
    const system = await fixture.systemAdminToken([MANAGE_TENANTS]);
    let url = route.pattern.replace(':tenant', caller.tenant);
    if (url.includes(':id')) {
      const seed = SEEDED[route.pattern];
      if (seed === undefined) throw new Error(`no row seeded for ${route.pattern}`);
      url = url.replace(':id', await seed(caller));
    }
    const res = await fixture.http.inject({
      method: 'GET',
      url: `${url}?cursor=not-a-cursor`,
      headers: {
        authorization: `Bearer ${route.pattern.includes(':tenant') ? caller.token : system}`,
      },
    });
    expectFieldRefusal(res, 'cursor', 'cursor is invalid or expired');
  });

  it('names a body value out of its range', async () => {
    const caller = await tenantCaller();
    const res = await caller.call('PUT', '/smtp', {
      host: 'smtp.example',
      port: 70_000,
      from_address: 'noreply@example.com',
    });
    expectFieldRefusal(res, 'port');
  });

  it('names a body property it does not know', async () => {
    const caller = await tenantCaller();
    const res = await caller.call('POST', '/roles', { name: 'r', colour: 'blue' });
    expectFieldRefusal(res, 'colour');
  });
});

describe('a refusal a handler makes names the field', () => {
  it('names the second of two search fields', async () => {
    const caller = await tenantCaller();
    for (const [tail, field] of [
      ['/subjects?username=a&email=b', 'email'],
      ['/subjects/count?username=a&email=b', 'email'],
      ['/clients?client_id=a&name=b', 'name'],
      ['/clients/count?client_id=a&name=b', 'name'],
      ['/audit?resource_id=x', 'resource_id'],
    ] as const) {
      expectFieldRefusal(await caller.call('GET', tail), field);
    }
    const system = await fixture.systemAdminToken([MANAGE_TENANTS]);
    for (const url of [
      '/admin/tenants?name=a&display_name=b',
      '/admin/tenants/count?name=a&display_name=b',
    ]) {
      const res = await fixture.http.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${system}` },
      });
      expectFieldRefusal(res, 'display_name');
    }
  });

  it('names a tenant name it refuses, and a tenant field it will not amend', async () => {
    const system = await fixture.systemAdminToken([MANAGE_TENANTS]);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${system}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Not A Name' }),
    });
    expectFieldRefusal(res, 'name');

    const caller = await tenantCaller();
    expectFieldRefusal(await caller.call('PATCH', '', { name: 'other' }), 'name');
    expectFieldRefusal(await caller.call('PATCH', '', { enabled: 'yes' }), 'enabled');
  });

  it('names what a subject write gets wrong', async () => {
    const caller = await tenantCaller();
    expectFieldRefusal(
      await caller.call('POST', '/subjects', { username: 'u1', email: 'not-an-address' }),
      'email',
    );
    const id = await caller.create('/subjects', { username: 'u2' });
    expectFieldRefusal(await caller.call('PATCH', `/subjects/${id}`, { type: 'service' }), 'type');
    expectFieldRefusal(
      await caller.call('PATCH', `/subjects/${id}`, { enabled: 'yes' }),
      'enabled',
    );
    expectFieldRefusal(
      await caller.call('PATCH', `/subjects/${id}/profile`, { email: 'x@example.com' }),
      'email',
    );
    expectFieldRefusal(
      await caller.call('PATCH', `/subjects/${id}/profile`, { given_name: 5 }),
      'given_name',
    );
    expectFieldRefusal(
      await caller.call('PATCH', `/subjects/${id}/profile`, {
        phone_number: 'not a number',
        phone_number_verified: true,
      }),
      'phone_number',
    );
    const rolesTag = await caller.etagOf(`/subjects/${id}/roles`);
    expectFieldRefusal(
      await caller.call('PUT', `/subjects/${id}/roles`, { role_ids: [ABSENT_ID] }, rolesTag),
      'role_ids',
    );
    const groupsTag = await caller.etagOf(`/subjects/${id}/groups`);
    expectFieldRefusal(
      await caller.call('PUT', `/subjects/${id}/groups`, { group_ids: [ABSENT_ID] }, groupsTag),
      'group_ids',
    );
  });

  it('names what a client write gets wrong', async () => {
    const caller = await tenantCaller();
    expectFieldRefusal(
      await caller.call('POST', '/clients', { client_id: `c-${newId()}`, redirect_uris: ['nope'] }),
      'redirect_uris',
    );
    expectFieldRefusal(
      await caller.call('POST', '/clients', {
        client_id: `c-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
        registration_origin: 'admin',
      }),
      'registration_origin',
    );
    const id = await caller.create('/clients', {
      client_id: `c-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
    });
    expectFieldRefusal(
      await caller.call('PATCH', `/clients/${id}`, { client_id: 'x' }),
      'client_id',
    );
    expectFieldRefusal(await caller.call('PATCH', `/clients/${id}`, { enabled: 'yes' }), 'enabled');
    expectFieldRefusal(
      await caller.call('PATCH', `/clients/${id}`, { frontchannel_logout_uri: 'http://x' }),
      'frontchannel_logout_uri',
    );
  });

  it('names what a role, group or scope write gets wrong', async () => {
    const caller = await tenantCaller();
    expectFieldRefusal(
      await caller.call('POST', '/roles', { name: 'r', client_id: ABSENT_ID }),
      'client_id',
    );
    const role = await caller.create('/roles', { name: `r-${newId()}` });
    expectFieldRefusal(await caller.call('PATCH', `/roles/${role}`, { name: 'x' }), 'name');
    expectFieldRefusal(
      await caller.call('PATCH', `/roles/${role}`, { description: 5 }),
      'description',
    );
    expectFieldRefusal(
      await caller.call('POST', `/roles/${role}/composites`, { child_role_id: ABSENT_ID }),
      'child_role_id',
    );

    expectFieldRefusal(
      await caller.call('POST', '/groups', { name: 'g', parent_id: ABSENT_ID }),
      'parent_id',
    );
    const group = await caller.create('/groups', { name: `g-${newId()}` });
    expectFieldRefusal(
      await caller.call('PATCH', `/groups/${group}`, { parent_id: ABSENT_ID }),
      'parent_id',
    );
    expectFieldRefusal(await caller.call('PATCH', `/groups/${group}`, { name: 'x' }), 'name');
    expectFieldRefusal(
      await caller.call('PATCH', `/groups/${group}`, { parent_id: 5 }),
      'parent_id',
    );
    const groupRolesTag = await caller.etagOf(`/groups/${group}/roles`);
    expectFieldRefusal(
      await caller.call('PUT', `/groups/${group}/roles`, { role_ids: [ABSENT_ID] }, groupRolesTag),
      'role_ids',
    );

    const scope = await caller.create('/scopes', { name: `s-${newId()}` });
    expectFieldRefusal(await caller.call('PATCH', `/scopes/${scope}`, { name: 'x' }), 'name');
    expectFieldRefusal(
      await caller.call('PATCH', `/scopes/${scope}`, { description: 5 }),
      'description',
    );
    const scopeRolesTag = await caller.etagOf(`/scopes/${scope}/roles`);
    expectFieldRefusal(
      await caller.call('PUT', `/scopes/${scope}/roles`, { role_ids: [ABSENT_ID] }, scopeRolesTag),
      'role_ids',
    );
    const mappersTag = await caller.etagOf(`/scopes/${scope}/mappers`);
    expectFieldRefusal(
      await caller.call('PUT', `/scopes/${scope}/mappers`, { mapper_names: ['nope'] }, mappersTag),
      'mapper_names',
    );
  });

  it('names what a settings, SMTP or flow write gets wrong', async () => {
    const caller = await tenantCaller();
    expectFieldRefusal(
      await caller.call('PATCH', '/settings', { not_a_setting: true }),
      'not_a_setting',
    );
    expectFieldRefusal(
      await caller.call('PATCH', '/settings', { verify_email: 'yes' }),
      'verify_email',
    );

    const smtp = { host: 'smtp.example', port: 587, from_address: 'noreply@example.com' };
    expectFieldRefusal(
      await caller.call('PUT', '/smtp', { ...smtp, password: 'x'.repeat(10_000), starttls: true }),
      'password',
    );
    expectFieldRefusal(
      await caller.call('PUT', '/smtp', { ...smtp, username: 'mailer', starttls: false }),
      'starttls',
    );

    const flowTag = await caller.etagOf('/flow/executions');
    expectFieldRefusal(
      await caller.call(
        'PUT',
        '/flow/executions',
        [
          { authenticator: 'password', requirement: 'required' },
          { authenticator: 'carrier-pigeon', requirement: 'required' },
        ],
        flowTag,
      ),
      '[1].authenticator',
    );
    expectFieldRefusal(
      await caller.call(
        'PUT',
        '/flow/executions',
        [
          { authenticator: 'password', requirement: 'required' },
          { authenticator: 'password', requirement: 'alternative' },
        ],
        flowTag,
      ),
      '[1].authenticator',
    );
  });
});
