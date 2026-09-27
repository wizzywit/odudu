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
