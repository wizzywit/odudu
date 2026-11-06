import { clientInstallationSchema } from '@odudu/contracts/admin';
import type { ToolResult } from '@odudu/mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// Six small reads through the real endpoint, the real admin API and a real
// database: each answers its own tenant's data under `data`, and the one
// tenant it can read is the one the token was issued for.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const READ = 'mcp:read';
const CAPS = ['manage-tenant', 'manage-clients', 'view-users', 'view-domains'];
const SIX = [
  'get_tenant',
  'get_username_policy',
  'get_passkey_impact',
  'get_scope_impact',
  'list_builtin_scopes',
  'get_client_installation',
];

function data(result: ToolResult): Record<string, unknown> {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return (result.structuredContent as { data: Record<string, unknown> }).data;
}

function rows(result: ToolResult): { id: string; name: string }[] {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return (result.structuredContent as { data: { id: string; name: string }[] }).data;
}

function refusal(result: ToolResult): { type: string; status?: number } {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: { type: string; status?: number } }).error;
}

async function listed(w: World, token: string): Promise<string[]> {
  const res = await stack.send(w, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

describe('a tenant administrator’s agent reading the small records', () => {
  it('is offered all six, and reads its own tenant’s record', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const names = await listed(w, token);
    for (const tool of SIX) expect(names).toContain(tool);
    const tenant = data(await stack.call(w, token, 'get_tenant', {}));
    expect(tenant).toMatchObject({ id: w.tenantId, name: w.name, enabled: true });
  });

  it('reads the username policy, the passkey impact and the built-in scopes', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    expect(data(await stack.call(w, token, 'get_username_policy', {}))).toHaveProperty(
      'username_editable',
    );
    const impact = data(await stack.call(w, token, 'get_passkey_impact', { canonical: 'path' }));
    expect(impact).toEqual({ subjects: 0, capped: false });
    const builtins = data(await stack.call(w, token, 'list_builtin_scopes', {}));
    const items = builtins.items as { name: string; present: boolean }[];
    expect(items.map((item) => item.name)).toContain('openid');
    expect(items.length).toBeLessThanOrEqual(50);
  });

  it('counts what deleting a scope takes with it', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const [scope] = rows(await stack.call(w, token, 'list_scopes', { limit: 1 }));
    expect(scope).toBeDefined();
    const impact = data(await stack.call(w, token, 'get_scope_impact', { id: scope?.id }));
    expect(Object.keys(impact).sort()).toEqual(['builtin', 'client_assignments', 'role_mappings']);
  });

  it('reads a client’s installation, which holds the contract’s keys and no secret', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const found = rows(await stack.call(w, token, 'list_clients', { client_id: 'portal' }));
    const installation = data(
      await stack.call(w, token, 'get_client_installation', { id: found[0]?.id }),
    );
    expect(Object.keys(installation).sort()).toEqual(
      Object.keys(clientInstallationSchema.shape).sort(),
    );
    expect(installation.client_id).toBe('portal');
    expect(installation.issuer).toBe(w.issuer);
    expect(Object.keys(installation).filter((key) => key.includes('secret'))).toEqual([]);
  });

  it('cannot read another tenant’s record through any argument', async () => {
    const mine = await stack.world(CAPS, READ);
    const other = await stack.world(CAPS, READ);
    const token = await stack.sign(mine, READ);
    const seen = stack.adminSeen.length;
    for (const extra of [
      { tenant: other.name },
      { tenant: other.tenantId },
      { id: other.tenantId },
      { name: other.name },
    ]) {
      expect(refusal(await stack.call(mine, token, 'get_tenant', extra)).type).toBe(
        'mcp:invalid_arguments',
      );
    }
    expect(stack.adminSeen.slice(seen)).toEqual([]);
    const own = data(await stack.call(mine, token, 'get_tenant', {}));
    expect(own.name).toBe(mine.name);
    expect(JSON.stringify(own)).not.toContain(other.name);
  });

  it('cannot read another tenant’s client installation by its id', async () => {
    const mine = await stack.world(CAPS, READ);
    const other = await stack.world(CAPS, READ);
    const otherToken = await stack.sign(other, READ);
    const theirs = rows(
      await stack.call(other, otherToken, 'list_clients', { client_id: 'portal' }),
    );
    const token = await stack.sign(mine, READ);
    const result = await stack.call(mine, token, 'get_client_installation', { id: theirs[0]?.id });
    expect(refusal(result).status).toBe(404);
  });

  it('cannot read another tenant’s scope impact by its id', async () => {
    const mine = await stack.world(CAPS, READ);
    const other = await stack.world(CAPS, READ);
    const otherToken = await stack.sign(other, READ);
    const [theirs] = rows(await stack.call(other, otherToken, 'list_scopes', { limit: 1 }));
    const token = await stack.sign(mine, READ);
    const result = await stack.call(mine, token, 'get_scope_impact', { id: theirs?.id });
    expect(refusal(result).status).toBe(404);
  });

  it('keeps the client evaluation refused at the door, and offers no tool for it', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    expect(await listed(w, token)).not.toContain('evaluate_client');
    const [client] = rows(await stack.call(w, token, 'list_clients', { client_id: 'portal' }));
    const caller = stack.unguardedCaller(w, [READ]);
    const res = await caller.call({
      method: 'GET',
      pattern: '/admin/tenants/:tenant/clients/:id/evaluate',
      params: { id: client?.id ?? '' },
      query: { subject: w.subjectId },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });
});

describe('an agent whose owner lacks the capability', () => {
  it('is not offered the tool and is refused when it calls it by name', async () => {
    const w = await stack.world(['view-users'], READ);
    const token = await stack.sign(w, READ);
    const names = await listed(w, token);
    expect(names).toContain('get_username_policy');
    for (const tool of ['get_tenant', 'get_scope_impact', 'list_builtin_scopes']) {
      expect(names).not.toContain(tool);
    }
    expect(refusal(await stack.call(w, token, 'get_tenant', {})).status).toBe(403);
  });
});
