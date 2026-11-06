import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// An agent that reaches the admin API directly, with a token issued to it and
// no `act`, is recorded at the door, before the handler runs. One that arrives
// through the MCP endpoint (`act`) is recorded there, and a person's own token
// is not an agent's.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const rows = (tenantId: string, action: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );

function get(tenant: string, path: string, token: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/${path}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('the door records a direct agent before the handler runs', () => {
  it('writes one agent.tool_call row per read, naming the route and the owner', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-clients'], {
      scope: 'mcp:read',
      viaMcpClient: true,
    });
    expect((await get(t.name, 'whoami', token)).statusCode).toBe(200);
    expect((await get(t.name, 'clients', token)).statusCode).toBe(200);
    const found = await rows(t.id, 'agent.tool_call');
    expect(found).toHaveLength(2);
    expect(found.map((row) => row.detail)).toEqual([
      expect.objectContaining({
        tool: 'admin.get.whoami',
        route: 'GET /admin/tenants/:tenant/whoami',
      }),
      expect.objectContaining({
        tool: 'admin.get.clients',
        route: 'GET /admin/tenants/:tenant/clients',
      }),
    ]);
    for (const row of found) {
      expect(row).toMatchObject({ outcome: 'allowed', eventType: 'admin_access' });
      expect(row.detail).toHaveProperty('owner');
      expect(row.detail).toHaveProperty('agent_client');
    }
  });

  it('records a write too, with the mutation as its own event', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      payload: { name: `s-${newId()}` },
    });
    const id = created.json<{ id: string }>().id;
    const token = await fixture.agentToken(t.name, ['manage-tenant'], {
      scope: 'mcp:write',
      viaMcpClient: true,
    });
    const read = await get(t.name, `scopes/${id}`, token);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': String(read.headers.etag),
      },
      payload: { description: 'by an agent' },
    });
    expect(patched.statusCode).toBe(200);
    const found = await rows(t.id, 'agent.tool_call');
    expect(found.map((row) => (row.detail as { tool: string }).tool)).toEqual([
      'admin.get.scopes.id',
      'admin.patch.scopes.id',
    ]);
    expect(await rows(t.id, 'scope.amend')).toHaveLength(1);
  });

  it('leaves no door row for a token the MCP endpoint signed: it records those itself', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-clients'], {
      scope: 'mcp:read',
      act: { sub: 'agent-client' },
      via: 'mcp',
    });
    expect((await get(t.name, 'whoami', token)).statusCode).toBe(200);
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });

  it('records a token that carries act without that marker, as an exchange makes them', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-clients'], {
      scope: 'mcp:read',
      act: { sub: 'agent-client' },
    });
    expect((await get(t.name, 'whoami', token)).statusCode).toBe(200);
    const found = await rows(t.id, 'agent.tool_call');
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toMatchObject({
      agent_client: expect.any(String),
      tool: 'admin.get.whoami',
    });
  });

  it("leaves none for a person's own token", async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    expect((await get(t.name, 'whoami', token)).statusCode).toBe(200);
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });

  it('leaves none for a call the scope or the capability refuses: the refusal is its row', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await fixture.agentToken(t.name, ['view-users'], {
      scope: 'mcp:read',
      viaMcpClient: true,
    });
    expect((await get(t.name, 'clients', token)).statusCode).toBe(403);
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
    expect(await rows(t.id, 'capability.refused')).toHaveLength(1);
  });

  it('answers 503 and runs nothing when the row cannot be written', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      payload: { name: `s-${newId()}` },
    });
    const id = created.json<{ id: string }>().id;
    const token = await fixture.agentToken(t.name, ['manage-tenant'], {
      scope: 'mcp:write',
      viaMcpClient: true,
    });
    const read = await get(t.name, `scopes/${id}`, token);
    await fixture.owner.db.execute(
      sql.raw(
        "alter table audit_events add constraint refuse_agent_calls check (action <> 'agent.tool_call') not valid",
      ),
    );
    try {
      const patched = await fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/scopes/${id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'if-match': String(read.headers.etag),
        },
        payload: { description: 'must not land' },
      });
      expect(patched.statusCode).toBe(503);
      expect(patched.headers['content-type']).toContain('application/problem+json');
      expect(await rows(t.id, 'scope.amend')).toEqual([]);
      expect((await get(t.name, 'whoami', token)).statusCode).toBe(503);
    } finally {
      await fixture.owner.db.execute(
        sql.raw('alter table audit_events drop constraint refuse_agent_calls'),
      );
    }
  });
});
