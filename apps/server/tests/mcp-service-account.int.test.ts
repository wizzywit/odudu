import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { groups, roles } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type ToolResult } from '@odudu/mcp';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { clientScopes } from '@odudu/domain-tenant';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '#/cli/seed';
import { BASE, type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// A service account holding mcp:write and manage-tenant reaches the MCP endpoint
// with a token of its own, and the endpoint exchanges it for an admin token that
// carries the endpoint's marker. No person signed in to that grant, so nothing
// counts a create for it against anybody's sign-in: the tools that create are
// refused it, by name too, and the tools that amend are not.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const SECRET = 'service-account-secret-123456';

async function serviceAccountToken(): Promise<{
  w: Pick<World, 'name' | 'tenantId' | 'issuer'>;
  token: string;
}> {
  const name = `svc-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
  });
  const mcp = `${BASE}/tenants/${name}/mcp`;
  await seed([
    'client',
    '--tenant',
    name,
    '--client-id',
    'agent-svc',
    '--client-secret',
    SECRET,
    '--grant-type',
    'client_credentials',
    '--client-credentials-scope',
    'mcp:read',
    '--client-credentials-scope',
    'mcp:write',
    '--audience',
    mcp,
  ]);
  await withTenant(stack.appDb.db, seeded.tenantId, async (tx) => {
    const row = await clientRepository(tx).byClientId('agent-svc');
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (row === null || admin === null || row.serviceSubjectId === null) {
      throw new Error('no service account');
    }
    await tx
      .update(clientOidcConfig)
      .set({ audiences: [mcp] })
      .where(eq(clientOidcConfig.clientId, row.id));
    const role = await roleRepository(tx).byName('manage-tenant', admin.id);
    if (role === null) throw new Error('no manage-tenant role');
    await roleRepository(tx).assignToSubject(row.serviceSubjectId, role.id);
  });
  const res = await stack.app.inject({
    method: 'POST',
    url: `/tenants/${name}/protocol/openid-connect/token`,
    headers: {
      host: new URL(BASE).host,
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`agent-svc:${SECRET}`).toString('base64')}`,
    },
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'mcp:write',
      resource: mcp,
    }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  const token = res.json<{ access_token: string }>().access_token;
  return { w: { name, tenantId: seeded.tenantId, issuer: `${BASE}/tenants/${name}` }, token };
}

const counts = (tenantId: string) =>
  withTenant(stack.appDb.db, tenantId, async (tx) => ({
    roles: (await tx.select({ id: roles.id }).from(roles)).length,
    groups: (await tx.select({ id: groups.id }).from(groups)).length,
    scopes: (await tx.select({ id: clientScopes.id }).from(clientScopes)).length,
  }));

function errorOf(result: ToolResult) {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(true);
  return (result.structuredContent as { error: { type: string; status: number } }).error;
}

describe('a service account at the MCP endpoint', () => {
  it('is refused every create, called by name, and nothing is made', async () => {
    const { w, token } = await serviceAccountToken();
    const before = await counts(w.tenantId);
    for (const [tool, args] of [
      ['create_role', { name: 'by-service' }],
      ['create_group', { name: 'by-service' }],
      ['create_scope', { name: 'by-service' }],
    ] as const) {
      const result = await stack.call(w as World, token, tool, {
        idempotency_key: `k-${newId()}`,
        ...args,
      });
      expect(errorOf(result).status, tool).toBe(403);
    }
    expect(await counts(w.tenantId)).toEqual(before);
  });

  it('is not offered the creates in tools/list, and is still offered the amendments', async () => {
    const { w, token } = await serviceAccountToken();
    const res = await stack.send(w as World, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const names = (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith('create_'))).toEqual([]);
    expect(names).toContain('update_role_description');
  });
});
