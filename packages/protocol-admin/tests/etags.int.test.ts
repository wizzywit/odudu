import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { etagOf } from '#/service/etag';
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

type Method = 'DELETE' | 'GET' | 'POST' | 'PUT';

interface Caller {
  readonly tenant: string;
  call(
    method: Method,
    tail: string,
    payload?: unknown,
    ifMatch?: string,
  ): Promise<LightMyRequestResponse>;
}

function callerWith(tenant: string, token: string, prefix: string): Caller {
  return {
    tenant,
    call: (method, tail, payload, ifMatch) =>
      fixture.http.inject({
        method,
        url: `${prefix}${tail}`,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
        },
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      }),
  };
}

async function tenantCaller(): Promise<Caller> {
  const t = await fixture.createTenant(`et-${newId()}`);
  const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
  return callerWith(t.name, token, `/admin/tenants/${t.name}`);
}

function etagHeader(res: LightMyRequestResponse): string {
  const etag = res.headers.etag;
  if (typeof etag !== 'string') throw new Error(`no ETag on ${String(res.statusCode)} ${res.body}`);
  return etag;
}

const STALE = '"0000000000000000000000000000000000000000000000000000000000000000"';

describe('a create answers the ETag its record reads back with', () => {
  const cases: readonly {
    readonly route: string;
    readonly tail: string;
    readonly body: () => unknown;
    readonly read?: (id: string) => string;
    readonly listed?: string;
  }[] = [
    {
      route: 'POST /admin/tenants/:tenant/subjects',
      tail: '/subjects',
      body: () => ({ username: `u-${newId()}` }),
      read: (id) => `/subjects/${id}`,
    },
    {
      route: 'POST /admin/tenants/:tenant/clients',
      tail: '/clients',
      body: () => ({ client_id: `c-${newId()}`, redirect_uris: ['https://app.example/cb'] }),
      read: (id) => `/clients/${id}`,
    },
    {
      route: 'POST /admin/tenants/:tenant/roles',
      tail: '/roles',
      body: () => ({ name: `r-${newId()}` }),
      read: (id) => `/roles/${id}`,
    },
    {
      route: 'POST /admin/tenants/:tenant/groups',
      tail: '/groups',
      body: () => ({ name: `g-${newId()}` }),
      read: (id) => `/groups/${id}`,
    },
    {
      route: 'POST /admin/tenants/:tenant/scopes',
      tail: '/scopes',
      body: () => ({ name: `s-${newId()}` }),
      read: (id) => `/scopes/${id}`,
    },
    {
      route: 'POST /admin/tenants/:tenant/keys',
      tail: '/keys',
      body: () => ({ alg: 'ES256' }),
      listed: '/keys',
    },
    {
      route: 'POST /admin/tenants/:tenant/registration-tokens',
      tail: '/registration-tokens',
      body: () => ({ uses: 1, ttl_seconds: 3600 }),
      listed: '/registration-tokens',
    },
  ];

  const SYSTEM_CREATES = ['POST /admin/tenants', 'POST /admin/tenant-imports'];
  // Issues a one-time password and creates no record to read back.
  const EXEMPT = ['POST /admin/tenants/:tenant/subjects/:id/password'];

  it('covers every route that creates something', () => {
    const creates = ADMIN_ROUTES.filter((route) => route.successStatus === 201)
      .map((route) => `${route.method} ${route.pattern}`)
      .filter((key) => !EXEMPT.includes(key));
    expect(creates.sort()).toEqual([...cases.map((c) => c.route), ...SYSTEM_CREATES].sort());
  });

  // A record with no read of its own is compared with its entry in the list
  // that reads it, which never carries a secret shown once.
  it.each(cases)('$route', async ({ tail, body, read, listed }) => {
    const caller = await tenantCaller();
    const created = await caller.call('POST', tail, body());
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const etag = etagHeader(created);
    if (read !== undefined) {
      expect(etag).toBe(etagHeader(await caller.call('GET', read(id))));
    }
    if (listed !== undefined) {
      const items = (await caller.call('GET', listed)).json<{ items: { id: string }[] }>().items;
      expect(etag).toBe(etagOf(items.find((item) => item.id === id)));
    }
  });

  it('POST /admin/tenants and POST /admin/tenant-imports', async () => {
    const system = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const caller = callerWith('system', system, '/admin');
    const name = `et-${newId()}`;
    const created = await caller.call('POST', '/tenants', { name });
    expect(created.statusCode, created.body).toBe(201);
    expect(etagHeader(created)).toBe(etagHeader(await caller.call('GET', `/tenants/${name}`)));

    const exported = await caller.call('GET', `/tenants/${name}/export`);
    expect(exported.statusCode, exported.body).toBe(200);
    const copy = `et-${newId()}`;
    const imported = await caller.call('POST', '/tenant-imports', {
      name: copy,
      document: exported.json<unknown>(),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(etagHeader(imported)).toBe(etagHeader(await caller.call('GET', `/tenants/${copy}`)));
  });
});

describe('a scope assignment answers the client’s new ETag', () => {
  it('on assigning and on unassigning', async () => {
    const caller = await tenantCaller();
    const client = (
      await caller.call('POST', '/clients', {
        client_id: `c-${newId()}`,
        redirect_uris: ['https://app.example/cb'],
      })
    ).json<{ id: string }>().id;
    const scope = (await caller.call('POST', '/scopes', { name: `s-${newId()}` })).json<{
      id: string;
    }>().id;
    const before = etagHeader(await caller.call('GET', `/clients/${client}`));

    const assigned = await caller.call('PUT', `/scopes/${scope}/clients/${client}`, {
      assignment: 'optional',
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const afterAssign = etagHeader(await caller.call('GET', `/clients/${client}`));
    expect(afterAssign).not.toBe(before);
    expect(etagHeader(assigned)).toBe(afterAssign);

    const unassigned = await caller.call('DELETE', `/scopes/${scope}/clients/${client}`);
    expect(unassigned.statusCode, unassigned.body).toBe(204);
    expect(etagHeader(unassigned)).toBe(etagHeader(await caller.call('GET', `/clients/${client}`)));
  });
});

describe('SMTP answers an ETag and honours If-Match when given', () => {
  const config = { host: 'smtp.example', port: 587, from_address: 'noreply@example.com' };

  it('answers the ETag a later read answers, and 412s a stale one', async () => {
    const caller = await tenantCaller();
    const empty = await caller.call('GET', '/smtp');
    const put = await caller.call('PUT', '/smtp', config, etagHeader(empty));
    expect(put.statusCode, put.body).toBe(200);
    expect(etagHeader(put)).toBe(etagHeader(await caller.call('GET', '/smtp')));

    const stale = await caller.call('PUT', '/smtp', { ...config, port: 2525 }, STALE);
    expect(stale.statusCode, stale.body).toBe(412);
    expect((await caller.call('GET', '/smtp')).json<{ port: number }>().port).toBe(587);

    const unconditional = await caller.call('PUT', '/smtp', { ...config, port: 2525 });
    expect(unconditional.statusCode, unconditional.body).toBe(200);
  });
});

describe('signing key writes answer an ETag and honour If-Match when given', () => {
  it('promotes and retires only the key the caller last saw', async () => {
    const caller = await tenantCaller();
    const created = await caller.call('POST', '/keys', { alg: 'RS256' });
    const id = created.json<{ id: string }>().id;

    const stale = await caller.call('POST', `/keys/${id}/promote`, undefined, STALE);
    expect(stale.statusCode, stale.body).toBe(412);

    const promoted = await caller.call(
      'POST',
      `/keys/${id}/promote`,
      undefined,
      etagHeader(created),
    );
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(etagHeader(promoted)).toBe(etagOf(promoted.json()));

    const second = await caller.call('POST', '/keys', { alg: 'RS256' });
    const secondId = second.json<{ id: string }>().id;
    await caller.call('POST', `/keys/${secondId}/promote`, undefined, etagHeader(second));

    const staleRetire = await caller.call(
      'POST',
      `/keys/${id}/retire`,
      undefined,
      etagHeader(promoted),
    );
    expect(staleRetire.statusCode, staleRetire.body).toBe(412);

    const retired = await caller.call('POST', `/keys/${id}/retire`);
    expect(retired.statusCode, retired.body).toBe(200);
    expect(etagHeader(retired)).toBe(etagOf(retired.json()));
  });
});

describe('composite writes answer an ETag and honour If-Match when given', () => {
  it('adds and removes an edge against the composites the caller last read', async () => {
    const caller = await tenantCaller();
    const parent = (await caller.call('POST', '/roles', { name: `p-${newId()}` })).json<{
      id: string;
    }>().id;
    const child = (await caller.call('POST', '/roles', { name: `c-${newId()}` })).json<{
      id: string;
    }>().id;
    const listed = await caller.call('GET', `/roles/${parent}/composites`);
    const empty = etagHeader(listed);

    const stale = await caller.call(
      'POST',
      `/roles/${parent}/composites`,
      { child_role_id: child },
      STALE,
    );
    expect(stale.statusCode, stale.body).toBe(412);

    const added = await caller.call(
      'POST',
      `/roles/${parent}/composites`,
      { child_role_id: child },
      empty,
    );
    expect(added.statusCode, added.body).toBe(204);
    const withChild = etagHeader(await caller.call('GET', `/roles/${parent}/composites`));
    expect(etagHeader(added)).toBe(withChild);

    const staleRemove = await caller.call(
      'DELETE',
      `/roles/${parent}/composites/${child}`,
      undefined,
      empty,
    );
    expect(staleRemove.statusCode, staleRemove.body).toBe(412);

    const removed = await caller.call(
      'DELETE',
      `/roles/${parent}/composites/${child}`,
      undefined,
      withChild,
    );
    expect(removed.statusCode, removed.body).toBe(204);
    expect(etagHeader(removed)).toBe(empty);
  });
});
