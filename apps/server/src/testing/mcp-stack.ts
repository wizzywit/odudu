import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { hostState, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { loadConfig, mcpAudienceOfIssuer, newId } from '@odudu/kernel';
import {
  callMcpTool,
  createInProcessCaller,
  exchangeForAdmin,
  newRequestScope,
  TOOLS,
  validatedMcpToken,
  type AdminCaller,
  type McpCallDeps,
  type ToolResult,
} from '@odudu/mcp';
import { standardClaimMappers } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';
import { mcpDepsFor } from '#/mcp-deps';
import { mcpSystemWorld, mcpWorld, type World } from '#/testing/mcp-world';

const KEK = Buffer.alloc(32, 7);
export const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const LEGACY = { 'mcp-protocol-version': '2025-11-25' };

export interface Sent {
  readonly status: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly text: string;
  readonly json: () => Record<string, unknown>;
}

export interface McpStack {
  readonly app: FastifyInstance;
  readonly appDb: DatabaseHandle;
  readonly owner: DatabaseHandle;
  // Every admin request the app saw, in order.
  readonly adminSeen: string[];
  world(capabilities: readonly string[], grantScope: string): Promise<World>;
  // The same for a person in the system tenant.
  systemWorld(capabilities: readonly string[], grantScope: string): Promise<World>;
  // An access token of the MCP audience for the world's owner, signed by the tenant.
  sign(w: World, scope: string, claims?: Record<string, unknown>): Promise<string>;
  send(w: World, token: string | null, body: unknown): Promise<Sent>;
  // A tools/call over the real endpoint, answered as the tool result.
  call(w: World, token: string, name: string, args?: unknown): Promise<ToolResult>;
  // A caller that asks the admin API with `scope` whatever the tool needs, so
  // the refusal under test is the admin API's and not this layer's.
  unguardedCaller(w: World, scope: readonly string[]): AdminCaller;
  runUnguarded(
    w: World,
    scope: readonly string[],
    name: string,
    args: unknown,
  ): Promise<ToolResult>;
  auditRows(w: World, action?: string): Promise<(typeof auditEvents.$inferSelect)[]>;
  close(): Promise<void>;
}

// A real database, the real app and the real endpoint, for the tests that
// drive a tool as an agent would.
// A JSON-RPC error (a name that is no tool), read as the refusal it is.
function refusalOf(title: string, status: number): ToolResult {
  const refusal = { error: { type: 'jsonrpc:error', title, status } };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(refusal) }],
    structuredContent: refusal,
  };
}

function unknownTool(name: string): ToolResult {
  return refusalOf(`Tool ${name} not found`, -32602);
}

export async function startMcpStack(): Promise<McpStack> {
  const container: TestDatabase = await startTestDatabase();
  const owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  const appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  const app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    hostState: (host) => hostState(owner.db, host, new Date()),
  });
  const adminSeen: string[] = [];
  app.addHook('onRequest', (request, _reply, done) => {
    if (request.url.startsWith('/admin/')) adminSeen.push(`${request.method} ${request.url}`);
    done();
  });
  await app.ready();
  const deps = mcpDepsFor({
    app,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    claimMappers: standardClaimMappers(),
    logger,
    publicBaseUrl: BASE,
  });

  const stack: McpStack = {
    app,
    appDb,
    owner,
    adminSeen,
    world: (capabilities, grantScope) => mcpWorld(appDb, BASE, capabilities, grantScope),
    systemWorld: (capabilities, grantScope) =>
      mcpSystemWorld(appDb, BASE, capabilities, grantScope),
    async sign(w, scope, claims = {}) {
      const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
      const iat = Math.floor(Date.now() / 1000);
      return signJwt(
        {
          iss: w.issuer,
          sub: w.subjectId,
          aud: [mcpAudienceOfIssuer(w.issuer)],
          client_id: MCP_CLIENT_ID,
          grant_id: w.grantId,
          sid: w.sessionId,
          scope: `openid ${scope}`,
          iat,
          exp: iat + 600,
          ...claims,
        },
        { key, kek: KEK, typ: 'at+jwt' },
      );
    },
    async send(w, token, body) {
      const headers: Record<string, string> = {
        host: HOST,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...LEGACY,
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      };
      const res = await app.inject({
        method: 'POST',
        url: `/tenants/${w.name}/mcp`,
        headers,
        payload: JSON.stringify(body),
      });
      const text = res.payload;
      return {
        status: res.statusCode,
        headers: res.headers,
        text,
        json: () => {
          const data = /^data: (.*)$/mu.exec(text)?.[1] ?? text;
          const parsed: unknown = JSON.parse(data);
          return parsed as Record<string, unknown>;
        },
      };
    },
    async call(w, token, name, args = {}) {
      const res = await stack.send(w, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      if (res.status !== 200) throw new Error(`tools/call answered ${String(res.status)}`);
      const body = res.json();
      if (body.result !== undefined) return body.result as ToolResult;
      // A JSON-RPC error (a name that is no tool) read as the refusal it is.
      const error = body.error as { code: number; message: string };
      const refusal = {
        error: { type: 'jsonrpc:error', title: error.message, status: error.code },
      };
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(refusal) }],
        structuredContent: refusal,
      };
    },
    unguardedCaller(w, scope) {
      const token = validatedMcpToken({
        tenant: { id: w.tenantId, name: w.name },
        issuer: w.issuer,
        subjectId: w.subjectId,
        clientId: MCP_CLIENT_ID,
        grantId: w.grantId,
        scope: [...scope],
        expSeconds: Math.floor(Date.now() / 1000) + 600,
      });
      const call: McpCallDeps = { ...deps, request: newRequestScope(newId(), '10.1.2.3') };
      return createInProcessCaller(
        {
          inject: (options) => deps.inject(options),
          adminBearer: async () => (await exchangeForAdmin(call, token, scope)).bearer,
          requestId: call.request.requestId,
          ip: call.request.ip,
          adminHost: deps.adminHost,
          logger,
        },
        token,
      );
    },
    async runUnguarded(w, scope, name, args) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (tool === undefined) return unknownTool(name);
      return callMcpTool(
        { requestId: newId(), deadlineMs: 20_000, record: () => Promise.resolve(), logger },
        tool,
        stack.unguardedCaller(w, scope),
        args,
      );
    },
    auditRows: (w, action) =>
      withTenant(appDb.db, w.tenantId, (tx) =>
        action === undefined
          ? tx.select().from(auditEvents).orderBy(auditEvents.id)
          : tx
              .select()
              .from(auditEvents)
              .where(eq(auditEvents.action, action))
              .orderBy(auditEvents.id),
      ),
    async close() {
      await app.close();
      delete process.env.ODUDU_DATABASE_URL;
      delete process.env.ODUDU_APP_DATABASE_URL;
      delete process.env.ODUDU_KEK;
      await appDb.close();
      await owner.close();
      await container.stop();
    },
  };
  return stack;
}
