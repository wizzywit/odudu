import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, clientRepository } from '@odudu/domain-tenant';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '#/cli/seed';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';

// A client that is allowed to exchange tokens can turn an MCP token into an
// admin-audience token carrying `act`, and call the admin API with it directly.
// Only the MCP endpoint signs the marker that says it records the call, so such
// a call is recorded at the admin API's door like any other agent call.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS = 'urn:ietf:params:oauth:token-type:access_token';
const HOST = 'id.example.com';

async function exchanged(w: Awaited<ReturnType<McpStack['world']>>, subjectToken: string) {
  await seed([
    'client',
    '--tenant',
    w.name,
    '--client-id',
    'xchg',
    '--public',
    '--redirect-uri',
    'https://x.example/cb',
    '--grant-type',
    EXCHANGE,
    '--token-exchange-allowed-for-public',
  ]);
  await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const row = await clientRepository(tx).byClientId('xchg');
    if (row === null) throw new Error('no xchg');
    await tx
      .update(clientOidcConfig)
      .set({ tokenExchangeImpersonationAllowed: true, audiences: [ADMIN_API_AUDIENCE] })
      .where(eq(clientOidcConfig.clientId, row.id));
  });
  const res = await stack.app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/protocol/openid-connect/token`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: EXCHANGE,
      client_id: 'xchg',
      subject_token: subjectToken,
      subject_token_type: ACCESS,
      scope: 'mcp:read',
      resource: ADMIN_API_AUDIENCE,
    }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

describe('an act token an exchange made, used at the admin API directly', () => {
  it('carries act and no marker, and its call is recorded at the door', async () => {
    const w = await stack.world(['manage-clients'], 'mcp:read');
    const token = await exchanged(w, await stack.sign(w, 'mcp:read'));
    const claims = claimsOf(token);
    expect(claims.act).toEqual({ sub: 'xchg' });
    expect(claims).not.toHaveProperty('via');
    const res = await stack.app.inject({
      method: 'GET',
      url: `/admin/tenants/${w.name}/whoami`,
      headers: { host: HOST, authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await stack.auditRows(w, 'agent.tool_call');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ tool: 'admin.get.whoami' });
  }, 60_000);

  it('does not inherit the marker from a token that had it', async () => {
    const w = await stack.world(['manage-clients'], 'mcp:read');
    const signed = await stack.sign(w, 'mcp:read', { via: 'mcp' });
    const token = await exchanged(w, signed);
    expect(claimsOf(token)).not.toHaveProperty('via');
  }, 60_000);

  it('leaves a call through the MCP endpoint with only the endpoint’s row', async () => {
    const w = await stack.world(['manage-clients'], 'mcp:read');
    const result = await stack.call(w, await stack.sign(w, 'mcp:read'), 'whoami');
    expect(result.isError).toBe(false);
    const rows = await stack.auditRows(w, 'agent.tool_call');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ tool: 'whoami' });
  }, 60_000);
});
