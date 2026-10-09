import { auditEventSchema } from '@odudu/contracts/admin';
import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository, subjects, userRepository } from '@odudu/domain-identity';
import { clientRepository, SYSTEM_TENANT_ID } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { countAudit, exportAudit, resolveActors } from '#/usecase/audit';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function get(tenantName: string, token: string, tail: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function record(
  tenantId: string,
  action: string,
  actor: { subjectId: string; tenantId?: string },
): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) =>
    auditRepository(tx).record({
      eventType: 'admin_mutation',
      action,
      outcome: 'allowed',
      actorSubjectId: actor.subjectId,
      actorTenantId: actor.tenantId ?? tenantId,
      actorClientId: newId(),
      resourceType: 'subject',
      resourceId: newId(),
    }),
  );
}

interface AuditItem {
  action: string;
  actor_subject_id: string | null;
  actor_name: string | null;
  actor_origin: string | null;
}

describe('the actor an audit row names, resolved when it is read', () => {
  it('names a user or a service account, in this tenant only, to a caller who can read subjects', async () => {
    const t = await fixture.createTenant(`aud-${newId()}`);
    const { ada, service, client, gone } = await withTenant(fixture.app.db, t.id, async (tx) => {
      const user = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await userRepository(tx).create({
        subjectId: user.id,
        tenantId: t.id,
        username: 'ada',
        email: null,
      });
      const serviceSubject = await subjectRepository(tx).create({
        tenantId: t.id,
        type: 'service',
      });
      const created = await clientRepository(tx).create({
        tenantId: t.id,
        clientId: `svc-${newId()}`,
        name: 'Billing sync',
        type: 'confidential',
        secretHash: 'unused',
        serviceSubjectId: serviceSubject.id,
      });
      const deleted = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await userRepository(tx).create({
        subjectId: deleted.id,
        tenantId: t.id,
        username: 'gone',
        email: null,
      });
      return { ada: user.id, service: serviceSubject.id, client: created, gone: deleted.id };
    });
    await record(t.id, 'probe.user', { subjectId: ada });
    await record(t.id, 'probe.service', { subjectId: service });
    await record(t.id, 'probe.deleted', { subjectId: gone });
    await record(t.id, 'probe.system', { subjectId: newId(), tenantId: SYSTEM_TENANT_ID });
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.delete(subjects).where(eq(subjects.id, gone)),
    );
    const auditorOnly = await fixture.adminToken(t.name, ['view-audit']);
    const unnamed = await get(t.name, auditorOnly, 'audit?limit=50');
    const hidden = unnamed.json<{ items: AuditItem[] }>().items;
    expect(hidden.find((item) => item.action === 'probe.user')).toMatchObject({
      actor_subject_id: ada,
      actor_name: null,
      actor_origin: 'tenant',
    });
    expect(hidden.every((item) => item.actor_name === null)).toBe(true);
    const unnamedExport = await get(t.name, auditorOnly, 'audit/export?action=probe.user');
    expect(unnamedExport.body).not.toContain('"actor_name":"ada"');

    const token = await fixture.adminToken(t.name, ['view-audit', 'view-users']);
    const res = await get(t.name, token, 'audit?limit=50');
    expect(res.statusCode).toBe(200);
    const byAction = new Map(
      res.json<{ items: AuditItem[] }>().items.map((item) => [item.action, item]),
    );
    expect(byAction.get('probe.user')).toMatchObject({ actor_name: 'ada', actor_origin: 'tenant' });
    expect(byAction.get('probe.service')).toMatchObject({
      actor_name: client.clientId,
      actor_origin: 'tenant',
    });
    expect(byAction.get('probe.deleted')).toMatchObject({
      actor_subject_id: gone,
      actor_name: null,
      actor_origin: 'tenant',
    });
    expect(byAction.get('probe.system')).toMatchObject({
      actor_name: null,
      actor_origin: 'system',
    });
  });

  it('resolves no actor across tenants, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const user = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await userRepository(tx).create({
          subjectId: user.id,
          tenantId,
          username: 'ada',
          email: null,
        });
        return user.id;
      },
      verifySeeded: async (tx, subjectId) => {
        const tenantId = (await subjectRepository(tx).byId(subjectId))?.tenantId ?? '';
        const names = await resolveActors(tx, tenantId, [
          { actorSubjectId: subjectId, actorTenantId: tenantId },
        ]);
        expect(names.get(subjectId)).toBe('ada');
      },
      attempt: async (tx, subjectId) => {
        const foreign = newId();
        return resolveActors(tx, foreign, [{ actorSubjectId: subjectId, actorTenantId: foreign }]);
      },
      expectBlocked: (result) => {
        expect(result).toEqual(new Map());
      },
    });
  });
});

