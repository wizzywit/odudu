import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { recordAgentToolCall } from '#/usecase/access-audit';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function rows(tenantId: string, action: string) {
  return withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)),
  );
}

async function agentWorld() {
  const t = await fixture.createTenant(`acme-${newId()}`);
  const client = await fixture.builtinAdminClient(t.name);
  const owner = await fixture.createSubject(t.name, `owner-${newId()}`);
  const principal: AdminPrincipal & { agent: { clientId: string; ownerSubjectId: string } } = {
    subjectId: owner.id,
    issuerTenantId: t.id,
    issuerTenantName: t.name,
    clientDbId: client.id,
    scopes: ['mcp:read'],
    agent: { clientId: 'agent', ownerSubjectId: owner.id },
  };
  return { t, principal };
}

describe('agent.tool_call', () => {
  it('records one row per call, reads included, naming the agent client and the owner', async () => {
    const { t, principal } = await agentWorld();
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await recordAgentToolCall(tx, principal, {
        tool: 'list_clients',
        route: 'GET /admin/tenants/:tenant/clients',
        outcome: 'allowed',
      });
      await recordAgentToolCall(tx, principal, {
        tool: 'amend_client',
        route: 'PATCH /admin/tenants/:tenant/clients/:id',
        outcome: 'refused',
        reason: 'insufficient_scope',
      });
    });
    const stored = await rows(t.id, 'agent.tool_call');
    expect(stored).toHaveLength(2);
    const read = stored.find((row) => row.outcome === 'allowed');
    expect(read).toMatchObject({
      eventType: 'admin_access',
      outcome: 'allowed',
      actorSubjectId: principal.subjectId,
      actorClientId: principal.clientDbId,
      detail: {
        agent_client: principal.clientDbId,
        owner: principal.subjectId,
        tool: 'list_clients',
        route: 'GET /admin/tenants/:tenant/clients',
      },
    });
    expect(Object.keys(read?.detail as object).sort()).toEqual([
      'agent_client',
      'owner',
      'route',
      'tool',
    ]);
  });

  it('is stored under the narrowest event types a tenant may keep, and cannot be dropped', async () => {
    const { t, principal } = await agentWorld();
    await fixture.owner
      .sql`update tenants set audit_event_types = '{admin_mutation,admin_access}' where id = ${t.id}`;
    await withTenant(fixture.app.db, t.id, (tx) =>
      recordAgentToolCall(tx, principal, {
        tool: 'whoami',
        route: 'GET /admin/tenants/:tenant/whoami',
        outcome: 'allowed',
      }),
    );
    expect(await rows(t.id, 'agent.tool_call')).toHaveLength(1);
    await expect(
      fixture.owner
        .sql`update tenants set audit_event_types = '{admin_mutation}' where id = ${t.id}`,
    ).rejects.toThrow(/audit_event_types_check/);
  });
});

describe('recordAgentToolCall', () => {
  it('refuses a route that is not in the table and a tool that is not an identifier', async () => {
    const { t, principal } = await agentWorld();
    const record = (call: { tool: string; route: string }) =>
      withTenant(fixture.app.db, t.id, (tx) =>
        recordAgentToolCall(tx, principal, { ...call, outcome: 'allowed' }),
      );
    await expect(record({ tool: 'x', route: 'GET /admin/tenants/acme/clients' })).rejects.toThrow(
      /does not exist/,
    );
    await expect(
      record({ tool: 'List Clients', route: 'GET /admin/tenants/:tenant/clients' }),
    ).rejects.toThrow(/invalid value/);
    expect(await rows(t.id, 'agent.tool_call')).toHaveLength(0);
  });
});

describe('an admin mutation made through a token mintAgentToken signed', () => {
  it('names the agent client row as its actor client and the owner as its actor subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const minted = await fixture.mintAgentTokenForOwner(t.name, ['manage-clients'], {
      scope: ['mcp:write'],
    });
    const admin = await fixture.adminToken(t.name, ['manage-clients']);
    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients?client_id=odudu-mcp`,
      headers: { authorization: `Bearer ${admin}` },
    });
    const agentRow = list.json<{ items: { id: string; client_id: string }[] }>().items[0];
    if (agentRow === undefined) throw new Error('no odudu-mcp client');
    const adminClient = await fixture.builtinAdminClient(t.name);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${agentRow.id}`,
      headers: { authorization: `Bearer ${minted.token}`, 'content-type': 'application/json' },
      payload: { description: 'written by an agent' },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await rows(t.id, 'client.amend');
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: minted.subjectId,
      actorClientId: agentRow.id,
    });
    expect(row?.actorClientId).not.toBe(adminClient.id);
    const claims = JSON.parse(
      Buffer.from(minted.token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { act?: { sub?: string }; client_id?: string };
    expect(claims.act?.sub).toBe(agentRow.client_id);
    expect(claims.client_id).toBe(agentRow.client_id);
  });
});
