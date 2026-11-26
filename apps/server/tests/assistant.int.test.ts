import { resolveSlots } from '@odudu/assistant';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, hostState } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { runInstanceId, tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { turnAuditRecorder } from '#/assistant-chat';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { type World } from '#/testing/mcp-world';

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const SECRET = 'sk-ant-test-0123456789';
const ENV = {
  ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-standard,deep=anthropic:claude-deep',
  ANTHROPIC_API_KEY: SECRET,
};

let stack: McpStack | undefined;
let assisted: FastifyInstance | undefined;

// A model that answers with one fixed sentence. `ai` is the assistant package's
// alone to import, so the stub is the provider interface written out.
const ANSWER = 'You have one client.';
const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const FIXED_MODEL = {
  specificationVersion: 'v3',
  provider: 'stub',
  modelId: 'stub',
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('streaming only')),
  doStream: () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          for (const part of [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'a' },
            { type: 'text-delta', id: 'a', delta: ANSWER },
            { type: 'text-end', id: 'a' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
          ]) {
            controller.enqueue(part);
          }
          controller.close();
        },
      }),
    }),
};

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}
function on(): FastifyInstance {
  if (assisted === undefined) throw new Error('app not built');
  return assisted;
}

beforeAll(async () => {
  stack = await startMcpStack();
  assisted = buildApp({
    database: stack.appDb,
    ownerDatabase: stack.owner,
    kek: KEK,
    logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    hostState: (host) => hostState(s().owner.db, host, new Date()),
    assistant: { slots: resolveSlots(ENV), env: ENV },
    assistantModels: () => FIXED_MODEL as never,
  });
  await assisted.ready();
}, 180_000);
afterAll(async () => {
  await assisted?.close();
  await stack?.close();
});

// A person's token for the admin API, as the console holds one.
async function adminToken(w: World): Promise<string> {
  const grantId = newId();
  const key = await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: w.adminDbId,
      subjectId: w.subjectId,
      scope: '',
      audience: [ADMIN_API_AUDIENCE],
      sessionId: w.sessionId,
    });
    return signingKeyRepository(tx).active();
  });
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
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

function get(app: FastifyInstance, w: World, tail: string, token: string) {
  return app.inject({
    method: 'GET',
    url: `/admin/tenants/${w.name}/assistant${tail}`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
  });
}

describe('the assistant status route in the running server', () => {
  it('answers { enabled: false } when no model is configured', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const res = await get(s().app, w, '/status', await adminToken(w));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });

  it('answers the resolved slots when one is configured, and never the key', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const res = await get(on(), w, '/status', await adminToken(w));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      slots: { fast: 'claude-standard', standard: 'claude-standard', deep: 'claude-deep' },
      modes: ['ask', 'act'],
      defaultMode: 'ask',
      modelChoices: ['claude-standard', 'claude-deep'],
      provider: { kind: 'anthropic' },
    });
    expect(res.body).not.toContain(SECRET);
  });

  it('refuses a caller without use-assistant with 403', async () => {
    const w = await s().world(['view-users', 'manage-assistant'], 'openid');
    expect((await get(on(), w, '/status', await adminToken(w))).statusCode).toBe(403);
  });

  it('serves no listing of conversations, so that path cannot be told from one that never existed', async () => {
    const w = await s().world(['use-assistant', 'manage-assistant'], 'openid');
    const token = await adminToken(w);
    for (const app of [s().app, on()]) {
      for (const tail of ['/conversations']) {
        expect((await get(app, w, tail, token)).statusCode, tail).toBe(404);
      }
    }
  });
});

const CHOSEN = {
  assistant_enabled: true,
  assistant_default_mode: 'act',
  assistant_mask_emails: true,
  assistant_trace_retention_days: 90,
  assistant_auditor_visible: true,
  assistant_monthly_tokens_fast: 1000,
  assistant_monthly_tokens_standard: 2000,
  assistant_monthly_tokens_deep: 3000,
  assistant_max_concurrent: 3,
  assistant_max_steps_per_turn: 10,
};
const DEFAULTS = {
  assistant_enabled: true,
  assistant_default_mode: 'ask',
  assistant_mask_emails: false,
  assistant_trace_retention_days: 30,
  assistant_auditor_visible: false,
  assistant_monthly_tokens_fast: 2_000_000,
  assistant_monthly_tokens_standard: 5_000_000,
  assistant_monthly_tokens_deep: 1_000_000,
  assistant_max_concurrent: 5,
  assistant_max_steps_per_turn: 20,
};

