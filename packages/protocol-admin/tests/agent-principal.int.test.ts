import { newId } from '@odudu/kernel';
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

function whoami(tenant: string, token: string, targetTenant = tenant) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${targetTenant}/whoami`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('the admin API and the agent a token names', () => {
  it('admits an ordinary admin token, which names no agent', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await whoami(t.name, await fixture.adminToken(t.name, ['manage-users']));
    expect(res.statusCode).toBe(200);
  });

  it('admits an act token holding an MCP scope', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-users'], {
      scope: 'mcp:read',
      act: { sub: 'agent-client' },
    });
    expect((await whoami(t.name, token)).statusCode).toBe(200);
  });

  it('admits the built-in MCP client holding an MCP scope with no act', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-users'], {
      scope: 'mcp:write',
      viaMcpClient: true,
    });
    expect((await whoami(t.name, token)).statusCode).toBe(200);
  });

  it.each([
    ['an act token holding no MCP scope', { scope: 'openid', act: { sub: 'agent-client' } }],
    ['the built-in MCP client holding no MCP scope', { scope: 'openid', viaMcpClient: true }],
  ])('answers 403 to %s, whatever its owner may do', async (_, options) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-users'], options);
    const res = await whoami(t.name, token);
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Forbidden' });
  });

  it('answers 401 to an act token that is malformed', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.agentToken(t.name, ['manage-users'], {
      scope: 'mcp:read',
      act: 'agent-client',
    });
    expect((await whoami(t.name, token)).statusCode).toBe(401);
  });

  it('answers 401 to an MCP-scoped token another tenant signed', async () => {
    const target = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`evil-${newId()}`);
    const token = await fixture.agentToken(other.name, ['manage-users'], {
      scope: 'mcp:read',
      act: { sub: 'agent-client' },
    });
    expect((await whoami(other.name, token, target.name)).statusCode).toBe(401);
  });
});
