import { resolveSlots, RunLapsed, type ChatCaller } from '@odudu/assistant';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  ASSISTANT_CLIENT_ID,
  clientRepository,
  readAgentSettings,
} from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import {
  AgentTokenRefused,
  AssistantGrantRefused,
  grantAssistantAccess,
  grantAssistantWrite,
  mintAgentToken,
  runInstanceId,
  standardClaimMappers,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { assistantTokenMint } from '#/assistant-chat';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { consoleWorld, mcpWorld, type World } from '#/testing/mcp-world';

// What the console assistant acts as: a grant of the built-in assistant
// client, derived from the administrator's console sign-in, one per
// conversation, under which every tool call is a token of the same instance.

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const ENV = {
  ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-standard',
  ANTHROPIC_API_KEY: 'sk-ant-test-0123456789',
};

let stack: McpStack | undefined;
let assisted: FastifyInstance | undefined;
let clock = new Date();

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}
function on(): FastifyInstance {
  if (assisted === undefined) throw new Error('app not built');
  return assisted;
}

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

// A model that asks for one tool on its first call and answers on its second,
// per conversation: `ai` is the assistant package's alone to import, so the
// stub is the provider interface written out.
function scriptedModel(tool: string) {
  let call = 0;
  return {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('streaming only')),
    doStream: () => {
      call += 1;
      const parts =
        call % 2 === 1
          ? [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: `c${String(call)}`, toolName: tool, input: '{}' },
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
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
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
    assistantModels: () => scriptedModel(nextTool) as never,
  });
  await assisted.ready();
}, 180_000);
afterAll(async () => {
  await assisted?.close();
  await stack?.close();
});

let nextTool = 'count_subjects';

async function lifespans(w: World) {
  const tenant = await tenantLookupRepository(s().owner.db).byName(w.name);
  if (tenant === null) throw new Error('no tenant');
  return {
    ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
    ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
    rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
    rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
  };
}

// The conversation's grant, made as the server makes it, under `w`'s tenant.
async function open(
  w: World,
  over: Partial<Parameters<typeof grantAssistantAccess>[2]> = {},
  tenantId = w.tenantId,
): Promise<string> {
  const newGrantId = newId();
  const deps = { tenantId, lifespans: await lifespans(w) };
  await withTenant(s().appDb.db, tenantId, (tx) =>
    grantAssistantAccess(tx, deps, {
      newGrantId,
      consoleGrantId: w.grantId,
      expectedSubjectId: w.subjectId,
      mode: 'ask',
      now: new Date(),
      ...over,
    }),
  );
  return newGrantId;
}

// The run a conversation's calls are made under: its id and generation.
function run(conversationId: string, generation = 0) {
  return { key: `${conversationId}.${String(generation)}`, conversationId };
}

function runKey(conversationId: string, generation: number): string {
  return run(conversationId, generation).key;
}

function callerOf(w: World): ChatCaller {
  return {
    tenantId: w.tenantId,
    tenantName: w.name,
    issuer: w.issuer,
    ownerSubjectId: w.subjectId,
    grantId: w.grantId,
    requestId: 'req-1',
    ip: '127.0.0.1',
  };
}

