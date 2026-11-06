import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import type { ToolResult } from '@odudu/mcp';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The two write tools through the real endpoint, the real admin API and a real
// database: what an agent with `mcp:write` can change, and what refuses it.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const OWNER_CAPS = ['manage-clients', 'manage-tenant', 'view-audit'];
const WRITE = 'mcp:read mcp:write';

interface Rec {
  readonly data: Record<string, unknown>;
  readonly etag: string;
}

function recOf(result: ToolResult): Rec {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return result.structuredContent as unknown as Rec;
}

function errorOf(result: ToolResult): {
  type: string;
  title: string;
  status: number;
  detail?: string;
} {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: never }).error;
}

async function portal(w: World) {
  return withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const row = await clientRepository(tx).byClientId('portal');
    if (row === null) throw new Error('no portal client');
    return row;
  });
}

async function clientRow(w: World, id: string) {
  return withTenant(stack.appDb.db, w.tenantId, (tx) => clientRepository(tx).byId(id));
}

async function actionRows(w: World, action: string) {
  return withTenant(stack.appDb.db, w.tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );
}

describe('update_client_metadata', () => {
  it('amends the name and description under the etag of a read, and the audit row shows that diff alone', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = (await portal(w)).id;
    const read = recOf(await stack.call(w, token, 'get_client', { id }));
    expect(read.etag).toMatch(/^"[0-9a-f]{64}"$/u);

    const updated = recOf(
      await stack.call(w, token, 'update_client_metadata', {
        id,
        if_match: read.etag,
        name: 'Billing portal',
        description: 'Where customers pay',
      }),
    );
    expect(updated.data).toMatchObject({
      name: 'Billing portal',
      description: 'Where customers pay',
    });
    expect(updated.etag).not.toBe(read.etag);
    expect((await clientRow(w, id))?.name).toBe('Billing portal');

    const [row, ...rest] = await actionRows(w, 'client.amend');
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      resourceId: id,
    });
    expect(row?.detail).toEqual({
      name: { before: 'portal', after: 'Billing portal' },
      description: { before: null, after: 'Where customers pay' },
    });
    const calls = await actionRows(w, 'agent.tool_call');
    expect(calls.map((c) => [c.outcome, (c.detail as { tool: string }).tool])).toEqual([
      ['allowed', 'get_client'],
      ['allowed', 'update_client_metadata'],
    ]);
  });

  it('is idempotent: the same call again, with the new etag, changes nothing more', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = (await portal(w)).id;
    const read = recOf(await stack.call(w, token, 'get_client', { id }));
    const args = { id, if_match: read.etag, description: 'Same text' };
    const first = recOf(await stack.call(w, token, 'update_client_metadata', args));
    const second = recOf(
      await stack.call(w, token, 'update_client_metadata', { ...args, if_match: first.etag }),
    );
    expect(second.etag).toBe(first.etag);
    expect(second.data).toEqual(first.data);
  });

  it('answers a stale etag as a 412 that says to read again, and changes nothing', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = (await portal(w)).id;
    const read = recOf(await stack.call(w, token, 'get_client', { id }));
    recOf(
      await stack.call(w, token, 'update_client_metadata', {
        id,
        if_match: read.etag,
        description: 'first',
      }),
    );
    const stale = errorOf(
      await stack.call(w, token, 'update_client_metadata', {
        id,
        if_match: read.etag,
        description: 'second',
      }),
    );
    expect(stale).toMatchObject({ status: 412, title: 'Precondition Failed' });
    expect(stale.detail).toMatch(/read it again/iu);
    expect((await clientRow(w, id))?.description).toBe('first');
    expect(await actionRows(w, 'client.amend')).toHaveLength(1);
    const calls = await actionRows(w, 'agent.tool_call');
    expect(calls.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('refuses a call with no if_match, a wildcard and an argument outside the schema, asking the admin API nothing', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const before = await clientRow(w, (await portal(w)).id);
    const id = before?.id ?? '';
    const etag = recOf(await stack.call(w, token, 'get_client', { id })).etag;
    const seen = stack.adminSeen.length;
    const attempts: Record<string, unknown>[] = [
      { id, name: 'x' },
      { id, if_match: '*', name: 'x' },
      { id, if_match: etag, enabled: false },
      { id, if_match: etag, redirect_uris: ['https://evil.example/cb'] },
      { id, if_match: etag, roles: ['admin'] },
      { id, if_match: etag, client_name: 'x' },
      { id, if_match: etag, consent_text: 'x' },
      { id, if_match: etag, tenant: 'other', name: 'x' },
      { id, if_match: etag, name: 'x', surprise: true },
    ];
    for (const args of attempts) {
      const result = await stack.call(w, token, 'update_client_metadata', args);
      expect(errorOf(result).type, JSON.stringify(args)).toBe('mcp:invalid_arguments');
    }
    // Fastify's own JSON parser refuses a body that sets the prototype, before
    // any of this runs.
    const proto = JSON.parse(
      `{"id":"${id}","if_match":${JSON.stringify(etag)},"__proto__":{"enabled":false}}`,
    ) as Record<string, unknown>;
    const poisoned = await stack.send(w, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'update_client_metadata', arguments: proto },
    });
    expect(poisoned.status).toBe(400);
    expect(stack.adminSeen.slice(seen)).toEqual([]);
    expect(await clientRow(w, id)).toEqual(before);
    expect(await actionRows(w, 'client.amend')).toHaveLength(0);
  });

  it('refuses an owner without manage-clients, by the admin API, and records it', async () => {
    const w = await stack.world(['manage-tenant'], WRITE);
    const token = await stack.sign(w, WRITE);
    const row = await portal(w);
    const refused = errorOf(
      await stack.call(w, token, 'update_client_metadata', {
        id: row.id,
        if_match: `"${'0'.repeat(64)}"`,
        name: 'Hijacked',
      }),
    );
    expect(refused.status).toBe(403);
    expect((await clientRow(w, row.id))?.name).toBe(row.name);
    const calls = await actionRows(w, 'agent.tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      outcome: 'refused',
      detail: { tool: 'update_client_metadata', reason: 'missing_capability' },
    });
    const refusals = await actionRows(w, 'capability.refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      outcome: 'refused',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      detail: { capability: 'manage-clients', reason: 'missing_capability' },
    });
    expect(await actionRows(w, 'client.amend')).toHaveLength(0);
  });

  it('cannot rename a built-in client: the admin API refuses it and leaves it as it was', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const before = await clientRow(w, w.adminDbId);
    const etag = recOf(await stack.call(w, token, 'get_client', { id: w.adminDbId })).etag;
    for (const args of [{ name: 'Not the console' }, { name_i18n: { en: 'Not the console' } }]) {
      const refused = errorOf(
        await stack.call(w, token, 'update_client_metadata', {
          id: w.adminDbId,
          if_match: etag,
          ...args,
        }),
      );
      expect(refused.status).toBe(403);
    }
    expect(await clientRow(w, w.adminDbId)).toEqual(before);
    const refusals = await actionRows(w, 'capability.refused');
    expect(refusals).toHaveLength(2);
    for (const r of refusals) {
      expect(r).toMatchObject({
        actorClientId: w.agentDbId,
        detail: { reason: 'insufficient_scope' },
      });
    }
  });
});

