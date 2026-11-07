import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  callMcpTool,
  contentWriteTool,
  createInProcessCaller,
  descriptionField,
  nameField,
  validatedMcpToken,
  type AdminCaller,
  type ToolResult,
} from '@odudu/mcp';
import { recordAgentToolCall } from '@odudu/protocol-admin';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { roleSchema } from '@odudu/contracts/admin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantWriteBudget } from '#/mcp-deps';
import { BASE, type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';
import { MCP_CLIENT_ID } from '@odudu/domain-tenant';

// The write budget of one grant, in a real database: twenty mutating calls and
// ten creates, spent by calls made one after another over the endpoint and by
// calls made all at once, and a create that is sent again is made once.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const OWNER_CAPS = ['manage-clients', 'manage-tenant', 'view-audit'];
const WRITE = 'mcp:read mcp:write';

function errorOf(result: ToolResult): { type: string; status: number } {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: { type: string; status: number } }).error;
}

function budgetOf(w: World) {
  return grantWriteBudget(stack.appDb, {
    tenant: { id: w.tenantId, name: w.name },
    grantId: w.grantId,
  });
}

async function portal(w: World) {
  return withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const row = await clientRepository(tx).byClientId('portal');
    if (row === null) throw new Error('no portal client');
    return row;
  });
}

async function change(w: World, token: string, id: string, etag: string, description: string) {
  return stack.call(w, token, 'update_client_metadata', { id, if_match: etag, description });
}

describe('over the endpoint', () => {
  it('refuses the twenty-first change, audits it as refused, and still reads', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = (await portal(w)).id;
    const read = await stack.call(w, token, 'get_client', { id });
    let etag = (read.structuredContent as { etag: string }).etag;

    const stale = await change(w, token, id, `"${'0'.repeat(64)}"`, 'stale');
    expect(errorOf(stale).status).toBe(412);

    for (let i = 0; i < 20; i += 1) {
      const done = await change(w, token, id, etag, `text ${String(i)}`);
      expect(done.isError, JSON.stringify(done.structuredContent)).toBe(false);
      etag = (done.structuredContent as { etag: string }).etag;
    }
    const over = await change(w, token, id, etag, 'one too many');
    expect(errorOf(over)).toMatchObject({ type: 'mcp:write_budget', status: 429 });

    expect((await stack.call(w, token, 'get_client', { id })).isError).toBe(false);
    const row = await withTenant(stack.appDb.db, w.tenantId, (tx) => clientRepository(tx).byId(id));
    expect(row?.description).toBe('text 19');

    const rows = (await stack.auditRows(w, 'agent.tool_call')).filter(
      (r) => (r.detail as { tool: string }).tool === 'update_client_metadata',
    );
    expect(rows.map((r) => r.outcome).sort()).toEqual([
      ...Array.from({ length: 20 }, () => 'allowed'),
      'failed',
      'refused',
    ]);
    const refused = rows.find((r) => r.outcome === 'refused');
    expect(refused?.detail).toMatchObject({ reason: 'write_budget' });
  });

  it('keeps one budget for each token', async () => {
    const first = await stack.world(OWNER_CAPS, WRITE);
    const second = await stack.world(OWNER_CAPS, WRITE);
    const spend = async (w: World) => {
      const token = await stack.sign(w, WRITE);
      const id = (await portal(w)).id;
      const read = await stack.call(w, token, 'get_client', { id });
      return change(w, token, id, (read.structuredContent as { etag: string }).etag, 'text');
    };
    for (let i = 0; i < 20; i += 1) expect(await budgetOf(first).reserve('mutating')).toBe(true);
    expect(errorOf(await spend(first)).type).toBe('mcp:write_budget');
    expect((await spend(second)).isError).toBe(false);
  });
});

const ROLE = {
  id: '0192a0a0-0000-7000-8000-000000000001',
  name: 'auditors',
  description: null,
  client_id: null,
  client_key: null,
  default_for_new_subjects: false,
  created_at: '2026-11-07T10:00:00.000Z',
  admin_reach: [],
};
const echoing: AdminCaller = {
  call: () => Promise.resolve({ status: 200, headers: {}, body: ROLE }),
};
const amend = contentWriteTool({
  name: 'amend_role',
  description: 'Amends a role.',
  routeKey: 'PATCH /admin/tenants/:tenant/roles/:id',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'amend',
  fields: { description: descriptionField.optional() },
  response: roleSchema,
});
const create = contentWriteTool({
  name: 'create_role',
  description: 'Creates a role.',
  routeKey: 'POST /admin/tenants/:tenant/roles',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'create',
  fields: { name: nameField },
  response: roleSchema,
});

// The tool, the budget and the audit row as the server wires them, against a
// caller that answers at once, so what is measured is the budget alone.
function callAs(w: World) {
  const principal = {
    subjectId: w.subjectId,
    issuerTenantId: w.tenantId,
    issuerTenantName: w.name,
    clientDbId: w.agentDbId,
    scopes: ['mcp:write'],
    agent: { clientId: MCP_CLIENT_ID, ownerSubjectId: w.subjectId },
  };
  return (tool: typeof amend, args: unknown) =>
    callMcpTool(
      {
        requestId: newId(),
        deadlineMs: 20_000,
        budget: budgetOf(w),
        record: (recorded) =>
          withTenant(stack.appDb.db, w.tenantId, (tx) =>
            recordAgentToolCall(tx, principal, recorded),
          ),
        logger: { error: () => undefined },
      },
      tool,
      echoing,
      args,
    );
}

