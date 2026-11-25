import { resolveSlots } from '@odudu/assistant';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, hostState } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
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

  it('serves no other assistant route, so none can be told from a path that never existed', async () => {
    const w = await s().world(['use-assistant', 'manage-assistant'], 'openid');
    const token = await adminToken(w);
    for (const app of [s().app, on()]) {
      expect((await get(app, w, '/conversations', token)).statusCode).toBe(404);
    }
  });
});

const CHOSEN = {
  assistant_enabled: true,
  assistant_default_mode: 'act',
  assistant_mask_emails: true,
  assistant_trace_retention_days: 90,
  assistant_auditor_visible: false,
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
  assistant_auditor_visible: true,
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
      assistant_auditor_visible: { before: true, after: false },
      assistant_monthly_tokens_fast: { before: 2_000_000, after: 1000 },
      assistant_monthly_tokens_standard: { before: 5_000_000, after: 2000 },
      assistant_monthly_tokens_deep: { before: 1_000_000, after: 3000 },
      assistant_max_concurrent: { before: 5, after: 3 },
      assistant_max_steps_per_turn: { before: 20, after: 10 },
    });
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
    const w = await s().world(['use-assistant', 'read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    expect((await get(on(), w, '/settings', token)).statusCode).toBe(403);
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
    expect((await get(s().app, a, '/settings', await adminToken(a))).statusCode).toBe(404);
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