function mintWith(now: () => Date) {
  return assistantTokenMint({
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
    now,
  });
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

async function count(table: string, column: string, value: string): Promise<number> {
  const rows = (await s().owner.db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${value}`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? -1;
}

async function rawMint(w: World, grantId: string, scope: string[], key = 'turn') {
  const now = new Date();
  const deps = {
    tenantId: w.tenantId,
    issuer: w.issuer,
    kek: KEK,
    claimMappers: standardClaimMappers(),
    lifespans: await lifespans(w),
  };
  return withTenant(s().appDb.db, w.tenantId, (tx) =>
    mintAgentToken(tx, deps, {
      subjectGrantId: grantId,
      expectedSubjectId: w.subjectId,
      agentClientId: ASSISTANT_CLIENT_ID,
      audience: ADMIN_API_AUDIENCE,
      scope,
      notAfter: new Date(now.getTime() + 300_000),
      now,
      run: { key },
    }),
  );
}

describe('the conversation’s token', () => {
  it('is mcp:read only, for the administrator, as the assistant’s instance', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const grantId = await open(w);
    const { accessToken } = await mintWith(() => new Date())(callerOf(w), run(grantId));
    expect(claimsOf(accessToken)).toMatchObject({
      scope: 'mcp:read',
      client_id: ASSISTANT_CLIENT_ID,
      sub: w.subjectId,
      act: { sub: runInstanceId(w.tenantId, grantId, runKey(grantId, 0)) },
    });
    expect(await count('agent_instances', 'root_grant_id', grantId)).toBe(1);
  });

  it('is the same instance for one run asked twice, and for six asked at once', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const grantId = await open(w);
    const mint = mintWith(() => new Date());
    await mint(callerOf(w), run(grantId));
    const tokens = await Promise.all(
      Array.from({ length: 6 }, () => mint(callerOf(w), run(grantId))),
    );
    expect(
      new Set(tokens.map((t) => (claimsOf(t.accessToken).act as { sub: string }).sub)).size,
    ).toBe(1);
    expect(await count('agent_instances', 'root_grant_id', grantId)).toBe(1);
  });

  it('gives each conversation of one administrator its own instance with a full slice', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const [first, second] = [await open(w), await open(w)];
    const mint = mintWith(() => new Date());
    await mint(callerOf(w), run(first));
    await mint(callerOf(w), run(second));
    const settings = await withTenant(s().appDb.db, w.tenantId, (tx) =>
      readAgentSettings(tx, w.tenantId),
    );
    const rows = (await s().owner.db.execute(
      sql`select slice_mutating, spent_mutating from agent_instances where tenant_id = ${w.tenantId}`,
    )) as unknown as { slice_mutating: number; spent_mutating: number }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toEqual({ slice_mutating: settings.agentWritesPerGrant, spent_mutating: 0 });
    }
  });

  it('refuses a widening to mcp:write on an Ask grant, and writes no instance', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const grantId = await open(w);
    await expect(rawMint(w, grantId, ['mcp:read', 'mcp:write'])).rejects.toMatchObject({
      name: AgentTokenRefused.name,
      reason: 'scope_widened',
    });
    expect(await count('agent_instances', 'root_grant_id', grantId)).toBe(0);
  });

  it('refuses a conversation id that is no assistant grant, whoever asks', async () => {
    const w = await mcpWorld(s().appDb, BASE, ['view-users']);
    await expect(mintWith(() => new Date())(callerOf(w), run(w.grantId))).rejects.toMatchObject({
      reason: 'grant_not_found',
    });
    const console = await consoleWorld(s().appDb, BASE, ['view-users']);
    await expect(
      mintWith(() => new Date())(callerOf(console), run(console.grantId)),
    ).rejects.toMatchObject({ reason: 'grant_not_found' });
  });

  it('is refused for another administrator’s conversation', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const grantId = await open(w);
    const other = await consoleWorld(s().appDb, BASE, ['view-users']);
    await expect(
      mintWith(() => new Date())({ ...callerOf(w), ownerSubjectId: other.subjectId }, run(grantId)),
    ).rejects.toMatchObject({ reason: 'subject_mismatch' });
  });
});

describe('the door of the conversation’s grant', () => {
  it('refuses a scope beyond the mode’s ceiling and writes no grant', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const before = await count('token_grants', 'tenant_id', w.tenantId);
    await expect(open(w, { scope: ['mcp:read', 'mcp:write'] })).rejects.toMatchObject({
      reason: 'scope_widened',
    });
    expect(await count('token_grants', 'tenant_id', w.tenantId)).toBe(before);
  });

  it('refuses another administrator’s console grant, writing no grant and no instance', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const other = await consoleWorld(s().appDb, BASE, ['view-users']);
    const before = await count('token_grants', 'tenant_id', w.tenantId);
    await expect(open(w, { expectedSubjectId: other.subjectId })).rejects.toBeInstanceOf(
      AssistantGrantRefused,
    );
    expect(await count('token_grants', 'tenant_id', w.tenantId)).toBe(before);
    expect(await count('agent_instances', 'tenant_id', w.tenantId)).toBe(0);
  });

  it('refuses a grant of any client but the admin client', async () => {
    const mcp = await mcpWorld(s().appDb, BASE, ['view-users']);
    await expect(open(mcp)).rejects.toMatchObject({ reason: 'grant_not_console' });
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const derived = await open(w);
    await expect(open(w, { consoleGrantId: derived })).rejects.toMatchObject({
      reason: 'grant_not_console',
    });
  });

  it('gives a console grant of another tenant no grant_found under this one', async () => {
    const one = await consoleWorld(s().appDb, BASE, ['view-users']);
    const two = await consoleWorld(s().appDb, BASE, ['view-users']);
    await expect(open(one, {}, two.tenantId)).rejects.toMatchObject({ reason: 'grant_not_found' });
    expect(await count('token_grants', 'tenant_id', two.tenantId)).toBe(1);
  });

  it('refuses a revoked console grant and an ended session', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(w.grantId, new Date()),
    );
    await expect(open(w)).rejects.toMatchObject({ reason: 'grant_revoked' });
    const ended = await consoleWorld(s().appDb, BASE, ['view-users']);
    await s().owner.db.execute(
      sql`update sessions set expires_at = now() - interval '1 minute' where id = ${ended.sessionId}`,
    );
    await expect(open(ended)).rejects.toMatchObject({ reason: 'session_ended' });
  });

  it('refuses a conversation when the tenant’s assistant client is disabled, and when it is gone', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const assistant = await withTenant(s().appDb.db, w.tenantId, (tx) =>
      clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID),
    );
    if (assistant === null) throw new Error('no assistant client');
    await s().owner.db.execute(sql`update clients set enabled = false where id = ${assistant.id}`);
    await expect(open(w)).rejects.toMatchObject({ reason: 'assistant_unavailable' });
    await s().owner.db.execute(sql`update clients set enabled = true where id = ${assistant.id}`);
    await expect(open(w)).resolves.toBeTruthy();
  });
});

describe('what the minted token can do at the admin API', () => {
  const get = (w: World, tail: string, token: string) =>
    s().app.inject({
      method: 'GET',
      url: `/admin/tenants/${w.name}${tail}`,
      headers: { host: HOST, authorization: `Bearer ${token}` },
    });

  it('reads what the owner may read and is refused what they may not', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const { accessToken } = await mintWith(() => new Date())(callerOf(w), {
      ...run(await open(w)),
    });
    expect((await get(w, '/subjects', accessToken)).statusCode).toBe(200);
    expect((await get(w, '/clients', accessToken)).statusCode).toBe(403);
  });

  it('changes nothing: a write route is refused in Ask mode even for an owner who may write', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-users', 'view-users']);
    const { accessToken } = await mintWith(() => new Date())(callerOf(w), {
      ...run(await open(w)),
    });
    const before = await count('subjects', 'tenant_id', w.tenantId);
    const res = await s().app.inject({
      method: 'POST',
      url: `/admin/tenants/${w.name}/subjects`,
      headers: {
        host: HOST,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ type: 'user', username: 'mallory' }),
    });
    expect(res.statusCode).toBe(403);
    expect(await count('subjects', 'tenant_id', w.tenantId)).toBe(before);
  });
});

describe('the instance’s lifetime', () => {
  it('lapses after the idle time, slides on use and never outlives the session', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const grantId = await open(w);
    // Short enough that the session itself, which idles out later, is still live.
    await s().owner.db.execute(
      sql`update tenants set agent_instance_idle_seconds = 120 where id = ${w.tenantId}`,
    );
    const idle = 120_000;
    const t0 = new Date();
    clock = t0;
    const mint = mintWith(() => clock);
    await mint(callerOf(w), run(grantId));
    clock = new Date(t0.getTime() + idle - 10_000);
    await mint(callerOf(w), run(grantId));
    clock = new Date(t0.getTime() + idle + 10_000);
    await expect(mint(callerOf(w), run(grantId))).resolves.toBeTruthy();
    const rows = (await s().owner.db.execute(
      sql`select idle_expires_at, expires_at from agent_instances where root_grant_id = ${grantId}`,
    )) as unknown as { idle_expires_at: Date; expires_at: Date }[];
    const [row] = rows;
    expect(new Date(row?.idle_expires_at ?? 0).getTime()).toBeLessThanOrEqual(
      new Date(row?.expires_at ?? 0).getTime(),
    );
    clock = new Date(clock.getTime() + idle + 10_000);
    await expect(mint(callerOf(w), run(grantId))).rejects.toBeInstanceOf(RunLapsed);
  });
});

describe('the assistant client', () => {
  it('is in every tenant the server creates, agent-typed, and is refused at the protocol endpoints', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const rows = (await s().owner.db.execute(
      sql`select c.builtin_assistant, c.type, o.agent_type, o.redirect_uris, o.grant_types
            from clients c join client_oidc_config o on o.client_id = c.id
           where c.tenant_id = ${w.tenantId} and c.client_id = ${ASSISTANT_CLIENT_ID}`,
    )) as unknown as {
      builtin_assistant: boolean;
      type: string;
      agent_type: boolean;
      redirect_uris: string[];
      grant_types: string[];
    }[];
    expect(rows).toEqual([
      {
        builtin_assistant: true,
        type: 'public',
        agent_type: true,
        redirect_uris: [],
        grant_types: ['client_credentials'],
      },
    ]);
    const token = (form: Record<string, string>) =>
      s().app.inject({
        method: 'POST',
        url: `/tenants/${w.name}/protocol/openid-connect/token`,
        headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ client_id: ASSISTANT_CLIENT_ID, ...form }).toString(),
      });
    for (const form of [
      { grant_type: 'client_credentials' },
      {
        grant_type: 'authorization_code',
        code: 'x',
        redirect_uri: 'http://127.0.0.1/',
        code_verifier: 'x'.repeat(50),
      },
      { grant_type: 'refresh_token', refresh_token: 'x' },
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'x',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    ]) {
      const res = await token(form);
      expect(res.statusCode, form.grant_type).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, form.grant_type).toBeLessThan(500);
      expect(res.body).not.toContain('access_token');
    }
    const authorize = await s().app.inject({
      method: 'GET',
      url: `/tenants/${w.name}/protocol/openid-connect/auth?${new URLSearchParams({
        client_id: ASSISTANT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: 'http://127.0.0.1/cb',
        scope: 'openid',
        code_challenge: 'x'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
      }).toString()}`,
      headers: { host: HOST },
    });
    expect(authorize.statusCode).toBe(400);
  });

  it('cannot be created, or deleted, through the admin API', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-clients']);
    const { accessToken } = await mintAdmin(w);
    const created = await s().app.inject({
      method: 'POST',
      url: `/admin/tenants/${w.name}/clients`,
      headers: {
        host: HOST,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ client_id: ASSISTANT_CLIENT_ID, name: 'x', type: 'public' }),
    });
    expect(created.statusCode).toBeGreaterThanOrEqual(400);
    const assistant = await withTenant(s().appDb.db, w.tenantId, (tx) =>
      clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID),
    );
    const deleted = await s().app.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.name}/clients/${assistant?.id ?? ''}`,
      headers: { host: HOST, authorization: `Bearer ${accessToken}` },
    });
    expect(deleted.statusCode).toBe(409);
    expect(await count('clients', 'id', assistant?.id ?? '')).toBe(1);
  });
});