const ETAG = `"${'a'.repeat(64)}"`;

describe('calls made all at once', () => {
  it('admit twenty of thirty mutating calls, and audit the other ten as refused', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const call = callAs(w);
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        call(amend, { id: newId(), if_match: ETAG, description: 'd' }),
      ),
    );
    expect(results.filter((r) => !r.isError)).toHaveLength(20);
    expect(results.filter((r) => r.isError).map((r) => errorOf(r).type)).toEqual(
      Array.from({ length: 10 }, () => 'mcp:write_budget'),
    );
    const rows = await stack.auditRows(w, 'agent.tool_call');
    expect(rows.filter((r) => r.outcome === 'allowed')).toHaveLength(20);
    const refused = rows.filter((r) => r.outcome === 'refused');
    expect(refused).toHaveLength(10);
    for (const r of refused) expect(r.detail).toMatchObject({ reason: 'write_budget' });
  });

  it('admit ten of twenty-five creates, and the creates leave room for the rest', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const call = callAs(w);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        call(create, { idempotency_key: `role-${String(i)}`, name: `role ${String(i)}` }),
      ),
    );
    expect(results.filter((r) => !r.isError)).toHaveLength(10);
    const others = await Promise.all(
      Array.from({ length: 15 }, () =>
        call(amend, { id: newId(), if_match: ETAG, description: 'd' }),
      ),
    );
    expect(others.filter((r) => !r.isError)).toHaveLength(10);
  });
});

async function adminBearerOf(w: World): Promise<string> {
  return withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: w.adminDbId,
      subjectId: w.subjectId,
      scope: '',
      audience: [ADMIN_API_AUDIENCE],
      sessionId: w.sessionId,
    });
    const key = await signingKeyRepository(tx).active();
    const iat = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: w.issuer,
        sub: w.subjectId,
        aud: [ADMIN_API_AUDIENCE],
        client_id: ADMIN_CLIENT_ID,
        scope: '',
        iat,
        exp: iat + 600,
        jti: newId(),
        grant_id: grantId,
        sid: w.sessionId,
      },
      { key, kek: Buffer.alloc(32, 7), typ: 'at+jwt' },
    );
  });
}

const CREATED = contentWriteTool({
  name: 'create_role',
  description: 'Creates a role.',
  routeKey: 'POST /admin/tenants/:tenant/roles',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'create',
  fields: { name: nameField },
  response: roleSchema,
});

// The key is the admin API's own, so a create sent again is its answer to give.
// The caller's bearer is the owner's own admin token, since the door's
// allowlist holds no create yet; what this reaches is the route and its keys.
describe('a create sent again under the same key', () => {
  async function created(w: World, requestId: string, key: string, name: string) {
    const bearer = await adminBearerOf(w);
    const token = validatedMcpToken({
      tenant: { id: w.tenantId, name: w.name },
      issuer: w.issuer,
      subjectId: w.subjectId,
      clientId: MCP_CLIENT_ID,
      grantId: w.grantId,
      scope: ['mcp:write'],
      expSeconds: Math.floor(Date.now() / 1000) + 600,
    });
    const caller = createInProcessCaller(
      {
        inject: (options) => stack.app.inject(options),
        adminBearer: () => Promise.resolve(bearer),
        requestId,
        ip: '10.1.2.3',
        adminHost: new URL(BASE).host,
        logger: { debug: () => undefined, error: () => undefined },
      },
      token,
    );
    return callMcpTool(
      {
        requestId,
        deadlineMs: 20_000,
        budget: budgetOf(w),
        record: () => Promise.resolve(),
        logger: { error: () => undefined },
      },
      CREATED,
      caller,
      { idempotency_key: key, name },
    );
  }

  async function rolesNamed(w: World, name: string): Promise<number> {
    const rows = await stack.owner.sql<{ n: number }[]>`
      select count(*)::int as n from roles where tenant_id = ${w.tenantId} and name = ${name}`;
    return rows[0]?.n ?? 0;
  }

  it('answers the stored response without a second row, and refuses another body', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const first = await created(w, 'request-1', 'auditors-v1', 'auditors');
    expect(first.isError, JSON.stringify(first.structuredContent)).toBe(false);
    const again = await created(w, 'request-2', 'auditors-v1', 'auditors');
    expect(again.isError, JSON.stringify(again.structuredContent)).toBe(false);
    expect(again.structuredContent).toEqual(first.structuredContent);
    expect(await rolesNamed(w, 'auditors')).toBe(1);

    const other = await created(w, 'request-3', 'auditors-v1', 'readers');
    expect(errorOf(other)).toMatchObject({ status: 422 });
    expect(await rolesNamed(w, 'readers')).toBe(0);
    expect(await rolesNamed(w, 'auditors')).toBe(1);
  });
});
