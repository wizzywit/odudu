import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { eq } from 'drizzle-orm';
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

describe('admission of an agent by its scope', () => {
  async function world() {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-clients', 'manage-tenant']);
    const authorization = { authorization: `Bearer ${admin}` };
    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients?client_id=odudu-mcp`,
      headers: authorization,
    });
    const client = list.json<{ items: { id: string }[] }>().items[0];
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { ...authorization, 'content-type': 'application/json' },
      payload: { name: `s-${newId()}` },
    });
    if (client === undefined) throw new Error('no odudu-mcp client');
    return { t, clientId: client.id, scopeId: created.json<{ id: string }>().id };
  }

  function patch(tenant: string, path: string, token: string, payload: unknown) {
    return fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenant}/${path}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: payload as object,
    });
  }

  async function refusals(tenantId: string) {
    return withTenant(fixture.app.db, tenantId, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'capability.refused')),
    );
  }

  const OWNER = ['manage-clients', 'manage-tenant'];

  it('lets mcp:write amend descriptive fields of a client and a scope', async () => {
    const w = await world();
    const token = await fixture.agentToken(w.t.name, OWNER, {
      scope: 'mcp:write',
      act: { sub: 'a' },
    });
    const client = await patch(w.t.name, `clients/${w.clientId}`, token, {
      description: 'by an agent',
      name: 'Odudu MCP agent-renamed',
    });
    expect(client.statusCode).toBe(200);
    expect(client.json()).toMatchObject({ description: 'by an agent' });
    const scope = await patch(w.t.name, `scopes/${w.scopeId}`, token, { description: 'x' });
    expect(scope.statusCode).toBe(200);
  });

  it.each([
    ['clients', { enabled: false }],
    ['clients', { redirect_uris: ['https://evil.example/cb'] }],
    ['clients', { description: 'ok', enabled: false }],
    ['scopes', { consent_text: 'agree to everything' }],
    ['scopes', { include_in_access_token: false }],
  ])('refuses mcp:write amending %s with %j, and changes nothing', async (kind, payload) => {
    const w = await world();
    const token = await fixture.agentToken(w.t.name, OWNER, {
      scope: 'mcp:write',
      act: { sub: 'a' },
    });
    const id = kind === 'clients' ? w.clientId : w.scopeId;
    const res = await patch(w.t.name, `${kind}/${id}`, token, payload);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ title: 'Forbidden', detail: 'insufficient_scope' });
    const rows = await refusals(w.t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'refused',
      detail: { reason: 'insufficient_scope' },
    });
    expect(rows[0]?.actorClientId).not.toBeNull();
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('evil');
  });

  it('refuses mcp:read a write and mcp:write a route outside the allowlist', async () => {
    const w = await world();
    const read = await fixture.agentToken(w.t.name, OWNER, {
      scope: 'mcp:read',
      act: { sub: 'a' },
    });
    const write = await fixture.agentToken(w.t.name, OWNER, {
      scope: 'mcp:write',
      act: { sub: 'a' },
    });
    expect(
      (await patch(w.t.name, `scopes/${w.scopeId}`, read, { description: 'x' })).statusCode,
    ).toBe(403);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${w.t.name}/scopes`,
      headers: { authorization: `Bearer ${write}`, 'content-type': 'application/json' },
      payload: { name: `s-${newId()}` },
    });
    expect(created.statusCode).toBe(403);
    for (const token of [read, write]) {
      const get = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${w.t.name}/scopes`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(get.statusCode).toBe(200);
    }
    expect(await refusals(w.t.id)).toHaveLength(2);
  });

  it('still needs the owner’s capability: both gates must pass', async () => {
    const w = await world();
    const token = await fixture.agentToken(w.t.name, ['manage-users'], {
      scope: 'mcp:write',
      act: { sub: 'a' },
    });
    const res = await patch(w.t.name, `scopes/${w.scopeId}`, token, { description: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ title: 'Forbidden' });
  });

  it('records the agent token without an MCP scope as a refusal', async () => {
    const w = await world();
    const token = await fixture.agentToken(w.t.name, OWNER, { scope: 'openid', act: { sub: 'a' } });
    expect((await whoami(w.t.name, token)).statusCode).toBe(403);
    const rows = await refusals(w.t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ detail: { reason: 'agent_without_mcp_scope' } });
    expect(rows[0]?.actorClientId).not.toBeNull();
    expect(rows[0]?.actorSubjectId).not.toBeNull();
  });

  it('leaves an ordinary console token unaffected', async () => {
    const w = await world();
    const token = await fixture.adminToken(w.t.name, OWNER);
    const res = await patch(w.t.name, `clients/${w.clientId}`, token, {
      description: 'by a person',
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await patch(w.t.name, `clients/${w.clientId}`, token, { enabled: true })).statusCode,
    ).toBe(200);
  });
});
