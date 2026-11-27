import { withTenant } from '@odudu/db';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
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

const HOUR = 3_600_000;

async function world() {
  const t = await fixture.createTenant(`inst-del-${newId()}`);
  const { id: owner } = await fixture.createSubject(t.name, `owner-${newId()}`);
  const client = await fixture.createConfidentialClient(t.name, {});
  const grantId = newId();
  await withTenant(fixture.app.db, t.id, (tx) =>
    tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: t.id,
      clientId: client.id,
      subjectId: owner,
      scope: 'mcp:write',
      audience: ['https://odudu.test/mcp'],
    }),
  );
  const instance = newId();
  await withTenant(fixture.app.db, t.id, (tx) =>
    agentInstanceRepository(tx).mint({
      id: instance,
      tenantId: t.id,
      ownerSubjectId: owner,
      agentClientId: client.id,
      parentInstanceId: null,
      rootGrantId: grantId,
      depth: 1,
      scope: 'mcp:write',
      expiresAt: new Date(Date.now() + HOUR),
      idleExpiresAt: null,
    }),
  );
  return { t, owner, instance };
}

type World = Awaited<ReturnType<typeof world>>;

function stillThere(w: World): Promise<{ subject: boolean; instance: boolean }> {
  return withTenant(fixture.app.db, w.t.id, async (tx) => ({
    subject: (await subjectRepository(tx).byId(w.instance)) !== null,
    instance: (await agentInstanceRepository(tx).byId(w.instance)) !== null,
  }));
}

function refusedRows(w: World) {
  return withTenant(fixture.app.db, w.t.id, (tx) =>
    auditRepository(tx).list({ action: 'subject.delete', outcome: 'refused', limit: 10 }),
  );
}

const DETAIL =
  'An agent instance is removed by revoking it; the reaper deletes it after its retention window.';

function deleteOne(w: World, token: string, id: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'DELETE',
    url: `/admin/tenants/${w.t.name}/subjects/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('deleting the subject of an agent instance', () => {
  it('is refused with 409 on the single route, recorded, and changes nothing', async () => {
    const w = await world();
    const token = await fixture.adminToken(w.t.name, ['manage-users']);

    const res = await deleteOne(w, token, w.instance);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string; detail: string }>()).toMatchObject({
      type: 'about:blank#agent-instance',
      detail: DETAIL,
    });
    expect(await stillThere(w)).toEqual({ subject: true, instance: true });

    const rows = await refusedRows(w);
    expect(rows.map((row) => row.resourceId)).toEqual([w.instance]);
    expect(JSON.stringify(rows[0]?.detail)).toContain('agent instance');
  });

  it('is refused for that id alone on the bulk route', async () => {
    const w = await world();
    const { id: ada } = await fixture.createSubject(w.t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(w.t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${w.t.name}/subjects/bulk`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'delete', ids: [w.instance, ada] },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining({
        id: w.instance,
        status: 409,
        type: 'about:blank#agent-instance',
        detail: DETAIL,
      }),
      { id: ada, status: 204 },
    ]);
    expect(await stillThere(w)).toEqual({ subject: true, instance: true });
    expect((await refusedRows(w)).map((row) => row.resourceId)).toEqual([w.instance]);
  });

  it('leaves revoking an instance as it was', async () => {
    const w = await world();
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.t.name}/agents/${w.instance}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const revoked = await withTenant(fixture.app.db, w.t.id, (tx) =>
      agentInstanceRepository(tx).byId(w.instance),
    );
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await stillThere(w)).toEqual({ subject: true, instance: true });
  });

  it('still goes with its owner, whom a person may delete', async () => {
    const w = await world();
    const token = await fixture.adminToken(w.t.name, ['manage-users']);
    expect((await deleteOne(w, token, w.owner)).statusCode).toBe(204);
    expect(await stillThere(w)).toEqual({ subject: false, instance: false });
  });

  it('is removed by the reaper once revoked and past its retention window', async () => {
    const w = await world();
    await withTenant(fixture.app.db, w.t.id, async (tx) => {
      const repo = agentInstanceRepository(tx);
      await repo.revoke(w.instance, new Date(Date.now() - 2 * HOUR));
      return repo.expireDue(new Date(), new Date(Date.now() - HOUR));
    });
    expect(await stillThere(w)).toEqual({ subject: false, instance: false });
  });
});
