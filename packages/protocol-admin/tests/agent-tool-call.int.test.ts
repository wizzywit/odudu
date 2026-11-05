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

function subjectOf(token: string): string {
  const payload = token.split('.')[1] ?? '';
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof claims !== 'object' || claims === null || !('sub' in claims))
    throw new Error('no sub');
  return String(claims.sub);
}

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
      recordAgentToolCall(tx, principal, { tool: 'whoami', route: 'GET /x', outcome: 'allowed' }),
    );
    expect(await rows(t.id, 'agent.tool_call')).toHaveLength(1);
    await expect(
      fixture.owner
        .sql`update tenants set audit_event_types = '{admin_mutation}' where id = ${t.id}`,
    ).rejects.toThrow(/audit_event_types_check/);
  });
});

describe('an admin mutation made by an agent', () => {
  it('is attributable through its actor columns: the agent client row and the owner', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-clients'], {
      scope: 'mcp:write',
      act: { sub: 'agent' },
    });
    const owner = subjectOf(token);
    const ordinary = await fixture.createConfidentialClient(t.name, {});
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${ordinary.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { description: 'written by an agent' },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows(t.id, 'client.amend');
    expect(row).toMatchObject({ actorSubjectId: owner, outcome: 'allowed' });
    expect(row?.actorClientId).not.toBeNull();
  });
});