describe('GET /audit/count', () => {
  it('counts what the listing under the same filters lists', async () => {
    const t = await fixture.createTenant(`aud-${newId()}`);
    for (let i = 0; i < 3; i += 1) await record(t.id, 'probe.counted', { subjectId: newId() });
    await record(t.id, 'probe.other', { subjectId: newId() });
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const res = await get(t.name, token, 'audit/count?action=probe.counted');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 3, capped: false });
    expect((await get(t.name, token, 'audit/count?resource_id=x')).statusCode).toBe(400);
  });
});

describe('GET /audit/export', () => {
  it('answers every matching row as NDJSON, newest first, and audits the export', async () => {
    const t = await fixture.createTenant(`aud-${newId()}`);
    await record(t.id, 'probe.exported', { subjectId: newId() });
    fixture.clock.advance(1000);
    await record(t.id, 'probe.exported', { subjectId: newId() });
    const token = await fixture.adminToken(t.name, ['view-audit']);

    const res = await get(t.name, token, 'audit/export?action=probe.exported');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/x-ndjson/u);
    const lines = res.body
      .trim()
      .split('\n')
      .map((line) => auditEventSchema.parse(JSON.parse(line)));
    expect(lines.map((line) => line.action)).toEqual(['probe.exported', 'probe.exported']);
    const [newer, older] = lines.map((line) => line.occurred_at);
    expect((newer ?? '') >= (older ?? '')).toBe(true);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'audit.export', limit: 5 }),
    );
    expect(rows[0]?.detail).toMatchObject({ exported: 2 });
  });

  it('refuses more rows than it will write with 413, and writes none', async () => {
    const t = await fixture.createTenant(`aud-${newId()}`);
    for (let i = 0; i < 3; i += 1) await record(t.id, 'probe.big', { subjectId: newId() });
    const recorded: string[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      exportAudit(
        tx,
        {
          audit: (_tx, event) => {
            recorded.push(event.action);
            return Promise.resolve();
          },
        },
        {
          tenantId: t.id,
          revealNames: true,
          filters: { action: 'probe.big' },
          cap: 2,
          actorSubjectId: newId(),
          actorTenantId: t.id,
          actorClientId: newId(),
        },
      ),
    );
    expect(outcome).toEqual({ kind: 'too_many', cap: 2 });
    expect(recorded).toEqual([]);
  });

  it('is refused without view-audit', async () => {
    const t = await fixture.createTenant(`aud-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    expect((await get(t.name, token, 'audit/export')).statusCode).toBe(403);
    expect((await get(t.name, token, 'audit/count')).statusCode).toBe(403);
  });
});

describe('countAudit and exportAudit, probed with a foreign tenant_id', () => {
  it('count and export nothing from another tenant’s context', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        await auditRepository(tx).record({
          eventType: 'admin_mutation',
          action: 'probe.exported',
          outcome: 'allowed',
        });
      },
      verifySeeded: async (tx) => {
        expect((await countAudit(tx, {}, 10)).count).toBe(1);
      },
      attempt: async (tx) => ({
        count: await countAudit(tx, {}, 10),
        exported: await exportAudit(
          tx,
          { audit: () => Promise.resolve() },
          {
            tenantId: newId(),
            revealNames: true,
            filters: {},
            cap: 10,
            actorSubjectId: newId(),
            actorTenantId: newId(),
            actorClientId: newId(),
          },
        ),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({
          count: { count: 0, capped: false },
          exported: { kind: 'ok', items: [] },
        });
      },
    });
  });
});