describe('update_scope_metadata', () => {
  it('amends a scope description, and the audit row shows that field alone', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const listed = recOf(await stack.call(w, token, 'list_scopes', { limit: 50 }));
    const scope = (listed.data as unknown as { id: string; name: string }[]).find(
      (s) => s.name === 'profile',
    );
    if (scope === undefined) throw new Error('no profile scope');
    const read = recOf(await stack.call(w, token, 'get_scope', { id: scope.id }));
    const unsupported = errorOf(
      await stack.call(w, token, 'update_scope_metadata', {
        id: scope.id,
        if_match: read.etag,
        description_i18n: { tlh: 'Qapla' },
      }),
    );
    expect(unsupported).toMatchObject({ status: 400 });
    expect(unsupported.detail).toMatch(/supported_locales/u);
    expect(await actionRows(w, 'scope.amend')).toHaveLength(0);
    const updated = recOf(
      await stack.call(w, token, 'update_scope_metadata', {
        id: scope.id,
        if_match: read.etag,
        description: 'Your name and picture',
        description_i18n: { en: 'Your name and picture' },
      }),
    );
    expect(updated.data).toMatchObject({
      description: 'Your name and picture',
      description_i18n: { en: 'Your name and picture' },
    });
    const [row, ...rest] = await actionRows(w, 'scope.amend');
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
    });
    expect(Object.keys(row?.detail ?? {}).sort()).toEqual(['description', 'description_i18n']);

    const stale = errorOf(
      await stack.call(w, token, 'update_scope_metadata', {
        id: scope.id,
        if_match: read.etag,
        description: 'again',
      }),
    );
    expect(stale.status).toBe(412);
  });

  it('refuses the scope’s name and consent text: they are not in the schema', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = '0192a0a0-0000-7000-8000-000000000001';
    const etag = `"${'0'.repeat(64)}"`;
    const seen = stack.adminSeen.length;
    for (const extra of [{ name: 'x' }, { consent_text: 'x' }, { include_in_id_token: false }]) {
      const result = await stack.call(w, token, 'update_scope_metadata', {
        id,
        if_match: etag,
        description: 'x',
        ...extra,
      });
      expect(errorOf(result).type).toBe('mcp:invalid_arguments');
    }
    expect(stack.adminSeen.slice(seen)).toEqual([]);
  });
});