// A console-style administrator token: a grant of the admin client for the
// admin API, signed by the tenant, as the console's gateway holds one.
async function mintAdmin(w: World): Promise<{ accessToken: string }> {
  const key = await withTenant(s().appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(
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
  return { accessToken };
}

describe('a console administrator’s conversation, end to end', () => {
  const route = (app: FastifyInstance, w: World, tail: string, token: string, payload?: unknown) =>
    app.inject({
      method: 'POST',
      url: `/admin/tenants/${w.name}/assistant${tail}`,
      headers: { host: HOST, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const CONTEXT = { route: '/subjects', objectType: 'subject', objectId: 'x' };

  async function converse(w: World, tool: string) {
    nextTool = tool;
    const { accessToken } = await mintAdmin(w);
    const created = await route(on(), w, '/conversations', accessToken, { page_context: CONTEXT });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<{ id: string }>();
    const message = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'how many?' }] };
    const turn = await route(on(), w, `/conversations/${id}/messages`, accessToken, { message });
    expect(turn.statusCode, turn.body).toBe(200);
    return { id, body: turn.body };
  }

  async function say(w: World, id: string, text: string) {
    const { accessToken } = await mintAdmin(w);
    const message = { id: `m-${newId()}`, role: 'user', parts: [{ type: 'text', text }] };
    const turn = await route(on(), w, `/conversations/${id}/messages`, accessToken, { message });
    expect(turn.statusCode, turn.body).toBe(200);
    return turn.body;
  }

  async function instancesOf(id: string) {
    return (await s().owner.db.execute(
      sql`select id, idle_expires_at > now() as live, revoked_at is not null as revoked
            from agent_instances where root_grant_id = ${id} order by created_at`,
    )) as unknown as { id: string; live: boolean; revoked: boolean }[];
  }

  async function generationOf(id: string) {
    const rows = (await s().owner.db.execute(
      sql`select run_generation from assistant_conversations where id = ${id}`,
    )) as unknown as { run_generation: number }[];
    return rows[0]?.run_generation;
  }

  async function toolRows(w: World) {
    return (await s().owner.db.execute(
      sql`select a.outcome, a.actor_subject_id, c.client_id as actor_client, a.detail
            from audit_events a left join clients c on c.id = a.actor_client_id
           where a.tenant_id = ${w.tenantId} and a.action = 'agent.tool_call'`,
    )) as unknown as {
      outcome: string;
      actor_subject_id: string;
      actor_client: string;
      detail: Record<string, unknown>;
    }[];
  }

  it('returns data for a tool the administrator may use, naming odudu-assistant in the audit row', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['use-assistant', 'view-users']);
    const { id, body } = await converse(w, 'count_subjects');
    expect(body).toContain('tool-output-available');
    expect(body).not.toContain('tool-output-error');
    const grant = await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).byId(id),
    );
    expect(grant).toMatchObject({
      subjectId: w.subjectId,
      exchangedFromGrantId: w.grantId,
      sessionId: w.sessionId,
      scope: 'mcp:read',
    });
    const rows = await toolRows(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'allowed',
      actor_subject_id: w.subjectId,
      actor_client: ASSISTANT_CLIENT_ID,
    });
    expect(await count('agent_instances', 'root_grant_id', id)).toBe(1);
  });

  it('is refused by the door for a tool the administrator may not use, and says so in the row', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['use-assistant']);
    const { body } = await converse(w, 'count_subjects');
    expect(body).toContain('Forbidden');
    const rows = await toolRows(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'refused', actor_client: ASSISTANT_CLIENT_ID });
  });

  it('refuses to start a conversation on an MCP agent’s token', async () => {
    const w = await mcpWorld(s().appDb, BASE, ['use-assistant'], 'openid mcp:read');
    const agentToken = await s().sign(w, 'mcp:read');
    const res = await route(on(), w, '/conversations', agentToken, { page_context: CONTEXT });
    expect(res.statusCode).not.toBe(201);
    expect(await count('assistant_conversations', 'tenant_id', w.tenantId)).toBe(0);
  });
  it('carries on after the instance lapsed, with a new instance, and leaves the old one ended', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['use-assistant', 'view-users']);
    const { id } = await converse(w, 'count_subjects');
    const [first] = await instancesOf(id);
    expect(first?.live).toBe(true);
    await s().owner.db.execute(
      sql`update agent_instances set idle_expires_at = now() - interval '1 minute'
           where root_grant_id = ${id}`,
    );

    const body = await say(w, id, 'how many, after a break?');

    expect(body).toContain('tool-output-available');
    expect(body).not.toContain('Forbidden');
    expect(await generationOf(id)).toBe(1);
    const instances = await instancesOf(id);
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({ id: first?.id, live: false, revoked: false });
    expect(instances[1]).toMatchObject({ live: true, revoked: false });
    expect(instances[1]?.id).toBe(runInstanceId(w.tenantId, id, runKey(id, 1)));
    const stored = (await s().owner.db.execute(
      sql`select instance_id from assistant_conversations where id = ${id}`,
    )) as unknown as { instance_id: string }[];
    expect(stored[0]?.instance_id).toBe(instances[1]?.id);
    expect(await toolRows(w)).toHaveLength(2);
  });

  it('does not move to a new run for any other refusal, and audits it', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['use-assistant', 'view-users']);
    const { id } = await converse(w, 'count_subjects');
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(w.grantId, new Date()),
    );
    const { accessToken } = await mintAdmin(w);
    expect(accessToken).toBeTruthy();
    // The console grant is gone, so the door refuses the person's own token too;
    // the refusal under test is the mint's, reached with the grant revoked below it.
    const rows = (await s().owner.db.execute(
      sql`select run_generation from assistant_conversations where id = ${id}`,
    )) as unknown as { run_generation: number }[];
    expect(rows[0]?.run_generation).toBe(0);
    const mint = mintWith(() => new Date());
    await expect(mint(callerOf(w), run(id))).rejects.toMatchObject({ reason: 'grant_revoked' });
    expect(await generationOf(id)).toBe(0);
    const audited = (await s().owner.db.execute(
      sql`select a.outcome, a.actor_subject_id, c.client_id as actor_client, a.detail
            from audit_events a left join clients c on c.id = a.actor_client_id
           where a.tenant_id = ${w.tenantId} and a.action = 'assistant.access_refused'`,
    )) as unknown as {
      outcome: string;
      actor_subject_id: string;
      actor_client: string;
      detail: Record<string, string>;
    }[];
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      outcome: 'refused',
      actor_subject_id: w.subjectId,
      actor_client: ASSISTANT_CLIENT_ID,
      detail: {
        reason: 'denied',
        agent_client: ASSISTANT_CLIENT_ID,
        owner: w.subjectId,
        refusal: 'grant_revoked',
      },
    });
    expect(JSON.stringify(audited[0]?.detail)).not.toMatch(/eyJ/u);
  });
});

