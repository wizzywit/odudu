import { type Chat, type ChatCaller, writeSettings } from '@odudu/assistant';
import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, ASSISTANT_CLIENT_ID } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import {
  AssistantGrantRefused,
  grantAssistantWrite,
  standardClaimMappers,
  tenantLookupRepository,
} from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantChatFor } from '#/assistant-chat';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { consoleSystemWorld, consoleWorld, type World } from '#/testing/mcp-world';

// A system administrator's approved change in another tenant, against a real
// database and the real admin API: the approval and the grant are rows of the
// administrator's own tenant, the write lands in the target alone, and every
// refusal leaves the target as it was.

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const OPERATOR = ['use-assistant', 'manage-tenants', 'manage-tenant'];
const TENANT_CAPABILITIES = ['use-assistant', 'manage-tenant'];

let stack: McpStack | undefined;

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}

beforeAll(async () => {
  stack = await startMcpStack();
}, 180_000);
afterAll(async () => {
  await stack?.close();
});

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

type Part = Record<string, unknown>;

function toolCall(id: string, name: string, input: unknown): Part[] {
  return [
    { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
  ];
}

function answer(text: string): Part[] {
  return [
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: text },
    { type: 'text-end', id: 'a' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ];
}

function scripted(replies: Part[][]) {
  let call = 0;
  return {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('streaming only')),
    doStream: () => {
      const reply = replies[Math.min(call, replies.length - 1)] ?? [];
      call += 1;
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            for (const part of reply) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

function chatFor(model: unknown): Chat {
  return assistantChatFor({
    app: s().app,
    database: s().appDb,
    ownerDatabase: s().owner,
    kek: KEK,
    claimMappers: standardClaimMappers(),
    logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
    publicBaseUrl: BASE,
    models: () => model as never,
  });
}

// The operator in the system tenant, acting in `target` when one is named.
function callerOf(w: World, target?: World, over: Partial<ChatCaller> = {}): ChatCaller {
  return {
    tenantId: w.tenantId,
    tenantName: w.name,
    issuer: w.issuer,
    ownerSubjectId: w.subjectId,
    grantId: w.grantId,
    requestId: 'req-1',
    ip: '127.0.0.1',
    ...(target === undefined ? {} : { target: { id: target.tenantId, name: target.name } }),
    ...over,
  };
}

async function adminToken(w: World): Promise<string> {
  const key = await withTenant(s().appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
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
      grant_id: w.grantId,
      sid: w.sessionId,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function seedRole(w: World, description: string): Promise<{ id: string; name: string }> {
  const name = `role-${newId().slice(-8)}`;
  const role = await withTenant(s().appDb.db, w.tenantId, (tx) =>
    roleRepository(tx).create({ tenantId: w.tenantId, name, description }),
  );
  return { id: role.id, name };
}

// The role's etag as the operator reads it at the target's path, the way the
// assistant's own read does.
async function roleEtag(operator: World, target: World, id: string): Promise<string> {
  const res = await s().app.inject({
    method: 'GET',
    url: `/admin/tenants/${target.name}/roles/${id}`,
    headers: { host: HOST, authorization: `Bearer ${await adminToken(operator)}` },
  });
  const etag = res.headers.etag;
  if (typeof etag !== 'string') throw new Error(`no etag: ${String(res.statusCode)} ${res.body}`);
  return etag;
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await s().owner.db.execute(query)) as unknown as T[];
}

async function roleDescription(w: World, id: string): Promise<string | null> {
  const found = await rows<{ description: string | null }>(
    sql`select description from roles where id = ${id} and tenant_id = ${w.tenantId}`,
  );
  return found[0]?.description ?? null;
}

// The system tenant is shared by every operator of this file, so the
// administrator's rows are told apart by their person.
async function approvals(w: World): Promise<{ state: string }[]> {
  return rows<{ state: string }>(
    sql`select state from agent_approvals
         where tenant_id = ${w.tenantId} and subject_id = ${w.subjectId} order by created_at`,
  );
}

async function writeGrants(tenantId: string, subjectId?: string) {
  const who = subjectId === undefined ? sql`true` : sql`g.subject_id = ${subjectId}`;
  return rows<{ target_tenant_id: string | null; revoked: boolean }>(
    sql`select g.target_tenant_id, g.revoked_at is not null as revoked
          from token_grants g
          join clients c on c.id = g.client_id and c.tenant_id = g.tenant_id
         where g.tenant_id = ${tenantId} and c.client_id = ${ASSISTANT_CLIENT_ID}
           and g.scope = 'mcp:write' and ${who}`,
  );
}

async function count(tenantId: string, table: string): Promise<number> {
  const found = await rows<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where tenant_id = ${tenantId}`,
  );
  return found[0]?.n ?? -1;
}

function text(words: string) {
  return { id: newId(), role: 'user' as const, parts: [{ type: 'text' as const, text: words }] };
}

async function say(chat: Chat, caller: ChatCaller, id: string, words: string): Promise<string> {
  const sent = await chat.send(caller, id, text(words), new AbortController().signal);
  if (sent.kind !== 'stream') throw new Error(`not streamed: ${sent.kind}`);
  return sent.response.text();
}

async function resume(chat: Chat, caller: ChatCaller, id: string): Promise<string> {
  const resumed = await chat.resume(caller, id, new AbortController().signal);
  if (resumed.kind !== 'stream') throw new Error(`not streamed: ${resumed.kind}`);
  return resumed.response.text();
}

// An operator, a target with a role to change, and an Act conversation in the
// target that has proposed changing it.
async function proposed(description = 'New text', again?: { operator: World; target: World }) {
  const operator = again?.operator ?? (await consoleSystemWorld(s().appDb, BASE, OPERATOR));
  const target = again?.target ?? (await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES));
  const decoy = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
  const role = await seedRole(target, 'Old text');
  const decoyRole = await seedRole(decoy, 'Old text');
  const input = {
    id: role.id,
    if_match: await roleEtag(operator, target, role.id),
    description,
  };
  const chat = chatFor(
    scripted([toolCall('call-1', 'update_role_description', input), answer('It is changed.')]),
  );
  const caller = callerOf(operator, target);
  const created = await chat.create(caller, { mode: 'act', page_context: { route: '/roles' } });
  if (created.kind !== 'created') throw new Error(`not created: ${JSON.stringify(created)}`);
  const id = created.conversation.id;
  await say(chat, caller, id, 'change the description of the role');
  const [card] = (await chat.approvals(caller, id)) ?? [];
  return { operator, target, decoy, role, decoyRole, chat, caller, id, card };
}

describe('an approved change in another tenant', () => {
  it('lands in the target alone, under the administrator’s own approval and grant', async () => {
    const { operator, target, decoy, role, decoyRole, chat, caller, id, card } = await proposed();
    expect(card).toMatchObject({
      tool: 'update_role_description',
      target: { type: 'role', id: role.id, name: role.name },
      before: { description: 'Old text' },
      after: { description: 'New text' },
    });
    expect(await roleDescription(target, role.id)).toBe('Old text');

    expect(await chat.answerApproval(caller, id, card?.approval_id ?? '', true)).toEqual({
      kind: 'decided',
      state: 'approved',
    });
    const out = await resume(chat, caller, id);
    expect(out).toContain('It is changed.');

    expect(await roleDescription(target, role.id)).toBe('New text');
    expect(await roleDescription(decoy, decoyRole.id)).toBe('Old text');

    // The approval and the write's grant are the administrator's tenant's rows.
    expect((await approvals(operator)).map((row) => row.state)).toEqual(['consumed']);
    expect(await approvals(target)).toEqual([]);
    expect(await count(target.tenantId, 'assistant_approvals')).toBe(0);
    expect(await count(target.tenantId, 'assistant_conversations')).toBe(0);
    expect(await writeGrants(operator.tenantId, operator.subjectId)).toEqual([
      { target_tenant_id: target.tenantId, revoked: true },
    ]);
    expect(await writeGrants(target.tenantId)).toEqual([]);

    // The decision is in the administrator's trail naming both tenants; what the
    // tool did is in the target's, with the administrator as its actor.
    const decisions = await rows<{ detail: Record<string, unknown> }>(
      sql`select detail from audit_events
           where tenant_id = ${operator.tenantId} and action = 'assistant.approval'
             and detail->>'conversation' = ${id} and detail->>'state' = 'approved'`,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.detail).toMatchObject({
      tenant: operator.tenantId,
      target_tenant: target.tenantId,
      state: 'approved',
      tool: 'update_role_description',
    });
    expect(JSON.stringify(decisions)).not.toContain('New text');
    const inTarget = await rows<{ action: string; actor_tenant_id: string }>(
      sql`select action, actor_tenant_id from audit_events
           where tenant_id = ${target.tenantId} and actor_subject_id = ${operator.subjectId}`,
    );
    expect(inTarget.map((row) => row.action)).toEqual(
      expect.arrayContaining(['agent.tool_call', 'assistant.approval']),
    );
    // Which tool was approved, and never the conversation or what it said.
    const approvedInTarget = await rows<{ detail: Record<string, unknown> }>(
      sql`select detail from audit_events
           where tenant_id = ${target.tenantId} and action = 'assistant.approval'`,
    );
    expect(approvedInTarget).toHaveLength(1);
    expect(approvedInTarget[0]?.detail).toMatchObject({
      tenant: operator.tenantId,
      target_tenant: target.tenantId,
      approval: card?.approval_id,
      tool: 'update_role_description',
      state: 'approved',
    });
    expect(JSON.stringify(approvedInTarget)).not.toContain(id);
    expect(JSON.stringify(approvedInTarget)).not.toContain('New text');
    // The turns are the administrator's own record and are not copied there.
    expect(inTarget.map((row) => row.action)).not.toContain('assistant.turn');
    expect(inTarget.length).toBeGreaterThan(1);
    // The administrator's own trail holds what came of it, naming both tenants.
    const outcomes = await rows<{ outcome: string; detail: Record<string, unknown> }>(
      sql`select outcome, detail from audit_events
           where tenant_id = ${operator.tenantId} and action = 'assistant.approval'
             and detail->>'conversation' = ${id} and detail->>'state' = 'executed'`,
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      outcome: 'allowed',
      detail: {
        tenant: operator.tenantId,
        target_tenant: target.tenantId,
        tool: 'update_role_description',
        approval: card?.approval_id,
      },
    });
    expect(new Set(inTarget.map((row) => row.actor_tenant_id))).toEqual(
      new Set([operator.tenantId]),
    );
    const inDecoy = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events
           where tenant_id = ${decoy.tenantId} and actor_subject_id = ${operator.subjectId}`,
    );
    expect(inDecoy[0]?.n).toBe(0);
  });

  it('is never decided or run from another path, another person or the home tenant', async () => {
    const { operator, target, decoy, role, chat, caller, id, card } = await proposed();
    const approvalId = card?.approval_id ?? '';

    const atDecoy = callerOf(operator, decoy);
    expect(await chat.approvals(atDecoy, id)).toBeNull();
    expect(await chat.answerApproval(atDecoy, id, approvalId, true)).toEqual({
      kind: 'not_found',
    });
    const atHome = callerOf(operator);
    expect(await chat.approvals(atHome, id)).toBeNull();
    expect(await chat.answerApproval(atHome, id, approvalId, true)).toEqual({ kind: 'not_found' });
    const stranger = await consoleSystemWorld(s().appDb, BASE, OPERATOR);
    expect(await chat.answerApproval(callerOf(stranger, target), id, approvalId, true)).toEqual({
      kind: 'not_found',
    });

    expect((await approvals(operator)).map((row) => row.state)).toEqual(['pending']);
    expect((await chat.resume(caller, id, new AbortController().signal)).kind).toBe('waiting');
    expect(await roleDescription(target, role.id)).toBe('Old text');
    expect(await writeGrants(operator.tenantId, operator.subjectId)).toEqual([]);
  });

  it('runs nothing once the target switched the assistant off, and spends nothing', async () => {
    const { operator, target, role, chat, caller, id, card } = await proposed();
    await chat.answerApproval(caller, id, card?.approval_id ?? '', true);
    await withTenant(s().appDb.db, target.tenantId, (tx) =>
      writeSettings(
        tx,
        target.tenantId,
        { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
        new Date(),
      ),
    );
    const resumed = await chat.resume(caller, id, new AbortController().signal);
    expect(resumed.kind).toBe('not_found');
    expect(await roleDescription(target, role.id)).toBe('Old text');
    expect((await approvals(operator)).map((row) => row.state)).toEqual(['approved']);
    expect(await writeGrants(operator.tenantId, operator.subjectId)).toEqual([]);
  });
});

describe('the write grant of another tenant', () => {
  async function lifespansOf(w: World) {
    const tenant = await tenantLookupRepository(s().owner.db).byName(w.name);
    if (tenant === null) throw new Error('no tenant');
    return {
      ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
    };
  }

  async function refusal(w: World, target: { id: string; enabled: boolean; offered: boolean }) {
    const lifespans = await lifespansOf(w);
    try {
      await withTenant(s().appDb.db, w.tenantId, (tx) =>
        grantAssistantWrite(
          tx,
          { tenantId: w.tenantId, lifespans },
          {
            approvalId: newId(),
            consoleGrantId: w.grantId,
            expectedSubjectId: w.subjectId,
            now: new Date(),
            target: { id: target.id, enabled: target.enabled, assistantEnabled: target.offered },
          },
        ),
      );
      return null;
    } catch (error) {
      if (error instanceof AssistantGrantRefused) return error.reason;
      throw error;
    }
  }

  it('is refused to an administrator of a tenant other than the system tenant', async () => {
    const local = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    const other = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    expect(await refusal(local, { id: other.tenantId, enabled: true, offered: true })).toBe(
      'target_not_allowed',
    );
  });

  it('is refused to a system administrator without manage-tenants and use-assistant', async () => {
    const target = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    const weak = await consoleSystemWorld(s().appDb, BASE, ['use-assistant']);
    expect(await refusal(weak, { id: target.tenantId, enabled: true, offered: true })).toBe(
      'owner_lacks_capability',
    );
  });

  it('is refused for a target that is disabled, switched off or unknown', async () => {
    const operator = await consoleSystemWorld(s().appDb, BASE, OPERATOR);
    const target = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    expect(await refusal(operator, { id: target.tenantId, enabled: false, offered: true })).toBe(
      'target_unavailable',
    );
    expect(await refusal(operator, { id: target.tenantId, enabled: true, offered: false })).toBe(
      'target_assistant_disabled',
    );
    expect(await writeGrants(operator.tenantId, operator.subjectId)).toEqual([]);
  });
});

async function settle(world: Awaited<ReturnType<typeof proposed>>) {
  const { chat, caller, id, card } = world;
  await chat.answerApproval(caller, id, card?.approval_id ?? '', true);
  return resume(chat, caller, id);
}

describe('the limits of the tenant a change lands in', () => {
  it('refuse a second approved change once the target’s window is spent, though the home tenant allows it', async () => {
    const operator = await consoleSystemWorld(s().appDb, BASE, OPERATOR);
    const target = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    await s().owner.db.execute(
      sql`update tenants set agent_window_writes = 1 where id = ${target.tenantId}`,
    );
    const first = await proposed('First', { operator, target });
    await settle(first);
    expect(await roleDescription(target, first.role.id)).toBe('First');

    const second = await proposed('Second', { operator, target });
    await settle(second);
    expect(await roleDescription(target, second.role.id)).toBe('Old text');
    const outcomes = await rows<{ outcome: string; state: string }>(
      sql`select outcome, detail->>'state' as state from audit_events
           where tenant_id = ${operator.tenantId} and action = 'assistant.approval'
             and detail->>'approval' = ${second.card?.approval_id ?? ''}
             and detail->>'state' in ('executed', 'failed')`,
    );
    expect(outcomes).toEqual([{ outcome: 'failed', state: 'failed' }]);
    expect(await writeGrants(operator.tenantId, operator.subjectId)).toEqual([
      { target_tenant_id: target.tenantId, revoked: true },
      { target_tenant_id: target.tenantId, revoked: true },
    ]);
  });
});

describe('the target’s record of an approval', () => {
  async function blockTargetApprovalRows(tenantId: string): Promise<void> {
    await s().owner.db.execute(
      sql.raw(`
        create or replace function xt_block_approval() returns trigger language plpgsql as $$
        begin
          if new.action = 'assistant.approval' and new.tenant_id = '${tenantId}' then
            raise exception 'blocked for the test';
          end if;
          return new;
        end $$;
        drop trigger if exists xt_block_approval on audit_events;
        create trigger xt_block_approval before insert on audit_events
          for each row execute function xt_block_approval();`),
    );
  }

  it('stops the change when it cannot be written, and the change is not made', async () => {
    const world = await proposed();
    await blockTargetApprovalRows(world.target.tenantId);
    try {
      await settle(world);
    } finally {
      await s().owner.db.execute(sql`drop trigger if exists xt_block_approval on audit_events`);
    }
    expect(await roleDescription(world.target, world.role.id)).toBe('Old text');
    expect(await writeGrants(world.operator.tenantId, world.operator.subjectId)).toEqual([
      { target_tenant_id: world.target.tenantId, revoked: true },
    ]);
    const inTarget = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events
           where tenant_id = ${world.target.tenantId} and action = 'agent.tool_call'
             and detail->>'tool' = 'update_role_description'`,
    );
    expect(inTarget[0]?.n).toBe(0);
  });
});

describe('a caller that may not act in the named tenant', () => {
  it('is refused and leaves no row in either tenant, for a tenant administrator and a mismatched name', async () => {
    const local = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    const other = await consoleWorld(s().appDb, BASE, TENANT_CAPABILITIES);
    const chat = chatFor(scripted([answer('x')]));
    const page = { route: '/roles' };
    expect(
      await chat.create(callerOf(local, other), { mode: 'act', page_context: page }),
    ).toMatchObject({ kind: 'access_refused', reason: 'target_not_allowed' });

    const operator = await consoleSystemWorld(s().appDb, BASE, OPERATOR);
    const named = callerOf(operator, other, {
      target: { id: other.tenantId, name: 'not-its-name' },
    });
    expect(await chat.create(named, { mode: 'act', page_context: page })).toMatchObject({
      kind: 'access_refused',
      reason: 'target_unavailable',
    });
    for (const w of [local, other]) {
      expect(await approvals(w)).toEqual([]);
      const found = await rows<{ n: number }>(
        sql`select count(*)::int as n from audit_events
             where tenant_id = ${w.tenantId} and action = 'assistant.approval'`,
      );
      expect(found[0]?.n).toBe(0);
    }
  });
});