describe('what the token decides', () => {
  const NAMES = ['update_client_metadata', 'update_scope_metadata'];

  async function listed(
    w: World,
    token: string,
  ): Promise<{ name: string; annotations: unknown }[]> {
    const res = await stack.send(w, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    return (res.json().result as { tools: { name: string; annotations: unknown }[] }).tools;
  }

  it('lists the write tools, hinted as reversible and idempotent, to mcp:write alone', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const write = await listed(w, await stack.sign(w, 'mcp:write'));
    const tools = write.filter((t) => NAMES.includes(t.name));
    expect(tools.map((t) => t.name)).toEqual(NAMES);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    const read = await listed(w, await stack.sign(w, 'mcp:read'));
    expect(read.some((t) => NAMES.includes(t.name))).toBe(false);
  });

  it('refuses a write by name to a read token, and the row says it was refused for its scope', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, 'mcp:read');
    const row = await portal(w);
    const refused = errorOf(
      await stack.call(w, token, 'update_client_metadata', {
        id: row.id,
        if_match: `"${'0'.repeat(64)}"`,
        name: 'x',
      }),
    );
    expect(refused).toMatchObject({ type: 'mcp:insufficient_scope', status: 403 });
    expect(await clientRow(w, row.id)).toEqual(row);
    const calls = await actionRows(w, 'agent.tool_call');
    expect(calls[0]).toMatchObject({
      outcome: 'refused',
      detail: { reason: 'insufficient_scope' },
    });
  });

  it('is refused by the admin API itself when this layer would let a read token through', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const row = await portal(w);
    const result = await stack.runUnguarded(w, ['mcp:read'], 'update_client_metadata', {
      id: row.id,
      if_match: `"${'0'.repeat(64)}"`,
      name: 'Hijacked',
    });
    expect(errorOf(result)).toMatchObject({
      status: 403,
      detail: expect.stringMatching(/^insufficient_scope/u) as unknown,
    });
    expect(await clientRow(w, row.id)).toEqual(row);
    const refusals = await actionRows(w, 'capability.refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      outcome: 'refused',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      detail: { reason: 'insufficient_scope' },
    });
    expect(await actionRows(w, 'client.amend')).toHaveLength(0);
  });

  it('still works at the 600 s cap of a write token, and a call after it ends is a 401', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const iat = Math.floor(Date.now() / 1000);
    const atCap = await stack.sign(w, 'mcp:write', { iat, exp: iat + 600 });
    const id = (await portal(w)).id;
    const etag = recOf(await stack.call(w, atCap, 'get_client', { id })).etag;
    recOf(
      await stack.call(w, atCap, 'update_client_metadata', {
        id,
        if_match: etag,
        description: 'd',
      }),
    );
    const ended = await stack.sign(w, 'mcp:write', { iat: iat - 700, exp: iat - 100 });
    const res = await stack.send(w, ended, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_client', arguments: { id } },
    });
    expect(res.status).toBe(401);
  });
});