describe('what ends a conversation’s access', () => {
  async function state(w: World, derived: string) {
    const grants = (await s().owner.db.execute(
      sql`select revoked_at is not null as revoked from token_grants where id = ${derived}`,
    )) as unknown as { revoked: boolean }[];
    const instances = (await s().owner.db.execute(
      sql`select revoked_at is not null as revoked from agent_instances where root_grant_id = ${derived}`,
    )) as unknown as { revoked: boolean }[];
    return { grant: grants[0]?.revoked, instances: instances.map((i) => i.revoked) };
  }

  it('is refused for a disabled subject, writing no grant', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    await s().owner.db.execute(
      sql`update subjects set disabled_at = now() where id = ${w.subjectId}`,
    );
    const before = await count('token_grants', 'tenant_id', w.tenantId);
    await expect(open(w)).rejects.toMatchObject({ reason: 'subject_disabled' });
    expect(await count('token_grants', 'tenant_id', w.tenantId)).toBe(before);
  });

  it('is ended with the instance when the subject’s access is revoked, as disabling or recovering does', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const derived = await open(w);
    await mintWith(() => new Date())(callerOf(w), run(derived));
    expect(await state(w, derived)).toEqual({ grant: false, instances: [false] });
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubject(w.subjectId, new Date()),
    );
    expect(await state(w, derived)).toEqual({ grant: true, instances: [true] });
  });

  it('leaves no live grant under a console grant that was revoked while conversations were being made', async () => {
    for (let round = 0; round < 8; round += 1) {
      const w = await consoleWorld(s().appDb, BASE, ['view-users']);
      const opened = await Promise.allSettled([
        open(w),
        open(w),
        withTenant(s().appDb.db, w.tenantId, (tx) =>
          tokenGrantRepository(tx).revoke(w.grantId, new Date()),
        ),
      ]);
      const rows = (await s().owner.db.execute(
        sql`select count(*)::int as live from token_grants
             where exchanged_from_grant_id = ${w.grantId} and revoked_at is null`,
      )) as unknown as { live: number }[];
      expect(
        rows[0]?.live,
        `round ${String(round)}: ${JSON.stringify(opened.map((o) => o.status))}`,
      ).toBe(0);
    }
  });

  it('is made for an Act conversation with the same read scope, and no wider', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const derived = await open(w, { mode: 'act' });
    const grant = await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).byId(derived),
    );
    expect(grant?.scope).toBe('mcp:read');
    await expect(open(w, { mode: 'act', scope: ['mcp:read', 'mcp:write'] })).rejects.toMatchObject({
      reason: 'scope_widened',
    });
  });
});

