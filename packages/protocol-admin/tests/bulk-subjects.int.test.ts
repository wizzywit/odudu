import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { tenants, withTenant, type TenantScopedDatabase } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import { loginFailures, subjectRepository, userRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { bulkSubjects } from '#/usecase/bulk-subjects';
import { clearLockouts } from '#/usecase/lockouts';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const EVERY_CAPABILITY: ReadonlySet<string> = new Set([...TENANT_CAPABILITIES, MANAGE_TENANTS]);

async function seedUser(tenantId: string, username: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({ subjectId: subject.id, tenantId, username, email: null });
    return subject.id;
  });
}

async function makeTenantAdmin(tenantId: string, subjectId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const role = await roleRepository(tx).byName(TENANT_ADMIN, admin?.id ?? '');
    if (role === null) throw new Error('no tenant-admin role');
    await roleRepository(tx).assignToSubject(subjectId, role.id);
  });
}

async function fail(tenantId: string, subjectId: string, lockedFor: number): Promise<void> {
  const at = fixture.clock.now();
  await withTenant(fixture.app.db, tenantId, (tx) =>
    tx.insert(loginFailures).values({
      tenantId,
      subjectId,
      failureCount: 5,
      firstFailureAt: at,
      lastFailureAt: at,
      lockedUntil: new Date(at.getTime() + lockedFor),
    }),
  );
}

async function failuresOf(tenantId: string): Promise<string[]> {
  return withTenant(fixture.app.db, tenantId, async (tx) =>
    (await tx.select({ id: loginFailures.subjectId }).from(loginFailures)).map((row) => row.id),
  );
}

function bulk(tenantName: string, token: string, body: unknown): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/subjects/bulk`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

interface BulkItem {
  id: string;
  status: number;
  type?: string;
  ended?: number;
}

function itemsOf(res: LightMyRequestResponse): BulkItem[] {
  return res.json<{ items: BulkItem[] }>().items;
}

describe('DELETE /lockouts', () => {
  it('clears every failure count within the caller’s ceiling, and counts the rest', async () => {
    const t = await fixture.createTenant(`lk-${newId()}`);
    const ada = await seedUser(t.id, 'ada');
    const bob = await seedUser(t.id, 'bob');
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    await fail(t.id, ada, 60_000);
    await fail(t.id, bob, -1_000);
    await fail(t.id, root, 60_000);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/lockouts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cleared: 2, beyond_ceiling: 1 });
    expect(await failuresOf(t.id)).toEqual([root]);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'subject.lockouts_clear', limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ resourceType: 'tenant', resourceId: t.id });
    expect(rows[0]?.detail).toEqual({ cleared: 2, beyond_ceiling: 1 });
  });

  it('is refused without manage-users', async () => {
    const t = await fixture.createTenant(`lk-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/lockouts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('clears nothing across tenants, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx: TenantScopedDatabase, tenantId: string) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await tx.insert(loginFailures).values({ tenantId, subjectId: subject.id, failureCount: 1 });
        return subject.id;
      },
      verifySeeded: async (tx) => {
        expect(await tx.select().from(loginFailures)).toHaveLength(1);
      },
      attempt: (tx) =>
        clearLockouts(
          tx,
          { audit: () => Promise.resolve() },
          {
            tenantId: newId(),
            callerCapabilities: EVERY_CAPABILITY,
            actorSubjectId: newId(),
            actorTenantId: newId(),
            actorClientId: newId(),
          },
        ),
      expectBlocked: (result) => {
        expect(result).toEqual({ cleared: 0, beyondCeiling: 0 });
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await tx.select().from(loginFailures)).toHaveLength(1);
      },
    });
  });
});