describe('text the database cannot hold', () => {
  it('is a 400 from the admin API itself, for a client and for a scope, and changes nothing', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const caller = stack.unguardedCaller(w, ['mcp:read', 'mcp:write']);
    const id = (await portal(w)).id;
    const scopes = await caller.call({
      method: 'GET',
      pattern: '/admin/tenants/:tenant/scopes',
      params: {},
      query: { limit: '50' },
    });
    const scopeId = (scopes.body as { items: { id: string; name: string }[] }).items.find(
      (s) => s.name === 'profile',
    )?.id;
    if (scopeId === undefined) throw new Error('no profile scope');
    const before = await clientRow(w, id);
    for (const [pattern, target, body] of [
      ['/admin/tenants/:tenant/clients/:id', id, { description: 'a\u0000b' }],
      ['/admin/tenants/:tenant/clients/:id', id, { name: 'a\u0000b' }],
      ['/admin/tenants/:tenant/clients/:id', id, { name_i18n: { en: 'a\u0000b' } }],
      ['/admin/tenants/:tenant/scopes/:id', scopeId, { description: 'a\u0000b' }],
      ['/admin/tenants/:tenant/scopes/:id', scopeId, { description_i18n: { en: 'a\u0000b' } }],
    ] as const) {
      const res = await caller.call({
        method: 'PATCH',
        pattern,
        params: { id: target },
        query: {},
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await clientRow(w, id)).toEqual(before);
  });
});

describe('clearing text', () => {
  it('takes null for a description and an empty map for a language text, and the audit row keeps what was there', async () => {
    const w = await stack.world(OWNER_CAPS, WRITE);
    const token = await stack.sign(w, WRITE);
    const id = (await portal(w)).id;
    const etag = async () => recOf(await stack.call(w, token, 'get_client', { id })).etag;
    const set = recOf(
      await stack.call(w, token, 'update_client_metadata', {
        id,
        if_match: await etag(),
        description: 'Where customers pay',
        description_i18n: { en: 'Where customers pay' },
      }),
    );
    const cleared = recOf(
      await stack.call(w, token, 'update_client_metadata', {
        id,
        if_match: set.etag,
        description: null,
        description_i18n: {},
      }),
    );
    expect(cleared.data).toMatchObject({ description: null, description_i18n: {} });
    const rows = await actionRows(w, 'client.amend');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.detail).toEqual({
      description: { before: 'Where customers pay', after: null },
      description_i18n: { before: { en: 'Where customers pay' }, after: {} },
    });
  });
});

describe('a real list through the endpoint', () => {
  it('is paged by the cursor the admin API signs, which the tool passes on untouched', async () => {
    const w = await stack.world(OWNER_CAPS, 'mcp:read');
    const token = await stack.sign(w, 'mcp:read');
    const first = await stack.call(w, token, 'list_clients', { limit: 1 });
    const one = first.structuredContent as { data: { id: string }[]; next_cursor?: string };
    expect(one.data).toHaveLength(1);
    expect(one.next_cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    const second = await stack.call(w, token, 'list_clients', {
      limit: 1,
      cursor: one.next_cursor,
    });
    const two = second.structuredContent as { data: { id: string }[] };
    expect(second.isError).toBe(false);
    expect(two.data).toHaveLength(1);
    expect(two.data[0]?.id).not.toBe(one.data[0]?.id);
  });
});
