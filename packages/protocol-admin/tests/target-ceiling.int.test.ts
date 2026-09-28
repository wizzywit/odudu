import { requiredActionRepository } from '@odudu/authn-flows';
import { generateTotpSecret } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { groupRepository, roleRepository, subjectRoles } from '@odudu/domain-authz';
import {
  credentialRepository,
  loginFailureRepository,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clientScopeRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
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

interface Target {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly subjectId: string;
  readonly credentialId: string;
}

// A user subject holding `roleNames` on its tenant's built-in admin client,
// with something for every mutating route to change: a TOTP credential, a
// group membership, a nickname and a run of failed logins.
async function createTarget(
  tenant: { id: string; name: string },
  roleNames: readonly string[],
): Promise<Target> {
  const { id: subjectId } = await fixture.createSubject(tenant.name, `target-${newId()}`);
  const credentialId = await withTenant(fixture.app.db, tenant.id, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: no built-in admin client');
    for (const name of roleNames) {
      const role = await roleRepository(tx).byName(name, adminClient.id);
      if (role === null) throw new Error(`fixture: no admin-client role ${name}`);
      await roleRepository(tx).assignToSubject(subjectId, role.id);
    }
    await credentialRepository(tx).insert({
      tenantId: tenant.id,
      subjectId,
      type: 'totp',
      secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
    });
    const group = await groupRepository(tx).create({
      tenantId: tenant.id,
      name: `g-${newId()}`,
      parentId: null,
    });
    await groupRepository(tx).addToSubject(subjectId, group.id);
    await userRepository(tx).updateProfile(subjectId, { nickname: 'before' });
    await tx.execute(sql`
      INSERT INTO login_failures
        (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at, locked_until)
      VALUES (${tenant.id}, ${subjectId}, 5, now(), now(), now() + interval '1 minute')
    `);
    const [row] = await credentialRepository(tx).listFor(subjectId, 'totp');
    if (row === undefined) throw new Error('fixture: no totp credential after insert');
    return row.id;
  });
  return { tenantId: tenant.id, tenantName: tenant.name, subjectId, credentialId };
}

type Operation = 'password' | 'amend' | 'credential' | 'delete';

const ACTION: Record<Operation, string> = {
  password: 'subject.password_issue',
  amend: 'subject.amend',
  credential: 'subject.credential_delete',
  delete: 'subject.delete',
};

function perform(
  operation: Operation,
  target: Target,
  token: string,
): Promise<LightMyRequestResponse> {
  const base = `/admin/tenants/${target.tenantName}/subjects/${target.subjectId}`;
  const authorization = `Bearer ${token}`;
  switch (operation) {
    case 'password':
      return fixture.http.inject({
        method: 'POST',
        url: `${base}/password`,
        headers: { authorization },
      });
    case 'amend':
      return fixture.http.inject({
        method: 'PATCH',
        url: base,
        headers: { authorization, 'content-type': 'application/json' },
        payload: { enabled: false },
      });
    case 'credential':
      return fixture.http.inject({
        method: 'DELETE',
        url: `${base}/credentials/${target.credentialId}`,
        headers: { authorization },
      });
    case 'delete':
      return fixture.http.inject({ method: 'DELETE', url: base, headers: { authorization } });
  }
}

interface TargetState {
  readonly roles: readonly string[];
  readonly groups: readonly string[];
  readonly nickname: string | null;
  readonly failureCount: number;
  readonly exists: boolean;
  readonly enabled: boolean;
  readonly credentials: number;
  readonly actions: readonly string[];
}

async function stateOf(target: Target): Promise<TargetState> {
  return withTenant(fixture.app.db, target.tenantId, async (tx) => {
    const subject = await subjectRepository(tx).byId(target.subjectId);
    const user = await userRepository(tx).bySubjectId(target.subjectId);
    return {
      roles: (
        await tx
          .select({ roleId: subjectRoles.roleId })
          .from(subjectRoles)
          .where(eq(subjectRoles.subjectId, target.subjectId))
      ).map((row) => row.roleId),
      groups: (await groupRepository(tx).groupsOfSubject(target.subjectId)).map((g) => g.id),
      nickname: user?.nickname ?? null,
      failureCount: (await loginFailureRepository(tx).forSubject(target.subjectId)).failureCount,
      exists: subject !== null && user !== null,
      enabled: subject?.disabledAt === null,
      credentials: (await credentialRepository(tx).listFor(target.subjectId, 'totp')).length,
      actions: await requiredActionRepository(tx).pendingFor(target.subjectId),
    };
  });
}

