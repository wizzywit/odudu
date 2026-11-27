import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { tenants } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// The one place an agent token crosses a tenant: the console assistant's token,
// of a system administrator, at the one tenant its grant names. Every other
// agent keeps the rule that it acts only where its token was issued
// (agent-door-tenant.int.test.ts), and what the administrator holds is checked
// live on every call.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const CAPABILITIES = ['manage-tenants', 'manage-tenant', 'manage-clients', 'view-users'];
const ACT = { sub: 'agent-instance' };

function assistantToken(
  target: string | undefined,
  over: Partial<Parameters<AdminFixture['systemAgentToken']>[1]> = {},
  capabilities: readonly string[] = CAPABILITIES,
  marker = true,
) {
  return fixture.systemAgentToken(capabilities, {
    scope: 'mcp:read',
    act: ACT,
    ...(marker ? { via: 'mcp' as const } : {}),
    assistant: true,
    ...(target === undefined ? {} : { targetTenantId: target }),
    ...over,
  });
}

function get(tenant: string, path: string, token: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}${path}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function refusals(tenantId: string, action: string) {
  return withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)),
  );
}

describe('the assistant token of a system administrator', () => {
  it('reads the tenant its grant names, with what the administrator holds', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id);
    expect((await get(x.name, '/settings', token)).statusCode).toBe(200);
    expect((await get(x.name, '/clients', token)).statusCode).toBe(200);
  });

  it('is refused at every other tenant, the system tenant included', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const y = await fixture.createTenant(`y-${newId()}`);
    const token = await assistantToken(x.id);
    for (const path of [`${y.name}/settings`, 'system/settings']) {
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${path}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, path).toBe(403);
      expect(res.json(), path).toMatchObject({ detail: 'insufficient_scope' });
    }
    for (const instancePath of ['/admin/tenants', '/admin/tenants/count']) {
      const res = await fixture.http.inject({
        method: 'GET',
        url: instancePath,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, instancePath).toBe(403);
    }
    // The refused attempt at Y is recorded in Y's own trail, and nothing else is.
    expect((await refusals(y.id, 'capability.refused')).length).toBe(1);
    expect((await refusals(y.id, 'agent.tool_call')).length).toBe(0);
  });

  it('is refused at a foreign tenant when its grant names none', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const res = await get(x.name, '/settings', await assistantToken(undefined));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
  });

  it('is refused without the marker only the endpoint signs', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const res = await get(x.name, '/settings', await assistantToken(x.id, {}, CAPABILITIES, false));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
  });

  it('is refused when the grant belongs to the MCP client, whatever it names', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id, { assistant: false, viaMcpClient: true });
    const res = await get(x.name, '/settings', token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
  });

  it('is refused when the grant belongs to the admin client, whatever it names', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id, { assistant: false });
    expect((await get(x.name, '/settings', token)).statusCode).toBe(403);
  });

  it('admits the write scope at the target it was granted for, and only there', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id, { scope: 'mcp:read mcp:write' });
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${x.name}/roles`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `k-${newId()}`,
      },
      payload: { name: 'planted' },
    });
    expect(res.statusCode).toBe(201);
    expect((await get(x.name, '/roles', token)).statusCode).toBe(200);
    const other = await fixture.createTenant(`y-${newId()}`);
    expect((await get(other.name, '/roles', token)).statusCode).toBe(403);
  });

  it('is refused at a tenant that is disabled', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id);
    expect((await get(x.name, '/settings', token)).statusCode).toBe(200);
    await withTenant(fixture.app.db, x.id, (tx) =>
      tx.update(tenants).set({ enabled: false }).where(eq(tenants.id, x.id)),
    );
    expect((await get(x.name, '/settings', token)).statusCode).toBe(403);
  });
});

describe('what the administrator holds is checked on every call', () => {
  it('refuses an owner without manage-tenants, in the target tenant trail', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id, {}, ['manage-clients', 'view-users']);
    const res = await get(x.name, '/clients', token);
    expect(res.statusCode).toBe(403);
    const rows = await refusals(x.id, 'capability.refused');
    expect(rows.length).toBe(1);
  });

  it('refuses a route whose capability the owner lacks', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const token = await assistantToken(x.id, {}, ['manage-tenants', 'view-users']);
    expect((await get(x.name, '/subjects', token)).statusCode).toBe(200);
    expect((await get(x.name, '/clients', token)).statusCode).toBe(403);
  });
});

describe('a tenant administrator and a token of another tenant', () => {
  it('cannot reach a tenant other than their own', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const y = await fixture.createTenant(`y-${newId()}`);
    const token = await fixture.adminToken(x.name, ['manage-clients', 'view-users']);
    const res = await get(y.name, '/settings', token);
    expect([401, 403]).toContain(res.statusCode);
  });

  it('cannot use a tenant-issued assistant grant that names a target', async () => {
    const x = await fixture.createTenant(`x-${newId()}`);
    const y = await fixture.createTenant(`y-${newId()}`);
    const token = await fixture.agentToken(x.name, ['manage-clients', 'view-users'], {
      scope: 'mcp:read',
      act: ACT,
      via: 'mcp',
      assistant: true,
      targetTenantId: y.id,
    });
    expect([401, 403]).toContain((await get(y.name, '/settings', token)).statusCode);
    expect((await get(x.name, '/settings', token)).statusCode).toBe(403);
  });
});
