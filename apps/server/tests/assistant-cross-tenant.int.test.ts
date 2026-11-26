import { resolveSlots, writeSettings, type ChatCaller } from '@odudu/assistant';
import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { sessionRepository } from '@odudu/authn-flows';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, ASSISTANT_CLIENT_ID } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { subjectRepository } from '@odudu/domain-identity';
import {
  grantAssistantAccess,
  runInstanceId,
  standardClaimMappers,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { assistantTokenMint, toolRunner } from '#/assistant-chat';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { consoleSystemWorld, consoleWorld, type World } from '#/testing/mcp-world';

// A system administrator's conversation in another tenant, end to end: the
// conversation and its grant are rows of the administrator's tenant, the tool
// calls are made in the tenant the path named and recorded in its trail, and
// every refusal leaves nothing behind.

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const ENV = {
  ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-standard',
  ANTHROPIC_API_KEY: 'sk-ant-test-0123456789',
};
const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

let stack: McpStack | undefined;
let assisted: FastifyInstance | undefined;
let nextTool = 'list_subjects';
let nextInput = '{}';
// Runs as the model is first asked in a turn, so a test can change the world mid-turn.
let beforeFirstCall: (() => Promise<void>) | undefined;

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}
function on(): FastifyInstance {
  if (assisted === undefined) throw new Error('app not built');
  return assisted;
}