const OPERATIONS: readonly Operation[] = ['password', 'amend', 'credential', 'delete'];

describe('an operation that can take over or remove an account', () => {
  it.each(OPERATIONS)(
    '%s: refuses manage-users alone against a tenant-admin, changing nothing',
    async (operation) => {
      const t = await fixture.createTenant(`ceiling-${newId()}`);
      const target = await createTarget(t, [TENANT_ADMIN]);
      const before = await stateOf(target);

      const res = await perform(
        operation,
        target,
        await fixture.adminToken(t.name, ['manage-users']),
      );

      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toContain('manage-tenant');
      expect(await stateOf(target)).toEqual(before);
      const rows = await withTenant(fixture.app.db, t.id, (tx) =>
        auditRepository(tx).list({ limit: 50 }),
      );
      const refused = rows.filter(
        (row) => row.action === ACTION[operation] && row.resourceId === target.subjectId,
      );
      expect(refused).toHaveLength(1);
      expect(refused[0]?.outcome).toBe('refused');
      const denied = (refused[0]?.detail as { denied?: string[] } | null)?.denied ?? [];
      expect(denied).toContain('manage-tenant');
      expect(denied).not.toContain('manage-users');
    },
  );

  it.each(OPERATIONS)('%s: admits a tenant-admin acting on a tenant-admin', async (operation) => {
    const t = await fixture.createTenant(`ceiling-peer-${newId()}`);
    const target = await createTarget(t, [TENANT_ADMIN]);

    const res = await perform(operation, target, await fixture.adminToken(t.name, [TENANT_ADMIN]));

    expect(res.statusCode).toBeLessThan(300);
  });

  it.each(OPERATIONS)(
    '%s: admits a system admin whose capabilities cover the target’s',
    async (operation) => {
      const t = await fixture.createTenant(`ceiling-system-${newId()}`);
      const target = await createTarget(t, ['manage-users']);

      const token = await fixture.systemAdminToken([MANAGE_TENANTS, 'manage-users']);
      const res = await perform(operation, target, token);

      expect(res.statusCode).toBeLessThan(300);
    },
  );

  it.each(OPERATIONS)(
    '%s: refuses a system admin lacking a capability the target holds',
    async (operation) => {
      const t = await fixture.createTenant(`ceiling-system-short-${newId()}`);
      const target = await createTarget(t, ['view-audit']);

      const token = await fixture.systemAdminToken([MANAGE_TENANTS, 'manage-users']);
      const res = await perform(operation, target, token);

      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toContain('view-audit');
    },
  );

  it.each(OPERATIONS)('%s: admits manage-users on a subject holding no capability', async (op) => {
    const t = await fixture.createTenant(`ceiling-plain-${newId()}`);
    const target = await createTarget(t, []);

    const res = await perform(op, target, await fixture.adminToken(t.name, ['manage-users']));

    expect(res.statusCode).toBeLessThan(300);
  });

  it('refuses a PATCH that changes nothing, too — every mutation is held to it', async () => {
    const t = await fixture.createTenant(`ceiling-noop-${newId()}`);
    const target = await createTarget(t, [TENANT_ADMIN]);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${target.subjectId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('reads a system-tenant target in the system tenant', async () => {
    const target = await createTarget({ id: fixture.systemTenantId, name: SYSTEM_TENANT_NAME }, [
      MANAGE_TENANTS,
      'manage-users',
      'view-audit',
    ]);
    const token = await fixture.systemAdminToken([MANAGE_TENANTS, 'manage-users']);

    const res = await perform('password', target, token);

    expect(res.statusCode).toBe(403);
    expect(res.json<{ detail: string }>().detail).toContain('view-audit');
  });
});

// Every route that mutates one subject, read from the route table rather
// than listed, so a mutating route added under `/subjects/:id` without the
// ceiling fails here.
const SUBJECT_MUTATIONS = ADMIN_ROUTES.filter(
  (route) =>
    route.method !== 'GET' && route.pattern.startsWith('/admin/tenants/:tenant/subjects/:id'),
).map((route) => `${route.method} ${route.pattern}`);

const REFUSED_ACTION: Readonly<Record<string, string>> = {
  'PATCH /admin/tenants/:tenant/subjects/:id': 'subject.amend',
  'DELETE /admin/tenants/:tenant/subjects/:id': 'subject.delete',
  'PATCH /admin/tenants/:tenant/subjects/:id/profile': 'subject.profile_amend',
  'DELETE /admin/tenants/:tenant/subjects/:id/credentials/:credentialId':
    'subject.credential_delete',
  'DELETE /admin/tenants/:tenant/subjects/:id/consents/:clientId': 'consent.revoke',
  'POST /admin/tenants/:tenant/subjects/:id/password': 'subject.password_issue',
  'DELETE /admin/tenants/:tenant/subjects/:id/lockout': 'subject.lockout_clear',
  'PUT /admin/tenants/:tenant/subjects/:id/required-actions': 'subject.required_actions_set',
  'PUT /admin/tenants/:tenant/subjects/:id/roles': 'subject.roles_set',
  'PUT /admin/tenants/:tenant/subjects/:id/groups': 'subject.groups_set',
  'DELETE /admin/tenants/:tenant/subjects/:id/sessions': 'session.end_all',
  'DELETE /admin/tenants/:tenant/subjects/:id/sessions/:sid': 'session.end',
};

const BODIES: Readonly<Record<string, unknown>> = {
  'PATCH /admin/tenants/:tenant/subjects/:id': { enabled: false },
  'PATCH /admin/tenants/:tenant/subjects/:id/profile': { nickname: 'taken' },
  'PUT /admin/tenants/:tenant/subjects/:id/required-actions': { actions: [] },
  'PUT /admin/tenants/:tenant/subjects/:id/roles': { role_ids: [] },
  'PUT /admin/tenants/:tenant/subjects/:id/groups': { group_ids: [] },
};

function sweep(key: string, target: Target, token: string): Promise<LightMyRequestResponse> {
  const [method, pattern] = key.split(' ') as [string, string];
  const url = pattern
    .replace(':tenant', target.tenantName)
    .replace(':id', target.subjectId)
    .replace(':credentialId', target.credentialId)
    .replace(':clientId', newId())
    .replace(':sid', newId());
  const body = BODIES[key];
  return fixture.http.inject({
    method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

function capabilityFor(key: string): string {
  const capability = ADMIN_ROUTES.find((r) => `${r.method} ${r.pattern}` === key)?.capability;
  if (capability === undefined || capability === null) throw new Error(`no capability for ${key}`);
  return capability;
}

describe('the target ceiling holds on every route that mutates a subject', () => {
  it('covers exactly the routes that mutate a subject', () => {
    expect([...SUBJECT_MUTATIONS].sort()).toEqual(Object.keys(REFUSED_ACTION).sort());
  });

  it.each(SUBJECT_MUTATIONS)(
    '%s: refuses a caller short of a tenant-admin target, changing nothing',
    async (key) => {
      const t = await fixture.createTenant(`sweep-${newId()}`);
      const target = await createTarget(t, [TENANT_ADMIN]);
      const before = await stateOf(target);

      const token = await fixture.adminToken(t.name, [capabilityFor(key)]);
      const res = await sweep(key, target, token);

      expect(res.statusCode).toBe(403);
      expect(await stateOf(target)).toEqual(before);
      const rows = await withTenant(fixture.app.db, t.id, (tx) =>
        auditRepository(tx).list({ limit: 50 }),
      );
      const refused = rows.filter(
        (row) => row.action === REFUSED_ACTION[key] && row.outcome === 'refused',
      );
      expect(refused).toHaveLength(1);
      expect((refused[0]?.detail as { denied?: string[] } | null)?.denied).toContain(
        'manage-tenant',
      );
    },
  );

  it.each(SUBJECT_MUTATIONS)('%s: admits a tenant-admin acting on a tenant-admin', async (key) => {
    const t = await fixture.createTenant(`sweep-peer-${newId()}`);
    const target = await createTarget(t, [TENANT_ADMIN]);

    const res = await sweep(key, target, await fixture.adminToken(t.name, [TENANT_ADMIN]));

    expect(res.statusCode).not.toBe(403);
  });

  it('refuses the demotion that would empty the target before a takeover', async () => {
    const t = await fixture.createTenant(`sweep-demote-${newId()}`);
    const target = await createTarget(t, [TENANT_ADMIN]);
    const before = await stateOf(target);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const headers = { authorization: `Bearer ${token}` };
    const base = `/admin/tenants/${t.name}/subjects/${target.subjectId}`;

    const rolesRead = await fixture.http.inject({ method: 'GET', url: `${base}/roles`, headers });
    const demoted = await fixture.http.inject({
      method: 'PUT',
      url: `${base}/roles`,
      headers: { ...headers, 'if-match': String(rolesRead.headers.etag) },
      payload: { role_ids: [] },
    });
    const groupsRead = await fixture.http.inject({ method: 'GET', url: `${base}/groups`, headers });
    const ungrouped = await fixture.http.inject({
      method: 'PUT',
      url: `${base}/groups`,
      headers: { ...headers, 'if-match': String(groupsRead.headers.etag) },
      payload: { group_ids: [] },
    });
    const issued = await fixture.http.inject({ method: 'POST', url: `${base}/password`, headers });

    expect(demoted.statusCode).toBe(403);
    expect(ungrouped.statusCode).toBe(403);
    expect(issued.statusCode).toBe(403);
    expect(await stateOf(target)).toEqual(before);
  });
});

// A confidential client authenticates as its service account, so every
// route that mutates one client is held to that subject's ceiling: read
// from the route table, so a new client mutation without it fails here.
const CLIENT_MUTATIONS = ADMIN_ROUTES.filter(
  (route) =>
    route.method !== 'GET' &&
    (route.pattern.startsWith('/admin/tenants/:tenant/clients/:id') ||
      route.pattern === '/admin/tenants/:tenant/scopes/:id/clients/:clientId'),
).map((route) => `${route.method} ${route.pattern}`);

const CLIENT_REFUSED_ACTION: Readonly<Record<string, string>> = {
  'PATCH /admin/tenants/:tenant/clients/:id': 'client.amend',
  'DELETE /admin/tenants/:tenant/clients/:id': 'client.delete',
  'POST /admin/tenants/:tenant/clients/:id/secret': 'client.rotate_secret',
  'PUT /admin/tenants/:tenant/scopes/:id/clients/:clientId': 'scope.assign_to_client',
  'DELETE /admin/tenants/:tenant/scopes/:id/clients/:clientId': 'scope.unassign_from_client',
};

const CLIENT_BODIES: Readonly<Record<string, unknown>> = {
  'PATCH /admin/tenants/:tenant/clients/:id': { name: 'renamed' },
  'PUT /admin/tenants/:tenant/scopes/:id/clients/:clientId': { assignment: 'optional' },
};

interface ClientTarget {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly clientDbId: string;
  readonly scopeId: string;
}

async function clientTarget(
  tenant: { id: string; name: string },
  capabilities: readonly string[] | 'public',
): Promise<ClientTarget> {
  let clientDbId: string;
  if (capabilities === 'public') {
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/clients`,
      headers: {
        authorization: `Bearer ${await fixture.adminToken(tenant.name, [TENANT_ADMIN])}`,
        'content-type': 'application/json',
      },
      payload: {
        client_id: `public-${newId()}`,
        redirect_uris: ['https://app.example/callback'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'none',
      },
    });
    if (res.statusCode !== 201) throw new Error(`fixture: public client refused: ${res.body}`);
    clientDbId = res.json<{ id: string }>().id;
  } else {
    clientDbId = (await fixture.createServiceAccountClient(tenant.name, capabilities)).id;
  }
  const scopeId = await withTenant(fixture.app.db, tenant.id, async (tx) => {
    const scope = await clientScopeRepository(tx).byName('profile');
    if (scope === null) throw new Error('fixture: no profile scope');
    return scope.id;
  });
  return { tenantId: tenant.id, tenantName: tenant.name, clientDbId, scopeId };
}

async function clientStateOf(target: ClientTarget): Promise<unknown> {
  return withTenant(fixture.app.db, target.tenantId, async (tx) => ({
    client: await clientRepository(tx).byId(target.clientDbId),
    config: [
      ...(await tx.execute(
        sql`SELECT * FROM client_oidc_config WHERE client_id = ${target.clientDbId}`,
      )),
    ],
    scopes: await clientScopeRepository(tx).forClient(target.clientDbId),
  }));
}

function clientSweep(
  key: string,
  target: ClientTarget,
  token: string,
): Promise<LightMyRequestResponse> {
  const [method, pattern] = key.split(' ') as [string, string];
  const url = pattern.startsWith('/admin/tenants/:tenant/scopes/')
    ? pattern
        .replace(':tenant', target.tenantName)
        .replace(':id', target.scopeId)
        .replace(':clientId', target.clientDbId)
    : pattern.replace(':tenant', target.tenantName).replace(':id', target.clientDbId);
  const body = CLIENT_BODIES[key];
  return fixture.http.inject({
    method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

describe('the target ceiling holds on every route that mutates a client', () => {
  it('covers exactly the routes that mutate a client', () => {
    expect([...CLIENT_MUTATIONS].sort()).toEqual(Object.keys(CLIENT_REFUSED_ACTION).sort());
  });

  it.each(CLIENT_MUTATIONS)(
    '%s: refuses a caller short of a tenant-admin service account, changing nothing',
    async (key) => {
      const t = await fixture.createTenant(`client-ceiling-${newId()}`);
      const target = await clientTarget(t, [TENANT_ADMIN]);
      const before = await clientStateOf(target);

      const res = await clientSweep(
        key,
        target,
        await fixture.adminToken(t.name, [capabilityFor(key)]),
      );

      expect(res.statusCode).toBe(403);
      expect(await clientStateOf(target)).toEqual(before);
      const rows = await withTenant(fixture.app.db, t.id, (tx) =>
        auditRepository(tx).list({ limit: 50 }),
      );
      const refused = rows.filter(
        (row) => row.action === CLIENT_REFUSED_ACTION[key] && row.outcome === 'refused',
      );
      expect(refused).toHaveLength(1);
      const denied = (refused[0]?.detail as { denied?: string[] } | null)?.denied ?? [];
      expect(denied.length).toBeGreaterThan(0);
      expect(denied).not.toContain(capabilityFor(key));
    },
  );

  it.each(CLIENT_MUTATIONS)(
    '%s: admits a tenant-admin on a tenant-admin service account',
    async (key) => {
      const t = await fixture.createTenant(`client-ceiling-peer-${newId()}`);
      const target = await clientTarget(t, [TENANT_ADMIN]);

      const res = await clientSweep(key, target, await fixture.adminToken(t.name, [TENANT_ADMIN]));

      expect(res.statusCode).toBeLessThan(300);
    },
  );

  it.each(CLIENT_MUTATIONS)(
    '%s: admits the route alone on a service account holding no capability',
    async (key) => {
      const t = await fixture.createTenant(`client-ceiling-plain-${newId()}`);
      const target = await clientTarget(t, []);

      const res = await clientSweep(
        key,
        target,
        await fixture.adminToken(t.name, [capabilityFor(key)]),
      );

      expect(res.statusCode).toBeLessThan(300);
    },
  );

  it.each(CLIENT_MUTATIONS.filter((key) => !key.endsWith('/secret')))(
    '%s: admits the route alone on a client with no service account',
    async (key) => {
      const t = await fixture.createTenant(`client-ceiling-public-${newId()}`);
      const target = await clientTarget(t, 'public');

      const res = await clientSweep(
        key,
        target,
        await fixture.adminToken(t.name, [capabilityFor(key)]),
      );

      expect(res.statusCode).toBeLessThan(300);
    },
  );

  it('keeps the service account’s token out of reach: a rotated secret is never answered', async () => {
    const t = await fixture.createTenant(`client-ceiling-rotate-${newId()}`);
    const target = await clientTarget(t, [TENANT_ADMIN]);

    const res = await clientSweep(
      'POST /admin/tenants/:tenant/clients/:id/secret',
      target,
      await fixture.adminToken(t.name, ['manage-clients']),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('client_secret');
    expect(res.json<{ detail: string }>().detail).toContain('manage-tenant');
  });
});

interface Graph {
  readonly tenant: { id: string; name: string };
  readonly tenantAdminRoleId: string;
  readonly harmlessRoleId: string;
  readonly parentGroupId: string;
  readonly childGroupId: string;
  readonly nestingRoleId: string;
  readonly scopeId: string;
}

// A group `parent` mapped to `tenant-admin` with a plain `child` under it, a
// tenant role nesting `tenant-admin`, a role reaching nothing, and a scope
// mapped to `tenant-admin` — every edge a removal could take it off by.
async function graphWithTenantAdmin(): Promise<Graph> {
  const tenant = await fixture.createTenant(`removal-${newId()}`);
  return withTenant(fixture.app.db, tenant.id, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const tenantAdmin = await roleRepository(tx).byName(TENANT_ADMIN, adminClient?.id ?? null);
    if (tenantAdmin === null) throw new Error('fixture: no tenant-admin role');
    const harmless = await roleRepository(tx).create({ tenantId: tenant.id, name: 'harmless' });
    const nesting = await roleRepository(tx).create({ tenantId: tenant.id, name: 'nesting' });
    await roleRepository(tx).addComposite(nesting.id, tenantAdmin.id);
    const groups = groupRepository(tx);
    const parent = await groups.create({ tenantId: tenant.id, name: 'parent', parentId: null });
    const child = await groups.create({ tenantId: tenant.id, name: 'child', parentId: parent.id });
    await groups.setRoles(parent.id, [tenantAdmin.id]);
    const scope = await clientScopeRepository(tx).create({ tenantId: tenant.id, name: 'ops' });
    await roleRepository(tx).setClientScopeRoles(scope.id, [tenantAdmin.id]);
    return {
      tenant,
      tenantAdminRoleId: tenantAdmin.id,
      harmlessRoleId: harmless.id,
      parentGroupId: parent.id,
      childGroupId: child.id,
      nestingRoleId: nesting.id,
      scopeId: scope.id,
    };
  });
}

async function replaceWithEtag(
  url: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const headers = { authorization: `Bearer ${token}` };
  const read = await fixture.http.inject({ method: 'GET', url, headers });
  return fixture.http.inject({
    method: 'PUT',
    url,
    headers: { ...headers, 'if-match': String(read.headers.etag) },
    payload,
  });
}

type Removal =
  | 'group roles'
  | 'group delete'
  | 'child delete'
  | 'reparent'
  | 'role delete'
  | 'composite remove'
  | 'scope roles';

const REMOVAL_ACTION: Record<Removal, string> = {
  'group roles': 'group.roles_set',
  'group delete': 'group.delete',
  'child delete': 'group.delete',
  reparent: 'group.amend',
  'role delete': 'role.delete',
  'composite remove': 'role.composite_remove',
  'scope roles': 'scope.roles_set',
};

function remove(removal: Removal, g: Graph, token: string): Promise<LightMyRequestResponse> {
  const base = `/admin/tenants/${g.tenant.name}`;
  const authorization = `Bearer ${token}`;
  switch (removal) {
    case 'group roles':
      return replaceWithEtag(`${base}/groups/${g.parentGroupId}/roles`, token, { role_ids: [] });
    case 'group delete':
      return fixture.http.inject({
        method: 'DELETE',
        url: `${base}/groups/${g.parentGroupId}`,
        headers: { authorization },
      });
    case 'child delete':
      return fixture.http.inject({
        method: 'DELETE',
        url: `${base}/groups/${g.childGroupId}`,
        headers: { authorization },
      });
    case 'reparent':
      return fixture.http.inject({
        method: 'PATCH',
        url: `${base}/groups/${g.childGroupId}`,
        headers: { authorization, 'content-type': 'application/json' },
        payload: { parent_id: null },
      });
    case 'role delete':
      return fixture.http.inject({
        method: 'DELETE',
        url: `${base}/roles/${g.nestingRoleId}`,
        headers: { authorization },
      });
    case 'composite remove':
      return fixture.http.inject({
        method: 'DELETE',
        url: `${base}/roles/${g.nestingRoleId}/composites/${g.tenantAdminRoleId}`,
        headers: { authorization },
      });
    case 'scope roles':
      return replaceWithEtag(`${base}/scopes/${g.scopeId}/roles`, token, { role_ids: [] });
  }
}

async function graphStateOf(g: Graph): Promise<unknown> {
  return withTenant(fixture.app.db, g.tenant.id, async (tx) => ({
    groups: [
      await groupRepository(tx).byId(g.parentGroupId),
      await groupRepository(tx).byId(g.childGroupId),
    ],
    mapped: [...(await tx.execute(sql`SELECT group_id, role_id FROM group_roles ORDER BY 1, 2`))],
    composites: (await roleRepository(tx).directComposites(g.nestingRoleId)).map((r) => r.id),
    nesting: await roleRepository(tx).byId(g.nestingRoleId),
    scoped: [
      ...(await tx.execute(
        sql`SELECT role_id FROM client_scope_roles WHERE client_scope_id = ${g.scopeId}`,
      )),
    ],
  }));
}

const REMOVALS = Object.keys(REMOVAL_ACTION) as Removal[];

describe('a removal is judged by the admin capabilities it removes', () => {
  it.each(REMOVALS)(
    '%s: refuses manage-tenant alone taking tenant-admin away, changing nothing',
    async (removal) => {
      const g = await graphWithTenantAdmin();
      const before = await graphStateOf(g);

      const res = await remove(
        removal,
        g,
        await fixture.adminToken(g.tenant.name, ['manage-tenant']),
      );

      expect(res.statusCode).toBe(403);
      expect(await graphStateOf(g)).toEqual(before);
      const rows = await withTenant(fixture.app.db, g.tenant.id, (tx) =>
        auditRepository(tx).list({ limit: 50 }),
      );
      const refused = rows.filter(
        (row) => row.action === REMOVAL_ACTION[removal] && row.outcome === 'refused',
      );
      expect(refused).toHaveLength(1);
      const denied = (refused[0]?.detail as { denied?: string[] } | null)?.denied ?? [];
      expect(denied).toContain('manage-users');
      expect(denied).not.toContain('manage-tenant');
    },
  );

  it.each(REMOVALS)('%s: admits a tenant-admin', async (removal) => {
    const g = await graphWithTenantAdmin();

    const res = await remove(removal, g, await fixture.adminToken(g.tenant.name, [TENANT_ADMIN]));

    expect(res.statusCode).toBeLessThan(300);
  });

  it('judges a replacement by its delta: a role added beside a retained tenant-admin is admitted', async () => {
    const g = await graphWithTenantAdmin();
    const token = await fixture.adminToken(g.tenant.name, ['manage-tenant']);
    const base = `/admin/tenants/${g.tenant.name}`;
    const both = { role_ids: [g.tenantAdminRoleId, g.harmlessRoleId] };

    const group = await replaceWithEtag(`${base}/groups/${g.parentGroupId}/roles`, token, both);
    const scope = await replaceWithEtag(`${base}/scopes/${g.scopeId}/roles`, token, both);

    expect(group.statusCode).toBe(200);
    expect(scope.statusCode).toBe(200);
  });

  it('admits manage-tenant removing what reaches no capability', async () => {
    const g = await graphWithTenantAdmin();
    const token = await fixture.adminToken(g.tenant.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${g.tenant.name}/roles/${g.harmlessRoleId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });
});
