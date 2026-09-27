import { requiredActionRepository } from '@odudu/authn-flows';
import { generateTotpSecret } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import { credentialRepository, subjectRepository, userRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
// with a TOTP credential so the credential route has something to remove.
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

  it('refuses nothing on a PATCH that changes no email or enabled value', async () => {
    const t = await fixture.createTenant(`ceiling-noop-${newId()}`);
    const target = await createTarget(t, [TENANT_ADMIN]);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${target.subjectId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(200);
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