describe('the grant of one approved write', () => {
  async function write(
    w: World,
    approvalId: string,
    over: Partial<Parameters<typeof grantAssistantWrite>[2]> = {},
  ) {
    const deps = { tenantId: w.tenantId, lifespans: await lifespans(w) };
    return withTenant(s().appDb.db, w.tenantId, (tx) =>
      grantAssistantWrite(tx, deps, {
        approvalId,
        consoleGrantId: w.grantId,
        expectedSubjectId: w.subjectId,
        now: new Date(),
        ...over,
      }),
    );
  }

  it('holds mcp:write alone, under the approval’s id, derived from the console sign-in', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-tenant']);
    const approvalId = newId();
    const grant = await write(w, approvalId);
    expect(grant).toMatchObject({
      id: approvalId,
      scope: 'mcp:write',
      subjectId: w.subjectId,
      sessionId: w.sessionId,
      exchangedFromGrantId: w.grantId,
    });
  });

  it('is made once for an approval, and not from a conversation’s own grant', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-tenant']);
    const approvalId = newId();
    await write(w, approvalId);
    await expect(write(w, approvalId)).rejects.toThrow();
    const conversation = await open(w, { mode: 'act' });
    await expect(write(w, newId(), { consoleGrantId: conversation })).rejects.toMatchObject({
      reason: 'grant_not_console',
    });
  });

  it('is refused for another person, a revoked sign-in and an ended session', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-tenant']);
    const other = await consoleWorld(s().appDb, BASE, ['manage-tenant']);
    await expect(write(w, newId(), { expectedSubjectId: other.subjectId })).rejects.toMatchObject({
      reason: 'subject_mismatch',
    });
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(w.grantId, new Date()),
    );
    await expect(write(w, newId())).rejects.toMatchObject({ reason: 'grant_revoked' });
  });

  it('mints a write token that amends a role and is refused the rest of the admin API', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['manage-tenant', 'manage-users', 'view-users']);
    const approvalId = newId();
    await write(w, approvalId);
    const now = new Date();
    const minted = await withTenant(s().appDb.db, w.tenantId, async (tx) =>
      mintAgentToken(
        tx,
        {
          tenantId: w.tenantId,
          issuer: w.issuer,
          kek: KEK,
          claimMappers: standardClaimMappers(),
          lifespans: await lifespans(w),
        },
        {
          subjectGrantId: approvalId,
          expectedSubjectId: w.subjectId,
          agentClientId: ASSISTANT_CLIENT_ID,
          audience: ADMIN_API_AUDIENCE,
          scope: ['mcp:write'],
          notAfter: new Date(now.getTime() + 300_000),
          now,
        },
      ),
    );
    expect(claimsOf(minted.accessToken)).toMatchObject({
      scope: 'mcp:write',
      client_id: ASSISTANT_CLIENT_ID,
      act: { sub: ASSISTANT_CLIENT_ID },
    });
    expect(await count('agent_instances', 'root_grant_id', approvalId)).toBe(0);
    const post = await s().app.inject({
      method: 'POST',
      url: `/admin/tenants/${w.name}/subjects`,
      headers: {
        host: HOST,
        authorization: `Bearer ${minted.accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ type: 'user', username: 'mallory' }),
    });
    expect(post.statusCode).toBe(403);
    // It cannot be minted for the read scope: its grant holds no more than the write.
    await expect(rawMint(w, approvalId, ['mcp:read'])).rejects.toMatchObject({
      reason: 'scope_widened',
    });
  });
});