function put(app: FastifyInstance, w: World, token: string, body: unknown) {
  return app.inject({
    method: 'PUT',
    url: `/admin/tenants/${w.name}/assistant/settings`,
    headers: { host: HOST, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

async function configRows(app: FastifyInstance, w: World, token: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/admin/tenants/${w.name}/audit?action=assistant.config`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: { outcome: string; resource_type: string; detail: unknown }[] }>().items;
}

describe('the assistant settings route', () => {
  it('reads every default for a tenant that has chosen nothing', async () => {
    const w = await s().world(['manage-assistant'], 'openid');
    const res = await get(on(), w, '/settings', await adminToken(w));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(DEFAULTS);
  });

  it('stores a change, answers it back and writes one assistant.config row of before and after', async () => {
    const w = await s().world(['manage-assistant', 'view-audit'], 'openid');
    const token = await adminToken(w);
    const res = await put(on(), w, token, CHOSEN);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(CHOSEN);
    expect((await get(on(), w, '/settings', token)).json()).toEqual(CHOSEN);

    const rows = await configRows(on(), w, token);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', resource_type: 'assistant_settings' });
    expect(rows[0]?.detail).toEqual({
      assistant_default_mode: { before: 'ask', after: 'act' },
      assistant_mask_emails: { before: false, after: true },
      assistant_trace_retention_days: { before: 30, after: 90 },
      assistant_auditor_visible: { before: false, after: true },
      assistant_monthly_tokens_fast: { before: 2_000_000, after: 1000 },
      assistant_monthly_tokens_standard: { before: 5_000_000, after: 2000 },
      assistant_monthly_tokens_deep: { before: 1_000_000, after: 3000 },
      assistant_max_concurrent: { before: 5, after: 3 },
      assistant_max_steps_per_turn: { before: 20, after: 10 },
    });
  });

  it('lets only one of two saves on the same ETag through, and chains the audit before and after', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await s().world(['manage-assistant', 'view-audit'], 'openid');
      const token = await adminToken(w);
      const etag = String((await get(on(), w, '/settings', token)).headers.etag);
      const save = (steps: number) =>
        on().inject({
          method: 'PUT',
          url: `/admin/tenants/${w.name}/assistant/settings`,
          headers: {
            host: HOST,
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'if-match': etag,
          },
          payload: JSON.stringify({ ...DEFAULTS, assistant_max_steps_per_turn: steps }),
        });
      const results = await Promise.all([save(11), save(12)]);
      expect(results.map((r) => r.statusCode).sort(), `round ${String(round)}`).toEqual([200, 412]);
      const rows = await configRows(on(), w, token);
      expect(rows).toHaveLength(1);
      const winner = results
        .find((r) => r.statusCode === 200)
        ?.json<{
          assistant_max_steps_per_turn: number;
        }>();
      expect(rows[0]?.detail).toEqual({
        assistant_max_steps_per_turn: { before: 20, after: winner?.assistant_max_steps_per_turn },
      });
    }
  });

  it('answers an ETag and refuses a save over a version it did not read', async () => {
    const w = await s().world(['manage-assistant'], 'openid');
    const token = await adminToken(w);
    const read = await get(on(), w, '/settings', token);
    const etag = read.headers.etag;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);
    const stale = await on().inject({
      method: 'PUT',
      url: `/admin/tenants/${w.name}/assistant/settings`,
      headers: {
        host: HOST,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale"',
      },
      payload: JSON.stringify(CHOSEN),
    });
    expect(stale.statusCode, stale.body).toBe(412);
    expect((await get(on(), w, '/settings', token)).json()).toEqual(DEFAULTS);
    const fresh = await on().inject({
      method: 'PUT',
      url: `/admin/tenants/${w.name}/assistant/settings`,
      headers: {
        host: HOST,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': String(etag),
      },
      payload: JSON.stringify(CHOSEN),
    });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.headers.etag).not.toBe(etag);
  });

  it('writes no row for a save that changes nothing', async () => {
    const w = await s().world(['manage-assistant', 'view-audit'], 'openid');
    const token = await adminToken(w);
    expect((await put(on(), w, token, DEFAULTS)).statusCode).toBe(200);
    expect(await configRows(on(), w, token)).toEqual([]);
  });

  it('refuses a caller holding use-assistant alone, for a read and a write', async () => {
    const w = await s().world(['use-assistant', 'view-audit'], 'openid');
    const token = await adminToken(w);
    expect((await get(on(), w, '/settings', token)).statusCode).toBe(403);
    expect((await put(on(), w, token, CHOSEN)).statusCode).toBe(403);
  });

  it('lets a holder of read-assistant-activity read the settings but not change them', async () => {
    const w = await s().world(['read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    expect((await get(on(), w, '/settings', token)).statusCode).toBe(200);
    expect((await put(on(), w, token, CHOSEN)).statusCode).toBe(403);
  });

  it('turns the assistant off for that tenant only, and back on', async () => {
    const off = await s().world(['manage-assistant', 'use-assistant'], 'openid');
    const other = await s().world(['use-assistant'], 'openid');
    const offToken = await adminToken(off);
    const otherToken = await adminToken(other);
    expect(
      (await put(on(), off, offToken, { ...DEFAULTS, assistant_enabled: false })).statusCode,
    ).toBe(200);
    expect((await get(on(), off, '/status', offToken)).json()).toEqual({ enabled: false });
    expect((await get(on(), other, '/status', otherToken)).json()).toMatchObject({ enabled: true });

    await put(on(), off, offToken, DEFAULTS);
    expect((await get(on(), off, '/status', offToken)).json()).toMatchObject({ enabled: true });
  });

  it('offers the default mode a tenant chose in its status', async () => {
    const w = await s().world(['manage-assistant', 'use-assistant'], 'openid');
    const token = await adminToken(w);
    await put(on(), w, token, { ...DEFAULTS, assistant_default_mode: 'act' });
    expect((await get(on(), w, '/status', token)).json()).toMatchObject({ defaultMode: 'act' });
  });

  it('refuses a value outside its range, a missing setting and an unknown one with 400', async () => {
    const w = await s().world(['manage-assistant', 'view-audit'], 'openid');
    const token = await adminToken(w);
    const missing = Object.fromEntries(
      Object.entries(DEFAULTS).filter(([name]) => name !== 'assistant_max_concurrent'),
    );
    const bad: unknown[] = [
      { ...DEFAULTS, assistant_trace_retention_days: 0 },
      { ...DEFAULTS, assistant_trace_retention_days: 366 },
      { ...DEFAULTS, assistant_trace_retention_days: 1.5 },
      { ...DEFAULTS, assistant_max_concurrent: 51 },
      { ...DEFAULTS, assistant_max_steps_per_turn: 0 },
      { ...DEFAULTS, assistant_monthly_tokens_deep: -1 },
      { ...DEFAULTS, assistant_default_mode: 'always' },
      { ...DEFAULTS, assistant_api_key: 'sk' },
      missing,
    ];
    for (const body of bad) {
      expect((await put(on(), w, token, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await get(on(), w, '/settings', token)).json()).toEqual(DEFAULTS);
    expect(await configRows(on(), w, token)).toEqual([]);
  });

  it('is not served where no model is configured, and a tenant never reads another tenant row', async () => {
    const a = await s().world(['manage-assistant'], 'openid');
    const b = await s().world(['manage-assistant'], 'openid');
    const aToken = await adminToken(a);
    const unserved = await get(s().app, a, '/settings', aToken);
    const never = await get(s().app, a, '/conversations', aToken);
    expect(unserved.statusCode).toBe(404);
    const withoutInstance = (body: string): unknown =>
      Object.fromEntries(
        Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
          ([name]) => name !== 'instance',
        ),
      );
    expect(withoutInstance(unserved.body)).toEqual(withoutInstance(never.body));
    await put(on(), a, await adminToken(a), CHOSEN);
    expect((await get(on(), b, '/settings', await adminToken(b))).json()).toEqual(DEFAULTS);
  });
});

describe('the MCP endpoint with and without a configured assistant', () => {
  it('answers byte for byte the same', async () => {
    const w = await s().world(['view-users', 'manage-tenant'], 'openid mcp:read');
    const token = await s().sign(w, 'mcp:read');
    const requests: unknown[] = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool' } },
    ];
    const ask = (app: FastifyInstance, bearer: string | null, body: unknown) =>
      app.inject({
        method: 'POST',
        url: `/tenants/${w.name}/mcp`,
        headers: {
          host: HOST,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
          ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
        },
        payload: JSON.stringify(body),
      });
    for (const [bearer, body] of [
      ...requests.map((r) => [token, r] as const),
      [null, requests[0]] as const,
    ]) {
      const without = await ask(s().app, bearer, body);
      const withSlot = await ask(on(), bearer, body);
      expect(withSlot.statusCode).toBe(without.statusCode);
      expect(withSlot.payload).toBe(without.payload);
      expect(withSlot.headers['content-type']).toBe(without.headers['content-type']);
    }
  });
});

function post(app: FastifyInstance, w: World, tail: string, token: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url: `/admin/tenants/${w.name}/assistant${tail}`,
    headers: { host: HOST, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

describe('the conversation routes in the running server', () => {
  const CONTEXT = { route: '/clients', objectType: 'client', objectId: 'web' };

  it('creates a conversation acting as the instance of its run, and loads it', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await adminToken(w);
    const created = await post(on(), w, '/conversations', token, { page_context: CONTEXT });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<{ id: string }>();

    const rows = (await s().owner.db.execute(
      sql`select instance_id from assistant_conversations where id = ${id}`,
    )) as unknown as { instance_id: string }[];
    expect(rows[0]?.instance_id).toBe(runInstanceId(w.tenantId, id, `${id}.0`));

    const loaded = await get(on(), w, `/conversations/${id}`, token);
    expect(loaded.statusCode, loaded.body).toBe(200);
    expect(loaded.json()).toMatchObject({ id, profile: 'free-chat', mode: 'ask', messages: [] });
  });

  it('streams a turn and stores it, so a later load shows both messages', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await adminToken(w);
    const { id } = (await post(on(), w, '/conversations', token, { page_context: CONTEXT })).json<{
      id: string;
    }>();
    const message = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'how many?' }] };
    const turn = await post(on(), w, `/conversations/${id}/messages`, token, { message });
    expect(turn.statusCode, turn.body).toBe(200);
    expect(turn.headers['content-type']).toContain('text/event-stream');
    expect(turn.body).toContain(ANSWER);

    const loaded = (await get(on(), w, `/conversations/${id}`, token)).json<{
      messages: { role: string }[];
    }>();
    expect(loaded.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('answers 404 for a conversation in another tenant’s path, and with no model configured', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await adminToken(w);
    const { id } = (await post(on(), w, '/conversations', token, { page_context: CONTEXT })).json<{
      id: string;
    }>();
    const other = await s().world(['use-assistant'], 'openid');
    const otherToken = await adminToken(other);
    expect((await get(on(), other, `/conversations/${id}`, otherToken)).statusCode).toBe(404);
    expect(
      (await post(s().app, w, '/conversations', token, { page_context: CONTEXT })).statusCode,
    ).toBe(404);
  });
});

// A model that asks for one read and then answers, so a turn makes a tool call.
// `reads` is how many steps ask for a read before the answer.
// What the answer says, when a test wants it to say something else.
let spoken = ANSWER;

function readingModel(reads: () => number) {
  let call = 0;
  return {
    ...FIXED_MODEL,
    doStream: () => {
      call += 1;
      const parts =
        (call - 1) % (reads() + 1) < reads()
          ? [
              {
                type: 'tool-call',
                toolCallId: `c${String(call)}`,
                toolName: 'get_tenant',
                input: '{}',
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: USAGE,
              },
            ]
          : [
              { type: 'text-start', id: 'a' },
              { type: 'text-delta', id: 'a', delta: spoken },
              { type: 'text-end', id: 'a' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
            ];
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe('the audit rows of a turn in the running server', () => {
  const CONTEXT = { route: '/clients', objectType: 'client', objectId: 'web' };
  const PRIVATE = 'the Hadleigh payroll';
  let reading: FastifyInstance | undefined;
  let readsPerTurn = 1;
  // The admin routes the assistant's tool calls reached, not its own.
  const adminHits: string[] = [];

  beforeAll(async () => {
    reading = buildApp({
      database: s().appDb,
      ownerDatabase: s().owner,
      kek: KEK,
      logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
      tls: true,
      publicBaseUrl: BASE,
      throttle: { limit: 100_000, windowSeconds: 60 },
      hostState: (host) => hostState(s().owner.db, host, new Date()),
      assistant: { slots: resolveSlots(ENV), env: ENV },
      assistantModels: () => readingModel(() => readsPerTurn) as never,
    });
    reading.addHook('onRequest', (request, _reply, done) => {
      if (request.url.startsWith('/admin/tenants/') && !request.url.includes('/assistant')) {
        adminHits.push(request.url);
      }
      done();
    });
    await reading.ready();
  }, 60_000);
  afterAll(async () => {
    await reading?.close();
  });

  function app(): FastifyInstance {
    if (reading === undefined) throw new Error('app not built');
    return reading;
  }

  async function conversationOf(w: World, token: string): Promise<string> {
    const created = await post(app(), w, '/conversations', token, { page_context: CONTEXT });
    return created.json<{ id: string }>().id;
  }

  const message = (text: string) => ({
    id: newId(),
    role: 'user',
    parts: [{ type: 'text', text }],
  });

  // Makes the database refuse an audit row of `action` for this tenant, for as long as `run` takes.
  async function refusing<T>(
    w: World,
    action: string,
    phase: string | null,
    run: () => Promise<T>,
  ) {
    const name = `p5c_refuse_${newId().replaceAll('-', '')}`;
    // DDL takes no parameters; both values are ones this test made.
    const phaseTest = sql.raw(phase === null ? 'true' : `new.detail ->> 'phase' = '${phase}'`);
    const tenant = sql.raw(`'${w.tenantId}'`);
    await s().owner.db.execute(sql`
      create function ${sql.identifier(name)}() returns trigger language plpgsql as $$
      begin
        if new.tenant_id = ${tenant}::uuid and ${phaseTest} then
          raise exception 'audit refused';
        end if;
        return new;
      end $$`);
    await s().owner.db.execute(sql`
      create trigger ${sql.identifier(name)} before insert on audit_events
      for each row when (new.action = ${sql.raw(`'${action}'`)}) execute function ${sql.identifier(name)}()`);
    try {
      return await run();
    } finally {
      await s().owner.db.execute(sql`drop trigger ${sql.identifier(name)} on audit_events`);
      await s().owner.db.execute(sql`drop function ${sql.identifier(name)}()`);
    }
  }

  it('keeps the provider key out of the trace when the model repeats it', async () => {
    const w = await s().world(['use-assistant', 'manage-tenant'], 'openid');
    const token = await adminToken(w);
    const id = await conversationOf(w, token);
    spoken = `the key is ${SECRET}, keep it safe`;
    readsPerTurn = 0;
    try {
      const turn = await post(app(), w, `/conversations/${id}/messages`, token, {
        message: message(PRIVATE),
      });
      expect(turn.statusCode, turn.body).toBe(200);
    } finally {
      spoken = ANSWER;
      readsPerTurn = 1;
    }
    const stored = await s().owner.db.execute(
      sql`select payload::text as text from assistant_events where tenant_id = ${w.tenantId}`,
    );
    const text = JSON.stringify([...stored]);
    expect(text).toContain('keep it safe');
    expect(text).not.toContain(SECRET);
  });

  it('leaves a started and an ended row, and tool-call rows naming both ids, with no message text', async () => {
    const w = await s().world(['use-assistant', 'manage-tenant'], 'openid');
    const token = await adminToken(w);
    const id = await conversationOf(w, token);
    const turn = await post(app(), w, `/conversations/${id}/messages`, token, {
      message: message(PRIVATE),
    });
    expect(turn.statusCode, turn.body).toBe(200);
    expect(turn.body).toContain(ANSWER);

    const rows = await s().auditRows(w, 'assistant.turn');
    const details = rows.map((row) => row.detail as Record<string, unknown>);
    expect(details.map((d) => d.phase)).toEqual(['started', 'ended']);
    const [opened, closed] = details;
    expect(opened).toMatchObject({ conversation: id, profile: 'free-chat', mode: 'ask' });
    expect(closed).toMatchObject({
      conversation: id,
      turn: opened?.turn,
      stop_reason: 'done',
      trace_lost: false,
    });
    expect(closed?.steps).toBe(2);
    expect(Object.keys(closed?.tokens_by_slot as object)).toEqual(['standard']);
    expect(rows.every((row) => row.resourceId === id && row.outcome === 'allowed')).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.detail))).not.toContain('Hadleigh');

    const calls = await s().auditRows(w, 'agent.tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.detail).toMatchObject({ conversation: id, turn: opened?.turn });
  });

  it('writes the rows of a tenant that keeps only the narrowest event types', async () => {
    const w = await s().world(['use-assistant', 'manage-tenant'], 'openid');
    await s().owner.db.execute(
      sql`update tenants set audit_event_types = '{admin_mutation,admin_access}' where id = ${w.tenantId}`,
    );
    const token = await adminToken(w);
    const id = await conversationOf(w, token);
    await post(app(), w, `/conversations/${id}/messages`, token, { message: message(PRIVATE) });
    expect(await s().auditRows(w, 'assistant.turn')).toHaveLength(2);
  });

  it('holds exactly the allowed keys for a turn that ended on a limit, as refused', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const recorder = turnAuditRecorder({ database: s().appDb });
    const base = {
      tenantId: w.tenantId,
      subjectId: w.subjectId,
      conversationId: newId(),
      turnId: newId(),
      profile: 'free-chat',
      mode: 'ask' as const,
      slots: ['standard' as const],
    };
    await recorder.recordTurnStart(base);
    await recorder.recordTurn({
      ...base,
      tokensBySlot: { standard: 12 },
      steps: 0,
      stopReason: 'budget_tenant',
      outcome: 'refused',
      traceLost: true,
    });
    const [started, ended] = await s().auditRows(w, 'assistant.turn');
    expect(Object.keys(started?.detail as object).sort()).toEqual(
      ['conversation', 'mode', 'phase', 'profile', 'slots', 'subject', 'tenant', 'turn'].sort(),
    );
    expect(Object.keys(ended?.detail as object).sort()).toEqual(
      [
        'conversation',
        'mode',
        'phase',
        'profile',
        'slots',
        'steps',
        'stop_reason',
        'subject',
        'tenant',
        'tokens_by_slot',
        'trace_lost',
        'turn',
      ].sort(),
    );
    expect(ended?.detail).toMatchObject({ trace_lost: true });
    expect(ended).toMatchObject({ outcome: 'refused' });
    expect(started).toMatchObject({ outcome: 'allowed' });
  });

  it('does not begin a turn whose opening row cannot be written', async () => {
    const w = await s().world(['use-assistant', 'manage-tenant'], 'openid');
    const token = await adminToken(w);
    const id = await conversationOf(w, token);
    const turn = await refusing(w, 'assistant.turn', 'started', () =>
      post(app(), w, `/conversations/${id}/messages`, token, { message: message(PRIVATE) }),
    );
    expect(turn.statusCode).toBeGreaterThanOrEqual(500);
    expect(await s().auditRows(w, 'assistant.turn')).toHaveLength(0);
    expect(await s().auditRows(w, 'agent.tool_call')).toHaveLength(0);
    const loaded = (await get(app(), w, `/conversations/${id}`, token)).json<{
      messages: unknown[];
    }>();
    expect(loaded.messages).toEqual([]);
  });

  it('withholds a tool’s data when its row cannot be written, and still closes the turn', async () => {
    const w = await s().world(['use-assistant', 'manage-tenant'], 'openid');
    const token = await adminToken(w);
    const id = await conversationOf(w, token);
    readsPerTurn = 2;
    adminHits.length = 0;
    const turn = await refusing(w, 'agent.tool_call', null, () =>
      post(app(), w, `/conversations/${id}/messages`, token, { message: message(PRIVATE) }),
    );
    readsPerTurn = 1;
    // The first read was made, and only its data is withheld; the second was
    // refused before it ran.
    expect(adminHits).toHaveLength(1);
    expect(turn.body).toContain('audit_unavailable');
    expect(turn.body).not.toContain('"issuer"');
    expect(await s().auditRows(w, 'agent.tool_call')).toHaveLength(0);
    expect(
      (await s().auditRows(w, 'assistant.turn')).map(
        (row) => (row.detail as { phase: string }).phase,
      ),
    ).toEqual(['started', 'ended']);
  });
});
