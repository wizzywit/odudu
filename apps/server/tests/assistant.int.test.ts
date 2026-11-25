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
      for (const tail of ['/conversations', '/settings']) {
        expect((await get(app, w, tail, token)).statusCode, tail).toBe(404);
      }
    }
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
