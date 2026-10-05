import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository, TENANT_ADMIN } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adminCapabilitiesOf, hasEnabledHolder } from '#/service/capability-ceiling';
import { listSubjects } from '#/usecase/subjects';
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

type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

interface Api {
  call(
    method: Method,
    tail: string,
    payload?: unknown,
    ifMatch?: string,
  ): Promise<LightMyRequestResponse>;
  id(method: Method, tail: string, payload: unknown): Promise<string>;
  etag(tail: string): Promise<string>;
}

function apiFor(target: AdminFixture, prefix: string, token: string): Api {
  const call = (method: Method, tail: string, payload?: unknown, ifMatch?: string) =>
    target.http.inject({
      method,
      url: `${prefix}${tail}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  return {
    call,
    async id(method, tail, payload) {
      const res = await call(method, tail, payload);
      expect(res.statusCode, res.body).toBeLessThan(300);
      return res.json<{ id: string }>().id;
    },
    async etag(tail) {
      const res = await call('GET', tail);
      const etag = res.headers.etag;
      if (typeof etag !== 'string') throw new Error(`no ETag on GET ${tail}: ${res.body}`);
      return etag;
    },
  };
}

async function capabilityRoleId(
  target: AdminFixture,
  tenantId: string,
  name: string,
): Promise<string> {
  return withTenant(target.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

interface Tenant {
  readonly name: string;
  readonly api: Api;
  readonly tenantAdmin: string;
  subject(): Promise<string>;
  grant(subjectId: string, roleIds: readonly string[]): Promise<void>;
  join(subjectId: string, groupIds: readonly string[]): Promise<void>;
}

// Administered by a system administrator from outside, who is no holder of
// anything in the tenant — so the subjects created here are its only ones.
async function tenant(): Promise<Tenant> {
  const t = await fixture.createTenant(`adm-${newId()}`);
  const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
  const api = apiFor(fixture, `/admin/tenants/${t.name}`, token);
  return {
    name: t.name,
    api,
    tenantAdmin: await capabilityRoleId(fixture, t.id, TENANT_ADMIN),
    subject: () => api.id('POST', '/subjects', { username: `u-${newId()}` }),
    async grant(subjectId, roleIds) {
      const tail = `/subjects/${subjectId}/roles`;
      const res = await api.call('PUT', tail, { role_ids: roleIds }, await api.etag(tail));
      expect(res.statusCode, res.body).toBe(200);
    },
    async join(subjectId, groupIds) {
      const tail = `/subjects/${subjectId}/groups`;
      const res = await api.call('PUT', tail, { group_ids: groupIds }, await api.etag(tail));
      expect(res.statusCode, res.body).toBe(200);
    },
  };
}

function expectLastAdministrator(res: LightMyRequestResponse, capability = TENANT_ADMIN): void {
  expect(res.statusCode, res.body).toBe(409);
  const body = res.json<{ type: string; detail: string }>();
  expect(body.type).toBe('about:blank#last-administrator');
  expect(body.detail).toContain(capability);
}

async function refusedRows(t: Tenant, resourceType: string, resourceId: string) {
  const res = await t.api.call(
    'GET',
    `/audit?resource_type=${resourceType}&resource_id=${resourceId}&outcome=refused`,
  );
  return res.json<{ items: { action: string; detail: { reason?: string } | null }[] }>().items;
}

describe('the last enabled administrator of a tenant cannot be removed', () => {
  it('through the subject’s own roles, with a refused row, and nothing changed', async () => {
    const t = await tenant();
    const x = await t.subject();
    await t.grant(x, [t.tenantAdmin]);

    const tail = `/subjects/${x}/roles`;
    expectLastAdministrator(
      await t.api.call('PUT', tail, { role_ids: [] }, await t.api.etag(tail)),
    );

    const roles = (await t.api.call('GET', tail)).json<{ items: { id: string }[] }>().items;
    expect(roles.map((role) => role.id)).toEqual([t.tenantAdmin]);
    const rows = await refusedRows(t, 'subject', x);
    expect(rows.map((row) => row.action)).toEqual(['subject.roles_set']);
    expect(rows[0]?.detail?.reason).toContain(TENANT_ADMIN);
  });

  it('but can be once another enabled subject holds it', async () => {
    const t = await tenant();
    const [x, y] = [await t.subject(), await t.subject()];
    await t.grant(x, [t.tenantAdmin]);
    await t.grant(y, [t.tenantAdmin]);

    const tail = `/subjects/${x}/roles`;
    const res = await t.api.call('PUT', tail, { role_ids: [] }, await t.api.etag(tail));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('counts no disabled holder as one', async () => {
    const t = await tenant();
    const [x, y] = [await t.subject(), await t.subject()];
    await t.grant(x, [t.tenantAdmin]);
    await t.grant(y, [t.tenantAdmin]);
    expect((await t.api.call('PATCH', `/subjects/${y}`, { enabled: false })).statusCode).toBe(200);

    const tail = `/subjects/${x}/roles`;
    expectLastAdministrator(
      await t.api.call('PUT', tail, { role_ids: [] }, await t.api.etag(tail)),
    );
  });

  it('by disabling or deleting the subject', async () => {
    const t = await tenant();
    const x = await t.subject();
    await t.grant(x, [t.tenantAdmin]);

    expectLastAdministrator(await t.api.call('PATCH', `/subjects/${x}`, { enabled: false }));
    expectLastAdministrator(await t.api.call('DELETE', `/subjects/${x}`));
    expect((await t.api.call('GET', `/subjects/${x}`)).json()).toMatchObject({ enabled: true });
  });

  it('by leaving, emptying, deleting or moving the group it is held through', async () => {
    const t = await tenant();
    const x = await t.subject();
    const parent = await t.api.id('POST', '/groups', { name: `p-${newId()}` });
    const child = await t.api.id('POST', '/groups', { name: `c-${newId()}`, parent_id: parent });
    const rolesTail = `/groups/${parent}/roles`;
    const mapped = await t.api.call(
      'PUT',
      rolesTail,
      { role_ids: [t.tenantAdmin] },
      await t.api.etag(rolesTail),
    );
    expect(mapped.statusCode, mapped.body).toBe(200);
    await t.join(x, [child]);

    const groupsTail = `/subjects/${x}/groups`;
    expectLastAdministrator(
      await t.api.call('PUT', groupsTail, { group_ids: [] }, await t.api.etag(groupsTail)),
    );
    expectLastAdministrator(
      await t.api.call('PUT', rolesTail, { role_ids: [] }, await t.api.etag(rolesTail)),
    );
    expectLastAdministrator(await t.api.call('PATCH', `/groups/${child}`, { parent_id: null }));
    expectLastAdministrator(await t.api.call('DELETE', `/groups/${parent}`));
    expect((await t.api.call('GET', `/groups/${child}`)).statusCode).toBe(200);
  });

  it('by deleting a role that nests it, or the composite that does', async () => {
    const t = await tenant();
    const x = await t.subject();
    const nesting = await t.api.id('POST', '/roles', { name: `n-${newId()}` });
    const added = await t.api.call('POST', `/roles/${nesting}/composites`, {
      child_role_id: t.tenantAdmin,
    });
    expect(added.statusCode, added.body).toBe(204);
    await t.grant(x, [nesting]);

    expectLastAdministrator(
      await t.api.call('DELETE', `/roles/${nesting}/composites/${t.tenantAdmin}`),
    );
    expectLastAdministrator(await t.api.call('DELETE', `/roles/${nesting}`));
    expect((await t.api.call('GET', `/roles/${nesting}`)).statusCode).toBe(200);
  });

  it('by deleting a client whose role nests it', async () => {
    const t = await tenant();
    const x = await t.subject();
    const client = await t.api.id('POST', '/clients', {
      client_id: `c-${newId()}`,
      redirect_uris: ['https://app.example/cb'],
    });
    const nesting = await t.api.id('POST', '/roles', { name: `n-${newId()}`, client_id: client });
    await t.api.call('POST', `/roles/${nesting}/composites`, { child_role_id: t.tenantAdmin });
    await t.grant(x, [nesting]);

    expectLastAdministrator(await t.api.call('DELETE', `/clients/${client}`));
    expect((await t.api.call('GET', `/clients/${client}`)).statusCode).toBe(200);
  });

  it('by two removals at once, of which one is refused', async () => {
    const t = await tenant();
    const [x, y] = [await t.subject(), await t.subject()];
    await t.grant(x, [t.tenantAdmin]);
    await t.grant(y, [t.tenantAdmin]);
    const [xTag, yTag] = [
      await t.api.etag(`/subjects/${x}/roles`),
      await t.api.etag(`/subjects/${y}/roles`),
    ];

    const results = await Promise.all([
      t.api.call('PUT', `/subjects/${x}/roles`, { role_ids: [] }, xTag),
      t.api.call('PUT', `/subjects/${y}/roles`, { role_ids: [] }, yTag),
    ]);

    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
  });
});

describe('the last enabled holder of manage-tenants cannot be removed', () => {
  let own: AdminFixture | undefined;
  beforeAll(async () => {
    own = await startAdminFixture();
  }, 180_000);
  afterAll(async () => {
    await own?.stop();
  });

  it('from the system tenant, where it is what reaches every other one', async () => {
    const target = own;
    if (target === undefined) throw new Error('fixture did not start');
    const token = await target.systemAdminToken(['tenant-admin']);
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const subject = z.object({ sub: z.string() }).parse(payload).sub;
    const api = apiFor(target, '/admin/tenants/system', token);

    const tail = `/subjects/${subject}/roles`;
    expectLastAdministrator(
      await api.call('PUT', tail, { role_ids: [] }, await api.etag(tail)),
      'manage-tenants',
    );
  });
});

describe('GET /admin/tenants/{t}/subjects?capability=', () => {
  it('lists every subject holding it effectively: directly, through a group or a composite', async () => {
    const t = await tenant();
    const [direct, grouped, nested, none] = [
      await t.subject(),
      await t.subject(),
      await t.subject(),
      await t.subject(),
    ];
    await t.grant(direct, [t.tenantAdmin]);
    const group = await t.api.id('POST', '/groups', { name: `g-${newId()}` });
    const manageUsers = await t.api.call('GET', '/roles?limit=200');
    const roleIdOf = (name: string) =>
      manageUsers
        .json<{ items: { id: string; name: string }[] }>()
        .items.find((r) => r.name === name)?.id ?? '';
    const tail = `/groups/${group}/roles`;
    await t.api.call('PUT', tail, { role_ids: [roleIdOf('manage-users')] }, await t.api.etag(tail));
    await t.join(grouped, [group]);
    const nesting = await t.api.id('POST', '/roles', { name: `n-${newId()}` });
    await t.api.call('POST', `/roles/${nesting}/composites`, {
      child_role_id: roleIdOf('view-users'),
    });
    await t.grant(nested, [nesting]);

    const ids = async (query: string) =>
      (await t.api.call('GET', `/subjects?${query}`))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id)
        .sort();

    expect(await ids('capability=view-users')).toEqual([direct, grouped, nested].sort());
    expect(await ids('capability=manage-users')).toEqual([direct, grouped].sort());
    expect(await ids('capability=tenant-admin')).toEqual([direct]);
    expect(await ids('capability=manage-keys&enabled=true')).toEqual([direct]);
    expect(none).not.toBe(direct);
    const counted = await t.api.call('GET', '/subjects/count?capability=view-users');
    expect(counted.json()).toMatchObject({ count: 3 });
  });

  it('refuses a name that is no capability, naming the parameter', async () => {
    const t = await tenant();
    const res = await t.api.call('GET', '/subjects?capability=owner');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('capability');
  });
});

describe('GET /admin/tenants/{t}/subjects?capability=any', () => {
  interface Held {
    name: string;
    direct: boolean;
  }
  interface Item {
    id: string;
    admin_capabilities?: Held[];
  }

  it('lists every holder of any admin capability, each with what it holds and whether directly', async () => {
    const t = await tenant();
    const [full, grouped, nested, none] = [
      await t.subject(),
      await t.subject(),
      await t.subject(),
      await t.subject(),
    ];
    await t.grant(full, [t.tenantAdmin]);
    const roles = (await t.api.call('GET', '/roles?limit=200')).json<{
      items: { id: string; name: string }[];
    }>().items;
    const roleIdOf = (name: string) => roles.find((r) => r.name === name)?.id ?? '';
    const group = await t.api.id('POST', '/groups', { name: `g-${newId()}` });
    const tail = `/groups/${group}/roles`;
    await t.api.call('PUT', tail, { role_ids: [roleIdOf('view-audit')] }, await t.api.etag(tail));
    await t.join(grouped, [group]);
    const nesting = await t.api.id('POST', '/roles', { name: `n-${newId()}` });
    await t.api.call('POST', `/roles/${nesting}/composites`, {
      child_role_id: roleIdOf('manage-users'),
    });
    await t.grant(nested, [nesting, roleIdOf('view-users')]);

    const res = await t.api.call('GET', '/subjects?capability=any&limit=200');
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: Item[] }>().items;
    expect(items.map((item) => item.id).sort()).toEqual([full, grouped, nested].sort());
    expect(items.map((item) => item.id)).not.toContain(none);
    const of = (id: string) =>
      [...(items.find((item) => item.id === id)?.admin_capabilities ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    expect(of(full)).toContainEqual({ name: 'tenant-admin', direct: true });
    expect(of(full)).toContainEqual({ name: 'manage-keys', direct: false });
    expect(of(grouped)).toEqual([{ name: 'view-audit', direct: false }]);
    expect(of(nested)).toEqual([
      { name: 'manage-users', direct: false },
      { name: 'view-users', direct: true },
    ]);

    const counted = await t.api.call('GET', '/subjects/count?capability=any');
    expect(counted.json()).toEqual({ count: 3, capped: false });
  });

  it('carries what is held under every capability filter, and under none of the others', async () => {
    const t = await tenant();
    const x = await t.subject();
    await t.grant(x, [t.tenantAdmin]);
    const filtered = (await t.api.call('GET', '/subjects?capability=manage-keys')).json<{
      items: Item[];
    }>().items;
    expect(filtered[0]?.admin_capabilities).toContainEqual({ name: 'tenant-admin', direct: true });
    const plain = (await t.api.call('GET', '/subjects')).json<{ items: Item[] }>().items;
    expect(plain.find((item) => item.id === x)).not.toHaveProperty('admin_capabilities');
  });
});

describe('the any-capability listing, probed with a foreign tenant_id', () => {
  it('finds no holder, and names nothing held, in another tenant', async () => {
    const page = (tenantId: string) => ({
      limit: 50,
      cursor: undefined,
      cursorKey: Buffer.alloc(32, 7),
      tenantId,
      filters: { capability: 'any' as const },
      now: fixture.clock.now(),
    });
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const client = await clientRepository(tx).create({
          tenantId,
          clientId: ADMIN_CLIENT_ID,
          name: 'admin',
          type: 'public',
          secretHash: null,
        });
        const role = await roleRepository(tx).create({
          tenantId,
          name: 'view-audit',
          clientId: client.id,
        });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await roleRepository(tx).assignToSubject(subject.id, role.id);
        return { tenantId, subject: subject.id };
      },
      verifySeeded: async (tx, seeded) => {
        const outcome = await listSubjects(tx, page(seeded.tenantId));
        expect(outcome.kind === 'ok' ? outcome.items.map((item) => item.id) : []).toEqual([
          seeded.subject,
        ]);
        expect(await adminCapabilitiesOf(tx, [seeded.subject])).toEqual(
          new Map([[seeded.subject, [{ name: 'view-audit', direct: true }]]]),
        );
      },
      attempt: async (tx, seeded) => ({
        listed: await listSubjects(tx, page(newId())),
        held: await adminCapabilitiesOf(tx, [seeded.subject]),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({
          listed: { kind: 'ok', items: [], next: null },
          held: new Map(),
        });
      },
    });
  });
});

describe('hasEnabledHolder, probed with a foreign tenant_id', () => {
  it('sees no holder across tenants', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const client = await clientRepository(tx).create({
          tenantId,
          clientId: ADMIN_CLIENT_ID,
          name: 'admin',
          type: 'public',
          secretHash: null,
        });
        const role = await roleRepository(tx).create({
          tenantId,
          name: TENANT_ADMIN,
          clientId: client.id,
        });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await roleRepository(tx).assignToSubject(subject.id, role.id);
      },
      verifySeeded: async (tx) => {
        expect(await hasEnabledHolder(tx, TENANT_ADMIN)).toBe(true);
      },
      attempt: (tx) => hasEnabledHolder(tx, TENANT_ADMIN),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});