describe('POST /subjects/bulk', () => {
  it('disables each id through the single-subject door, answering and auditing each', async () => {
    const t = await fixture.createTenant(`bk-${newId()}`);
    const ada = await seedUser(t.id, 'ada');
    const bob = await seedUser(t.id, 'bob');
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    const missing = newId();
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await bulk(t.name, token, {
      action: 'disable',
      ids: [ada, bob, bob, root, missing],
    });
    expect(res.statusCode).toBe(200);
    expect(itemsOf(res)).toEqual([
      { id: ada, status: 204 },
      { id: bob, status: 204 },
      expect.objectContaining({ id: root, status: 403, type: 'about:blank' }),
      expect.objectContaining({ id: missing, status: 404 }),
    ]);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      expect((await subjectRepository(tx).byId(ada))?.disabledAt).not.toBeNull();
      expect((await subjectRepository(tx).byId(root))?.disabledAt).toBeNull();
      const rows = await auditRepository(tx).list({ action: 'subject.amend', limit: 10 });
      expect(
        rows
          .filter((row) => row.outcome === 'allowed')
          .map((row) => row.resourceId)
          .sort(),
      ).toEqual([ada, bob].sort());
      expect(rows.filter((row) => row.outcome === 'refused').map((row) => row.resourceId)).toEqual([
        root,
      ]);
    });

    const enabled = await bulk(t.name, token, { action: 'enable', ids: [ada] });
    expect(itemsOf(enabled)).toEqual([{ id: ada, status: 204 }]);
  });

  it('refuses the delete that would leave no administrator, and deletes the rest', async () => {
    const t = await fixture.createTenant(`bk-${newId()}`);
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    const ada = await seedUser(t.id, 'ada');
    const token = await fixture.adminToken(t.name, ['tenant-admin']);
    const caller = (
      await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/whoami`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ subjectId: string }>().subjectId;

    const res = await bulk(t.name, token, { action: 'delete', ids: [ada, root, caller] });
    expect(itemsOf(res)).toEqual([
      { id: ada, status: 204 },
      { id: root, status: 204 },
      expect.objectContaining({
        id: caller,
        status: 409,
        type: 'about:blank#last-administrator',
      }),
    ]);
    expect(
      await withTenant(fixture.app.db, t.id, async (tx) => subjectRepository(tx).byId(caller)),
    ).not.toBeNull();
  });

  it('ends each subject’s sessions, and needs manage-sessions to', async () => {
    const t = await fixture.createTenant(`bk-${newId()}`);
    const ada = await seedUser(t.id, 'ada');
    const sessionId = newId();
    await withTenant(fixture.app.db, t.id, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId: t.id,
        subjectId: ada,
        expiresAt: new Date(fixture.clock.now().getTime() + 3_600_000),
        authenticators: ['pwd'],
        secretHash: SessionEntry.issue(sessionId).secretHash(),
      }),
    );

    const usersOnly = await fixture.adminToken(t.name, ['manage-users']);
    const refused = await bulk(t.name, usersOnly, { action: 'end-sessions', ids: [ada] });
    expect(refused.statusCode).toBe(403);

    const both = await fixture.adminToken(t.name, ['manage-users', 'manage-sessions']);
    const res = await bulk(t.name, both, { action: 'end-sessions', ids: [ada] });
    expect(itemsOf(res)).toEqual([{ id: ada, status: 200, ended: 1 }]);
  });

  it('refuses more than 100 ids, an unknown action and an id that is not a uuid', async () => {
    const t = await fixture.createTenant(`bk-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const ids = Array.from({ length: 101 }, () => newId());
    expect((await bulk(t.name, token, { action: 'disable', ids })).statusCode).toBe(400);
    expect((await bulk(t.name, token, { action: 'purge', ids: [newId()] })).statusCode).toBe(400);
    expect((await bulk(t.name, token, { action: 'disable', ids: ['nope'] })).statusCode).toBe(400);
    expect((await bulk(t.name, token, { action: 'disable', ids: [] })).statusCode).toBe(400);
  });
});

describe('bulkSubjects, probed with a foreign tenant_id', () => {
  it('finds and changes no subject from another tenant’s context', async () => {
    const foreign = newId();
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
      },
      verifySeeded: async (tx, subjectId) => {
        expect((await subjectRepository(tx).byId(subjectId))?.disabledAt).toBeNull();
      },
      attempt: async (_tx, subjectId) =>
        (
          await bulkSubjects(
            {
              inTransaction: (fn) => withTenant(fixture.app.db, foreign, fn),
              subjectAudit: () => Promise.resolve(),
              sessionAudit: () => Promise.resolve(),
              kek: Buffer.alloc(32, 7),
            },
            {
              tenantId: foreign,
              action: 'disable',
              ids: [subjectId],
              callerCapabilities: EVERY_CAPABILITY,
              lifespans: {
                ssoSessionIdleSeconds: 1800,
                ssoSessionMaxSeconds: 36_000,
                rememberMeIdleSeconds: 604_800,
                rememberMeMaxSeconds: 2_592_000,
              },
              issuer: 'https://idp.example/tenants/probe',
              now: fixture.clock.now(),
              actorSubjectId: newId(),
              actorTenantId: newId(),
              actorClientId: newId(),
            },
          )
        ).map((outcome) => outcome.kind),
      expectBlocked: (result) => {
        expect(result).toEqual(['not_found']);
      },
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect((await subjectRepository(tx).byId(subjectId))?.disabledAt).toBeNull();
      },
    });
  });
});