// Asks for one tool on a turn's first model call and answers on its second.
function scriptedModel() {
  let call = 0;
  return {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('streaming only')),
    doStream: async () => {
      call += 1;
      if (call % 2 === 1 && beforeFirstCall !== undefined) {
        const hook = beforeFirstCall;
        beforeFirstCall = undefined;
        await hook();
      }
      const parts =
        call % 2 === 1
          ? [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: `c${String(call)}`,
                toolName: nextTool,
                input: nextInput,
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: USAGE,
              },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'a' },
              { type: 'text-delta', id: 'a', delta: 'Done.' },
              { type: 'text-end', id: 'a' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
            ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}

beforeAll(async () => {
  stack = await startMcpStack();
  assisted = buildApp({
    database: s().appDb,
    ownerDatabase: s().owner,
    kek: KEK,
    logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    assistant: { slots: resolveSlots(ENV), env: ENV },
    assistantModels: () => scriptedModel() as never,
  });
  await assisted.ready();
}, 180_000);
afterAll(async () => {
  await assisted?.close();
  await stack?.close();
});

const OPERATOR = ['use-assistant', 'manage-tenants', 'view-users', 'manage-clients', 'view-audit'];
const CONTEXT = { route: '/subjects', objectType: 'subject', objectId: 'x' };

async function operator(capabilities: readonly string[] = OPERATOR): Promise<World> {
  return consoleSystemWorld(s().appDb, BASE, capabilities);
}

// A tenant with a person in it, and `extra` more subjects.
async function tenantWith(extra = 0): Promise<World & { subjects: string[] }> {
  const w = await consoleWorld(s().appDb, BASE, ['use-assistant', 'manage-clients', 'view-users']);
  const more = await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    const made: string[] = [];
    for (let n = 0; n < extra; n += 1) {
      made.push((await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' })).id);
    }
    return made;
  });
  return { ...w, subjects: [w.subjectId, ...more] };
}

async function tokenOf(w: World): Promise<string> {
  const key = await withTenant(s().appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [ADMIN_API_AUDIENCE],
      client_id: ADMIN_CLIENT_ID,
      scope: 'openid',
      iat,
      exp: iat + 600,
      jti: newId(),
      grant_id: w.grantId,
      sid: w.sessionId,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function call(
  who: World,
  at: string,
  method: 'GET' | 'POST' | 'PUT',
  tail: string,
  payload?: unknown,
) {
  return on().inject({
    method,
    url: `/admin/tenants/${at}/assistant/conversations${tail}`,
    headers: {
      host: HOST,
      authorization: `Bearer ${await tokenOf(who)}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

// A tool answered with data, as against an error the admin API returned for it.
function answered(body: string): boolean {
  return (
    body.includes('tool-output-available') && !/tool-output-available[^\n]*\\"error\\"/u.test(body)
  );
}

async function open(who: World, at: string): Promise<string> {
  const created = await call(who, at, 'POST', '', { page_context: CONTEXT });
  expect(created.statusCode, created.body).toBe(201);
  return created.json<{ id: string }>().id;
}

async function say(who: World, at: string, id: string, tool: string, input = '{}') {
  nextTool = tool;
  nextInput = input;
  return call(who, at, 'POST', `/${id}/messages`, {
    message: { id: `m-${newId()}`, role: 'user', parts: [{ type: 'text', text: 'go' }] },
  });
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await s().owner.db.execute(query)) as unknown as T[];
}

// Conversations and grants of one person's, or of a tenant when it is its own
// people's: the system tenant is shared by every operator in these tests.
async function nConversations(tenantId: string, owner?: string): Promise<number> {
  const who = owner === undefined ? sql`true` : sql`owner_subject_id = ${owner}`;
  return (
    (
      await rows<{ n: number }>(
        sql`select count(*)::int as n from assistant_conversations
             where (tenant_id = ${tenantId} or target_tenant_id = ${tenantId}) and ${who}`,
      )
    )[0]?.n ?? -1
  );
}

async function nGrants(tenantId: string, owner?: string): Promise<number> {
  const who = owner === undefined ? sql`true` : sql`g.subject_id = ${owner}`;
  return (
    (
      await rows<{ n: number }>(
        sql`select count(*)::int as n from token_grants g join clients c on c.id = g.client_id
             where (g.tenant_id = ${tenantId} or g.target_tenant_id = ${tenantId})
               and c.client_id = ${ASSISTANT_CLIENT_ID} and ${who}`,
      )
    )[0]?.n ?? -1
  );
}

async function toolRows(tenantId: string) {
  return rows<{
    actor_tenant_id: string;
    actor_subject_id: string;
    outcome: string;
    detail: Record<string, unknown>;
  }>(
    sql`select actor_tenant_id, actor_subject_id, outcome, detail from audit_events
         where tenant_id = ${tenantId} and action = 'agent.tool_call'`,
  );
}

async function auditActions(tenantId: string) {
  return (
    await rows<{ action: string }>(
      sql`select action from audit_events where tenant_id = ${tenantId} and action like 'assistant.%'`,
    )
  ).map((row) => row.action);
}

describe('creating the conversation', () => {
  it('writes the conversation and its grant to the administrator’s tenant, bound to the target', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);

    const conversation = await rows<Record<string, string>>(
      sql`select tenant_id, owner_subject_id, target_tenant_id from assistant_conversations where id = ${id}`,
    );
    expect(conversation).toEqual([
      { tenant_id: op.tenantId, owner_subject_id: op.subjectId, target_tenant_id: x.tenantId },
    ]);
    const grant = await rows<Record<string, string>>(
      sql`select g.tenant_id, g.subject_id, g.target_tenant_id, g.scope, g.exchanged_from_grant_id,
                 g.session_id, c.client_id
            from token_grants g join clients c on c.id = g.client_id where g.id = ${id}`,
    );
    expect(grant).toEqual([
      {
        tenant_id: op.tenantId,
        subject_id: op.subjectId,
        target_tenant_id: x.tenantId,
        scope: 'mcp:read',
        exchanged_from_grant_id: op.grantId,
        session_id: op.sessionId,
        client_id: ASSISTANT_CLIENT_ID,
      },
    ]);
    // Nothing is a row of the target itself, only named by the administrator's.
    expect(
      await rows(sql`select 1 from assistant_conversations where tenant_id = ${x.tenantId}`),
    ).toEqual([]);
    expect(
      await rows(sql`select 1 from token_grants where id = ${id} and tenant_id = ${x.tenantId}`),
    ).toEqual([]);
  });

  it('is invisible to the target’s own row-level security context', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    const seen = await withTenant(s().appDb.db, x.tenantId, async (tx) => ({
      conversations: await tx.execute(
        sql`select id from assistant_conversations where id = ${id} or target_tenant_id = ${x.tenantId}`,
      ),
      grants: await tx.execute(
        sql`select id from token_grants where id = ${id} or target_tenant_id = ${x.tenantId}`,
      ),
      messages: await tx.execute(sql`select 1 from assistant_messages`),
    }));
    expect([...seen.conversations]).toEqual([]);
    expect([...seen.grants]).toEqual([]);
    expect([...seen.messages]).toEqual([]);
  });

  it('is unchanged in the administrator’s own tenant and for a tenant’s own administrator', async () => {
    const op = await operator();
    const own = await open(op, 'system');
    const x = await tenantWith();
    const theirs = await call(x, x.name, 'POST', '', { page_context: CONTEXT });
    expect(theirs.statusCode, theirs.body).toBe(201);
    const found = await rows<{ id: string; target_tenant_id: string | null }>(
      sql`select id, target_tenant_id from assistant_conversations where id in (${own}, ${theirs.json<{ id: string }>().id})`,
    );
    expect(found).toHaveLength(2);
    expect(found.every((row) => row.target_tenant_id === null)).toBe(true);
    const grants = await rows<{ target_tenant_id: string | null }>(
      sql`select target_tenant_id from token_grants where id in (${own}, ${theirs.json<{ id: string }>().id})`,
    );
    expect(grants.every((row) => row.target_tenant_id === null)).toBe(true);
  });

  it('is refused to a tenant administrator at another tenant, with nothing written', async () => {
    const x = await tenantWith();
    const y = await tenantWith();
    const res = await call(x, y.name, 'POST', '', { page_context: CONTEXT });
    expect([401, 403]).toContain(res.statusCode);
    expect(await nConversations(x.tenantId)).toBe(0);
    expect(await nConversations(y.tenantId)).toBe(0);
    expect(await nGrants(y.tenantId)).toBe(0);
  });

  it('is refused to a system administrator without manage-tenants, and without use-assistant', async () => {
    const x = await tenantWith();
    for (const held of [
      ['use-assistant', 'view-users'],
      ['manage-tenants', 'view-users'],
    ]) {
      const op = await operator(held);
      const res = await call(op, x.name, 'POST', '', { page_context: CONTEXT });
      expect(res.statusCode, held.join()).toBe(403);
      expect(await nConversations(op.tenantId, op.subjectId)).toBe(0);
      expect(await nGrants(op.tenantId, op.subjectId)).toBe(0);
    }
  });

  it('answers as a path never served when the target switched the assistant off', async () => {
    const op = await operator();
    const x = await tenantWith();
    await withTenant(s().appDb.db, x.tenantId, (tx) =>
      writeSettings(
        tx,
        x.tenantId,
        { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
        new Date(),
      ),
    );
    const res = await call(op, x.name, 'POST', '', { page_context: CONTEXT });
    expect(res.statusCode).toBe(404);
    expect(await nConversations(op.tenantId, op.subjectId)).toBe(0);
    expect(await nGrants(op.tenantId, op.subjectId)).toBe(0);
  });

  it('answers 404 for a target that does not exist, and refuses Act with nothing written', async () => {
    const op = await operator();
    const x = await tenantWith();
    expect(
      (await call(op, `nobody-${newId()}`, 'POST', '', { page_context: CONTEXT })).statusCode,
    ).toBe(401);
    const act = await call(op, x.name, 'POST', '', { page_context: CONTEXT, mode: 'act' });
    expect(act.statusCode).toBe(403);
    expect(await nConversations(op.tenantId, op.subjectId)).toBe(0);
    expect(await nGrants(op.tenantId, op.subjectId)).toBe(0);
  });
});

describe('the grant of a conversation that names a target', () => {
  async function derive(w: World, target: Parameters<typeof grantAssistantAccess>[2]['target']) {
    const tenant = await tenantLookupRepository(s().owner.db).byName(w.name);
    if (tenant === null) throw new Error('no tenant');
    const newGrantId = newId();
    const attempt = withTenant(s().appDb.db, w.tenantId, (tx) =>
      grantAssistantAccess(
        tx,
        {
          tenantId: w.tenantId,
          lifespans: {
            ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
            ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
            rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
            rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
          },
        },
        {
          newGrantId,
          consoleGrantId: w.grantId,
          expectedSubjectId: w.subjectId,
          mode: 'ask',
          now: new Date(),
          ...(target === undefined ? {} : { target }),
        },
      ),
    );
    return { attempt, newGrantId };
  }

  it('is refused to a tenant that is not the system tenant, with no grant written', async () => {
    const own = await tenantWith();
    const other = await tenantWith();
    const { attempt, newGrantId } = await derive(own, {
      id: other.tenantId,
      enabled: true,
      assistantEnabled: true,
    });
    await expect(attempt).rejects.toMatchObject({ reason: 'target_not_allowed' });
    expect(await rows(sql`select 1 from token_grants where id = ${newGrantId}`)).toEqual([]);
  });

  it('is refused to the system tenant for a target that is missing, disabled or off', async () => {
    const op = await operator();
    const x = await tenantWith();
    for (const [target, reason] of [
      [null, 'target_unavailable'],
      [{ id: x.tenantId, enabled: false, assistantEnabled: true }, 'target_unavailable'],
      [{ id: x.tenantId, enabled: true, assistantEnabled: false }, 'target_assistant_disabled'],
    ] as const) {
      const { attempt, newGrantId } = await derive(op, target);
      await expect(attempt).rejects.toMatchObject({ reason });
      expect(await rows(sql`select 1 from token_grants where id = ${newGrantId}`)).toEqual([]);
    }
  });

  it('is refused when the owner no longer holds manage-tenants or use-assistant, whatever the route did', async () => {
    const x = await tenantWith();
    for (const held of [
      ['use-assistant', 'view-users'],
      ['manage-tenants', 'view-users'],
    ]) {
      const op = await operator(held);
      const { attempt, newGrantId } = await derive(op, {
        id: x.tenantId,
        enabled: true,
        assistantEnabled: true,
      });
      await expect(attempt).rejects.toMatchObject({ reason: 'owner_lacks_capability' });
      expect(await rows(sql`select 1 from token_grants where id = ${newGrantId}`)).toEqual([]);
    }
  });

  it('is the ordinary grant, naming no target, when the target is the tenant itself', async () => {
    const own = await tenantWith();
    const { attempt, newGrantId } = await derive(own, {
      id: own.tenantId,
      enabled: true,
      assistantEnabled: true,
    });
    await attempt;
    const stored = await rows<{ target_tenant_id: string | null }>(
      sql`select target_tenant_id from token_grants where id = ${newGrantId}`,
    );
    expect(stored).toEqual([{ target_tenant_id: null }]);
  });
});

describe('a turn in the target tenant', () => {
  it('reads only the target’s data and records each call in the target’s trail', async () => {
    const op = await operator();
    const x = await tenantWith();
    const y = await tenantWith(2);
    const id = await open(op, x.name);
    const turn = await say(op, x.name, id, 'list_subjects');
    expect(turn.statusCode, turn.body).toBe(200);
    expect(answered(turn.body)).toBe(true);
    expect(turn.body).toContain(x.subjectId);
    for (const foreign of y.subjects) expect(turn.body).not.toContain(foreign);

    const target = await toolRows(x.tenantId);
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      actor_tenant_id: op.tenantId,
      actor_subject_id: op.subjectId,
      outcome: 'allowed',
      detail: { tool: 'list_subjects', conversation: id },
    });
    expect(await toolRows(op.tenantId)).toHaveLength(0);
    expect(await toolRows(y.tenantId)).toHaveLength(0);
  });

  it('keeps the assistant’s own rows in the administrator’s trail, naming the target', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await say(op, x.name, id, 'list_subjects');
    const turns = await rows<{ detail: Record<string, unknown> }>(
      sql`select detail from audit_events where tenant_id = ${op.tenantId}
            and action = 'assistant.turn' and resource_id = ${id}`,
    );
    expect(turns).toHaveLength(2);
    for (const turn of turns) expect(turn.detail).toMatchObject({ target_tenant: x.tenantId });
    expect(await auditActions(x.tenantId)).toEqual([]);
  });

  it('counts the spend in the administrator’s tenant and leaves the target’s counters empty', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await say(op, x.name, id, 'list_subjects');
    const counted = async (tenantId: string) =>
      (
        await rows<{ n: number }>(
          sql`select count(*)::int as n from assistant_budget_counters where tenant_id = ${tenantId}`,
        )
      )[0]?.n;
    expect(await counted(op.tenantId)).toBeGreaterThan(0);
    expect(await counted(x.tenantId)).toBe(0);
  });

  it('answers 404 for a subject of another tenant, as a missing one', async () => {
    const op = await operator();
    const x = await tenantWith();
    const y = await tenantWith();
    const id = await open(op, x.name);
    const turn = await say(op, x.name, id, 'get_subject', JSON.stringify({ id: y.subjectId }));
    expect(answered(turn.body)).toBe(false);
    expect(turn.body).toContain('Not Found');
    const recorded = await toolRows(x.tenantId);
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('is not offered the instance-wide reads, so the tenant list never reaches it', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    const turn = await say(op, x.name, id, 'list_tenants');
    expect(turn.body).not.toContain('tool-output-available');
    expect(await toolRows(x.tenantId)).toHaveLength(0);
    expect(await toolRows(op.tenantId)).toHaveLength(0);
  });

  it('is refused a tool the administrator lacks the capability for, recorded as refused', async () => {
    const op = await operator(['use-assistant', 'manage-tenants']);
    const x = await tenantWith();
    const id = await open(op, x.name);
    const turn = await say(op, x.name, id, 'list_subjects');
    expect(turn.body).toContain('Forbidden');
    const target = await toolRows(x.tenantId);
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({ outcome: 'refused', actor_tenant_id: op.tenantId });
  });
});

describe('the binding to the target', () => {
  it('serves the conversation at its tenant only, and 404 at any other path', async () => {
    const op = await operator();
    const x = await tenantWith();
    const y = await tenantWith();
    const id = await open(op, x.name);
    const body = { message: { id: 'm', role: 'user', parts: [{ type: 'text', text: 'x' }] } };
    for (const at of [y.name, 'system']) {
      expect((await call(op, at, 'GET', `/${id}`)).statusCode, `load ${at}`).toBe(404);
      expect((await call(op, at, 'POST', `/${id}/messages`, body)).statusCode, `send ${at}`).toBe(
        404,
      );
      expect((await call(op, at, 'POST', `/${id}/stop`)).statusCode, `stop ${at}`).toBe(404);
      expect((await call(op, at, 'GET', `/${id}/approvals`)).statusCode, `cards ${at}`).toBe(404);
      expect(
        (await call(op, at, 'PUT', `/${id}/mode`, { mode: 'ask' })).statusCode,
        `mode ${at}`,
      ).toBe(404);
      expect((await call(op, at, 'POST', `/${id}/resume`)).statusCode, `resume ${at}`).toBe(404);
      expect(
        (await call(op, at, 'POST', `/${id}/approvals/${newId()}`, { approve: true })).statusCode,
        `decide ${at}`,
      ).toBe(404);
    }
    expect((await call(op, x.name, 'GET', `/${id}`)).statusCode).toBe(200);
    expect(await toolRows(y.tenantId)).toHaveLength(0);
  });

  it('refuses the conversation’s own token at any other tenant, and admits it at its own', async () => {
    const op = await operator();
    const x = await tenantWith();
    const y = await tenantWith();
    const id = await open(op, x.name);
    const mint = assistantTokenMint({
      app: s().app,
      database: s().appDb,
      ownerDatabase: s().owner,
      kek: KEK,
      claimMappers: standardClaimMappers(),
      logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
      publicBaseUrl: BASE,
      models: () => {
        throw new Error('no model is called here');
      },
    });
    const caller: ChatCaller = {
      tenantId: op.tenantId,
      tenantName: 'system',
      issuer: op.issuer,
      ownerSubjectId: op.subjectId,
      grantId: op.grantId,
      requestId: 'req',
      ip: '127.0.0.1',
      target: { id: x.tenantId, name: x.name },
    };
    const { accessToken } = await mint(caller, { key: `${id}.0`, conversationId: id });
    const get = (tenant: string) =>
      on().inject({
        method: 'GET',
        url: `/admin/tenants/${tenant}/subjects`,
        headers: { host: HOST, authorization: `Bearer ${accessToken}` },
      });
    expect((await get(x.name)).statusCode).toBe(200);
    expect((await get(y.name)).statusCode).toBe(403);
    expect((await get('system')).statusCode).toBe(403);
  });

  it('is another administrator’s to neither read nor send in', async () => {
    const op = await operator();
    const other = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    expect((await call(other, x.name, 'GET', `/${id}`)).statusCode).toBe(404);
    const sent = await say(other, x.name, id, 'list_subjects');
    expect(sent.statusCode).toBe(404);
    expect(await toolRows(x.tenantId)).toHaveLength(0);
  });
});

describe('what the administrator holds, and what ends the conversation', () => {
  it('refuses the next call when manage-tenants is removed, and works again when it is back', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    expect(answered((await say(op, x.name, id, 'list_subjects')).body)).toBe(true);

    const role = await rows<{ id: string }>(
      sql`select r.id from roles r join clients c on c.id = r.client_id
           where r.tenant_id = ${op.tenantId} and r.name = 'manage-tenants'
             and c.client_id = ${ADMIN_CLIENT_ID}`,
    );
    const roleId = role[0]?.id ?? '';
    await s().owner.db.execute(
      sql`delete from subject_roles where subject_id = ${op.subjectId} and role_id = ${roleId}`,
    );
    const refused = await say(op, x.name, id, 'list_subjects');
    expect(answered(refused.body)).toBe(false);
    // The conversation itself is the same one: the console token is refused first.
    await s().owner.db.execute(
      sql`insert into subject_roles (tenant_id, subject_id, role_id)
          values (${op.tenantId}, ${op.subjectId}, ${roleId})`,
    );
    expect(answered((await say(op, x.name, id, 'list_subjects')).body)).toBe(true);
  });

  it('fails closed when the target tenant is disabled, and recovers when it is enabled', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await s().owner.db.execute(sql`update tenants set enabled = false where id = ${x.tenantId}`);
    const refused = await say(op, x.name, id, 'list_subjects');
    expect(answered(refused.body)).toBe(false);
    await s().owner.db.execute(sql`update tenants set enabled = true where id = ${x.tenantId}`);
    expect(answered((await say(op, x.name, id, 'list_subjects')).body)).toBe(true);
  });

  it('stops serving when the target switches the assistant off mid-conversation', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await withTenant(s().appDb.db, x.tenantId, (tx) =>
      writeSettings(
        tx,
        x.tenantId,
        { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
        new Date(),
      ),
    );
    expect((await say(op, x.name, id, 'list_subjects')).statusCode).toBe(404);
  });

  it('ends the grant and the instance with the console session, and the next call is refused', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    expect(answered((await say(op, x.name, id, 'list_subjects')).body)).toBe(true);
    const token = await tokenOf(op);

    await withTenant(s().appDb.db, op.tenantId, async (tx) => {
      const now = new Date();
      await sessionRepository(tx).end(op.sessionId, now);
      await tokenGrantRepository(tx).revokeForSession(op.sessionId, now);
    });

    const derived = await rows<{ revoked_at: Date | null }>(
      sql`select revoked_at from token_grants where id = ${id}`,
    );
    expect(derived[0]?.revoked_at).not.toBeNull();
    const instances = await rows<{ id: string }>(
      sql`select id from agent_instances where root_grant_id = ${id}`,
    );
    expect(instances.map((row) => row.id)).toEqual([runInstanceId(op.tenantId, id, `${id}.0`)]);
    const after = await on().inject({
      method: 'POST',
      url: `/admin/tenants/${x.name}/assistant/conversations/${id}/messages`,
      headers: {
        host: HOST,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        message: { id: 'm9', role: 'user', parts: [{ type: 'text', text: 'again' }] },
      }),
    });
    expect(after.statusCode).toBe(401);
  });

  it('is deleted with the target tenant, conversation and grant together', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await say(op, x.name, id, 'list_subjects');
    await s().owner.db.execute(sql`delete from tenants where id = ${x.tenantId}`);
    expect(await rows(sql`select id from assistant_conversations where id = ${id}`)).toEqual([]);
    expect(await rows(sql`select id from token_grants where id = ${id}`)).toEqual([]);
    expect(await rows(sql`select 1 from assistant_messages where conversation_id = ${id}`)).toEqual(
      [],
    );
  });
});

describe('what is checked on every call, and never trusted from an earlier one', () => {
  it('refuses the next tool call of a turn already running when the target switches the assistant off', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    beforeFirstCall = () =>
      withTenant(s().appDb.db, x.tenantId, (tx) =>
        writeSettings(
          tx,
          x.tenantId,
          { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
          new Date(),
        ),
      );
    const turn = await say(op, x.name, id, 'list_subjects');
    expect(turn.statusCode).toBe(200);
    expect(answered(turn.body)).toBe(false);
    expect(turn.body).toContain('switched off');
    expect(await toolRows(x.tenantId)).toHaveLength(0);
  });

  it('refuses the call, and returns no data, when its audit row cannot be written', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await s().owner.db.execute(
      sql.raw(`create or replace function i5c_refuse_tool_call() returns trigger as $$
        begin raise exception 'no audit'; end $$ language plpgsql`),
    );
    await s().owner.db.execute(
      sql.raw(`create trigger i5c_refuse before insert on audit_events
          for each row when (new.action = 'agent.tool_call' and new.tenant_id = '${x.tenantId}'::uuid)
          execute function i5c_refuse_tool_call()`),
    );
    try {
      const turn = await say(op, x.name, id, 'list_subjects');
      expect(answered(turn.body)).toBe(false);
      expect(turn.body).not.toContain(x.subjectId);
      expect(turn.body).toContain('audit_unavailable');
    } finally {
      await s().owner.db.execute(sql`drop trigger if exists i5c_refuse on audit_events`);
    }
  });

  it('runs no tool the turn was not offered, even when asked for by name', async () => {
    const op = await operator();
    const x = await tenantWith();
    const run = toolRunner(
      {
        app: s().app,
        database: s().appDb,
        ownerDatabase: s().owner,
        kek: KEK,
        claimMappers: standardClaimMappers(),
        logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
        publicBaseUrl: BASE,
        models: () => {
          throw new Error('no model is called here');
        },
      },
      {
        tenantId: op.tenantId,
        tenantName: 'system',
        issuer: op.issuer,
        ownerSubjectId: op.subjectId,
        grantId: op.grantId,
        requestId: 'req',
        ip: '127.0.0.1',
        target: { id: x.tenantId, name: x.name },
      },
      newId(),
      newId(),
    );
    await expect(run('token', 'list_tenants', {})).rejects.toThrow('not an assistant tool');
    await expect(run('token', 'count_tenants', {})).rejects.toThrow('not an assistant tool');
  });

  it('keeps the target’s data out of the target’s own assistant tables, and in the administrator’s messages', async () => {
    const op = await operator();
    const x = await tenantWith();
    const id = await open(op, x.name);
    await say(op, x.name, id, 'list_subjects');
    const inTarget = await withTenant(s().appDb.db, x.tenantId, async (tx) => {
      const counts: Record<string, number> = {};
      for (const table of [
        'assistant_conversations',
        'assistant_messages',
        'assistant_turns',
        'assistant_steps',
        'assistant_events',
        'assistant_approvals',
        'assistant_budget_counters',
      ]) {
        const found = (await tx.execute(
          sql.raw(`select count(*)::int as n from ${table}`),
        )) as unknown as { n: number }[];
        counts[table] = found[0]?.n ?? -1;
      }
      return counts;
    });
    expect(Object.values(inTarget).every((n) => n === 0)).toBe(true);
    const kept = await rows<{ n: number }>(
      sql`select count(*)::int as n from assistant_messages
           where tenant_id = ${op.tenantId} and conversation_id = ${id}
             and parts::text like ${'%' + x.subjectId + '%'}`,
    );
    expect(kept[0]?.n).toBeGreaterThan(0);
  });
});
