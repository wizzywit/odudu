import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { roleRepository, subjectRoles } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  MCP_CLIENT_ID,
  tenantAddressing,
  tenantDomainRepository,
} from '@odudu/domain-tenant';
import {
  addressIssuer,
  domainAddress,
  loadConfig,
  mcpAudienceOfIssuer,
  newId,
  systemClock,
} from '@odudu/kernel';
import { TOOLS } from '@odudu/mcp';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppDeps } from '#/app';
import { createLogger } from '#/logger';
import { seed } from '#/cli/seed';
import { mcpWorld, type World } from '#/testing/mcp-world';

// The MCP endpoint through the real app: real signing keys, a real database,
// the SDK's own client in both protocol eras.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let limitedApp: FastifyInstance;
let throttledApp: FastifyInstance;
let addressingReads = 0;
let logger: ReturnType<typeof createLogger>;
const adminSeen: { url: string; authorization: string | undefined }[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';

function build(extra: Partial<AppDeps> = {}): FastifyInstance {
  const instance = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    ...extra,
  });
  instance.addHook('onRequest', (request, _reply, done) => {
    if (request.url.startsWith('/admin/')) {
      adminSeen.push({ url: request.url, authorization: request.headers.authorization });
    }
    done();
  });
  return instance;
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = build();
  limitedApp = build({
    mcpToolLimits: { perPrincipal: { limit: 3, windowSeconds: 60 } },
  });
  throttledApp = build({
    mcpOriginThrottle: { limit: 3, windowSeconds: 60 },
    addressing: (tenantName, issuer) => {
      addressingReads += 1;
      return tenantAddressing(owner.db, tenantName, issuer, systemClock.now());
    },
  });
  await Promise.all([app.ready(), limitedApp.ready(), throttledApp.ready()]);
}, 120_000);

afterAll(async () => {
  await app.close();
  await limitedApp.close();
  await throttledApp.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

const CAPS = ['manage-clients', 'view-users', 'view-audit', 'manage-tenant'];
const EVERY_CAPABILITY = [...CAPS, 'manage-sessions', 'manage-keys', 'view-domains'];
const world = (capabilities: readonly string[] = CAPS, grantScope = 'openid mcp:read') =>
  mcpWorld(appDb, BASE, capabilities, grantScope);
const mcpUrl = (w: World) => `/tenants/${w.name}/mcp`;

async function sign(
  w: World,
  claims: Record<string, unknown> = {},
  options: { typ?: string; signer?: World } = {},
): Promise<string> {
  const signer = options.signer ?? w;
  const key = await withTenant(appDb.db, signer.tenantId, (tx) =>
    signingKeyRepository(tx).active(),
  );
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [mcpAudienceOfIssuer(w.issuer)],
      client_id: MCP_CLIENT_ID,
      grant_id: w.grantId,
      sid: w.sessionId,
      scope: 'openid mcp:read',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: options.typ ?? 'at+jwt' },
  );
}

const LEGACY = { 'mcp-protocol-version': '2025-11-25' };
const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'int-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

interface Sent {
  readonly status: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly text: string;
  readonly json: () => Record<string, unknown>;
}

async function send(
  w: World,
  options: {
    token?: string | null;
    headers?: Record<string, string>;
    body?: unknown;
    on?: FastifyInstance;
    method?: 'POST' | 'GET' | 'DELETE';
    url?: string;
    raw?: string;
  } = {},
): Promise<Sent> {
  const headers: Record<string, string> = {
    host: HOST,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...options.headers,
  };
  if (options.token !== null && options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const res = await (options.on ?? app).inject({
    method: options.method ?? 'POST',
    url: options.url ?? mcpUrl(w),
    headers,
    ...(options.raw === undefined && options.body === undefined
      ? {}
      : { payload: options.raw ?? JSON.stringify(options.body) }),
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
}

function legacyCall(name: string, args: unknown = {}, id = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function modern(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    body: { jsonrpc: '2.0', id, method, params: { ...params, _meta: ENVELOPE } },
    headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method },
  };
}

async function auditRows(w: World, action: string) {
  return withTenant(appDb.db, w.tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );
}

describe('a request with no usable token', () => {
  it('is answered 401 with the challenge naming the metadata, and nothing else', async () => {
    const w = await world();
    const res = await send(w);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/tenants/${w.name}/mcp", scope="mcp:read"`,
    );
    expect(res.text).toBe('');
  });

  it('is answered the same for an unknown and for a disabled tenant, as the metadata is', async () => {
    const w = await world();
    const token = await sign(w);
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, w.tenantId));
    const unknown = await send(w, { url: '/tenants/no-such-tenant/mcp', token });
    const disabled = await send(w, { token });
    const metadata = (name: string) =>
      app.inject({
        method: 'GET',
        url: `/.well-known/oauth-protected-resource/tenants/${name}/mcp`,
        headers: { host: HOST },
      });
    expect(unknown.status).toBe(404);
    expect(disabled.status).toBe(404);
    expect(disabled.text).toBe(unknown.text);
    expect((await metadata('no-such-tenant')).statusCode).toBe(404);
    expect((await metadata(w.name)).statusCode).toBe(404);
  });

  it('does not read a token from the query string, the body or a cookie', async () => {
    const w = await world();
    const token = await sign(w);
    const body = { ...modern('tools/list').body, access_token: token };
    const res = await send(w, {
      url: `${mcpUrl(w)}?access_token=${token}`,
      headers: { ...modern('tools/list').headers, cookie: `access_token=${token}` },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('answers GET and DELETE 405 with Allow: POST', async () => {
    const w = await world();
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await send(w, { method, token: await sign(w) });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });
});

describe('a token that is not for this endpoint', () => {
  const sub = (w: World) => w.subjectId;

  async function refused(w: World, token: string): Promise<Sent> {
    const res = await send(w, { token, ...modern('tools/list') });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer error="invalid_token", resource_metadata="${BASE}/.well-known/oauth-protected-resource/tenants/${w.name}/mcp", scope="mcp:read"`,
    );
    expect(JSON.stringify(res.headers) + res.text).not.toContain(token);
    const signature = token.split('.')[2];
    if (signature !== undefined && signature.length > 16) {
      expect(JSON.stringify(res.headers) + res.text).not.toContain(signature);
    }
    return res;
  }

  it.each([
    ['the admin API’s audience', (w: World) => ({ aud: [ADMIN_API_AUDIENCE, w.issuer] })],
    [
      'the admin audience and this endpoint together',
      (w: World) => ({ aud: [mcpAudienceOfIssuer(w.issuer), ADMIN_API_AUDIENCE] }),
    ],
    ['the issuer alone, as an ID token or userinfo would', (w: World) => ({ aud: [w.issuer] })],
    [
      'the endpoint spelled with a trailing slash',
      (w: World) => ({ aud: [`${mcpAudienceOfIssuer(w.issuer)}/`] }),
    ],
    [
      'the endpoint with an upper-case host',
      (w: World) => ({
        aud: [mcpAudienceOfIssuer(w.issuer).replace('id.example.com', 'ID.EXAMPLE.COM')],
      }),
    ],
    ['no audience at all', () => ({ aud: undefined })],
    ['an issuer form the tenant does not use', () => ({ iss: 'https://login.acme.example' })],
    ['an expired life', () => ({ exp: Math.floor(Date.now() / 1000) - 5 })],
    ['no expiry', () => ({ exp: undefined })],
  ])('is refused when it carries %s', async (_l, claims) => {
    const w = await world();
    await refused(w, await sign(w, claims(w)));
  });

  it('is refused when it is typed as anything but an access token', async () => {
    const w = await world();
    await refused(w, await sign(w, {}, { typ: 'JWT' }));
    await refused(w, await sign(w, {}, { typ: 'id_token' }));
  });

  it('is refused when it is signed by no key of the tenant, or not signed at all', async () => {
    const w = await world();
    const other = await world();
    await refused(w, await sign(w, {}, { signer: other }));
    const none = [
      Buffer.from('{"alg":"none","typ":"at+jwt"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          iss: w.issuer,
          sub: w.subjectId,
          aud: [mcpAudienceOfIssuer(w.issuer)],
          exp: 9999999999,
        }),
      ).toString('base64url'),
      '',
    ].join('.');
    await refused(w, none);
    await refused(w, 'not-a-token');
    await refused(w, 'a.b.c');
  });

  it('is refused at another tenant, and the genuine one is recorded where it was presented', async () => {
    const mine = await world();
    const theirs = await world();
    const token = await sign(theirs);
    await refused(mine, token);
    const rows = await auditRows(mine, 'token.foreign_issuer');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'refused',
      actorTenantId: theirs.tenantId,
      actorSubjectId: theirs.subjectId,
      detail: { reason: 'foreign_issuer' },
    });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('is refused when its subject is not the owner of the grant it names', async () => {
    const w = await world();
    const stranger = await withTenant(appDb.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' }),
    );
    await refused(w, await sign(w, { sub: stranger.id }));
    expect(sub(w)).not.toBe(stranger.id);
  });

  it('is answered 403 insufficient_scope when it holds no MCP scope, and the refusal is recorded', async () => {
    const w = await world();
    const res = await send(w, {
      token: await sign(w, { scope: 'openid profile' }),
      ...modern('tools/list'),
    });
    expect(res.status).toBe(403);
    expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(res.headers['www-authenticate']).toContain('scope="mcp:read"');
    const rows = await auditRows(w, 'capability.refused');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      detail: { reason: 'agent_without_mcp_scope' },
    });
  });
});

describe('a token whose grant has ended', () => {
  it.each([
    [
      'a revoked grant',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          tokenGrantRepository(tx).revoke(w.grantId, new Date()),
        ),
    ],
    [
      'an ended session',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          sessionRepository(tx).end(w.sessionId, new Date()),
        ),
    ],
    [
      'a disabled client',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          clientRepository(tx).update(w.agentDbId, { enabled: false }),
        ),
    ],
    [
      'a disabled subject',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          subjectRepository(tx).setEnabled(w.subjectId, false),
        ),
    ],
  ])('is refused after %s, though it was accepted before', async (_l, end) => {
    const w = await world();
    const token = await sign(w);
    expect((await send(w, { token, ...modern('tools/list') })).status).toBe(200);
    await end(w);
    const res = await send(w, { token, ...modern('tools/list') });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('is answered as an unknown tenant once the tenant is disabled', async () => {
    const w = await world();
    const token = await sign(w);
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, w.tenantId));
    const res = await send(w, { token, ...modern('tools/list') });
    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });
});

describe('the host and the origin', () => {
  it('refuses a Host the tenant is not served at, with a valid token', async () => {
    const w = await world();
    const token = await sign(w);
    for (const host of ['evil.example', `${HOST}.evil.example`, '127.0.0.1:3000']) {
      const res = await send(w, {
        token,
        headers: { host, ...modern('tools/list').headers },
        body: modern('tools/list').body,
      });
      expect(res.status, host).toBe(403);
    }
  });

  it('refuses another origin, accepts the tenant’s own and a client that sends none', async () => {
    const w = await world();
    const token = await sign(w);
    const m = modern('tools/list');
    const withOrigin = (origin: string) =>
      send(w, { token, headers: { ...m.headers, origin }, body: m.body });
    expect((await withOrigin('https://evil.example')).status).toBe(403);
    expect((await withOrigin('null')).status).toBe(403);
    expect((await withOrigin(BASE)).status).toBe(200);
    expect((await send(w, { token, headers: m.headers, body: m.body })).status).toBe(200);
  });
});

describe('the protocol', () => {
  it('refuses a 2026-07-28 request whose Mcp-Method is missing or disagrees with the body', async () => {
    const w = await world();
    const token = await sign(w);
    const m = modern('tools/list');
    const missing = await send(w, {
      token,
      headers: { 'mcp-protocol-version': '2026-07-28' },
      body: m.body,
    });
    expect(missing.status).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: -32020 } });
    const mismatch = await send(w, {
      token,
      headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call' },
      body: m.body,
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: { code: -32020 } });
  });

  it('refuses a JSON-RPC batch and a body past the cap, and a body that is not JSON', async () => {
    const w = await world();
    const token = await sign(w);
    const batch = await send(w, {
      token,
      headers: LEGACY,
      body: [legacyCall('whoami'), legacyCall('whoami', {}, 2)],
    });
    expect(batch.status).toBe(400);
    const big = await send(w, {
      token,
      headers: LEGACY,
      body: legacyCall('whoami', { pad: 'x'.repeat(300_000) }),
    });
    expect(big.status).toBe(413);
    const junk = await send(w, { token, headers: LEGACY, raw: '{not json' });
    expect(junk.status).toBe(400);
    const typed = await send(w, {
      token,
      headers: { ...LEGACY, 'content-type': 'text/plain' },
      raw: 'x',
    });
    expect([400, 415]).toContain(typed.status);
  });

  it('discovers the revisions it serves and the tools capability', async () => {
    const w = await world();
    const m = modern('server/discover');
    const res = await send(w, { token: await sign(w), headers: m.headers, body: m.body });
    expect(res.status).toBe(200);
    const result = res.json().result as Record<string, unknown>;
    expect(result.supportedVersions).toContain('2026-07-28');
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result).toMatchObject({ cacheScope: 'private', ttlMs: 60_000 });
  });

  it('lists tools in one stable order, private, for a minute, with schemas that bound their input', async () => {
    const w = await world(EVERY_CAPABILITY);
    const token = await sign(w);
    const m = modern('tools/list');
    const first = await send(w, { token, headers: m.headers, body: m.body });
    const second = await send(w, { token, headers: m.headers, body: m.body });
    const a = first.json().result as {
      tools: { name: string; inputSchema: Record<string, unknown> }[];
    };
    const b = second.json().result as typeof a;
    expect(a.tools.map((t) => t.name)).toEqual(b.tools.map((t) => t.name));
    expect(a.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(a).toMatchObject({ ttlMs: 60_000, cacheScope: 'private' });
    for (const tool of a.tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
    const getClient = a.tools.find((t) => t.name === 'get_client');
    expect(getClient?.inputSchema.properties).toMatchObject({
      id: {
        type: 'string',
        maxLength: 36,
        pattern: expect.stringContaining('0-9a-fA-F') as string,
      },
    });
    expect(a.tools.find((t) => t.name === 'list_clients')?.inputSchema.properties).toMatchObject({
      limit: { maximum: 200, minimum: 1 },
    });
  });

  it('lists to a 2025 client in the same order, without cache fields', async () => {
    const w = await world(EVERY_CAPABILITY);
    const res = await send(w, {
      token: await sign(w),
      headers: LEGACY,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    const result = res.json().result as { tools: { name: string }[] };
    expect(result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(result).not.toHaveProperty('ttlMs');
  });

  it('answers an unknown tool as an error and a bad argument as a refusal the model can read', async () => {
    const w = await world();
    const token = await sign(w);
    const unknown = await send(w, { token, headers: LEGACY, body: legacyCall('drop_database') });
    expect(unknown.json()).toHaveProperty('error');
    const bad = await send(w, {
      token,
      headers: LEGACY,
      body: legacyCall('get_client', { id: 'x', extra: 1 }),
    });
    const result = bad.json().result as {
      isError: boolean;
      structuredContent: { error: { type: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.type).toBe('mcp:invalid_arguments');
  });
});

describe('the SDK’s own client, in both eras', () => {
  async function connect(w: World, token: string, mode: 'legacy' | { pin: string }) {
    const client = new Client({ name: 'int-test', version: '1' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}${mcpUrl(w)}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const url = new URL(input);
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
          headers[key] = value;
        });
        const res = await app.inject({
          method: (init?.method ?? 'GET') as 'POST' | 'GET' | 'DELETE',
          url: url.pathname + url.search,
          headers: { ...headers, host: HOST },
          ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
        });
        const out = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') out.set(key, value);
        }
        return new Response(res.rawPayload, { status: res.statusCode, headers: out });
      },
    });
    await client.connect(transport);
    return client;
  }

  it.each([
    ['2025-11-25 (initialize)', 'legacy'],
    ['2026-07-28', { pin: '2026-07-28' }],
  ] as const)('lists and calls a read tool in %s', async (_label, mode) => {
    const w = await world(EVERY_CAPABILITY);
    const client = await connect(w, await sign(w), mode);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        data: { subjectId: w.subjectId, issuerTenantId: w.tenantId },
      });
    } finally {
      await client.close();
    }
  });
});

describe('what a tool call does', () => {
  it('returns the data and writes one agent.tool_call row naming the tool and its route', async () => {
    const w = await world();
    const token = await sign(w);
    const res = await send(w, { token, headers: LEGACY, body: legacyCall('whoami') });
    const result = res.json().result as {
      isError?: boolean;
      structuredContent: { data: Record<string, unknown> };
    };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data).toMatchObject({ subjectId: w.subjectId });
    const rows = await auditRows(w, 'agent.tool_call');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'admin_access',
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      detail: {
        agent_client: w.agentDbId,
        owner: w.subjectId,
        tool: 'whoami',
        route: 'GET /admin/tenants/:tenant/whoami',
      },
    });
    expect(Object.keys(rows[0]?.detail ?? {}).sort()).toEqual([
      'agent_client',
      'owner',
      'route',
      'tool',
    ]);
  });

  it('records a call that failed, and never what it was called with', async () => {
    const w = await world();
    const secret = '00000000-0000-4000-8000-00000000cafe';
    const res = await send(w, {
      token: await sign(w),
      headers: LEGACY,
      body: legacyCall('get_client', { id: secret }),
    });
    const result = res.json().result as {
      isError: boolean;
      structuredContent: { error: { status: number } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.status).toBe(404);
    const rows = await auditRows(w, 'agent.tool_call');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'failed', detail: { tool: 'get_client' } });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('writes no row for a request that is not a tool call', async () => {
    const w = await world();
    const token = await sign(w);
    await send(w, { token, ...modern('tools/list') });
    await send(w, { token, ...modern('server/discover') });
    expect(await auditRows(w, 'agent.tool_call')).toHaveLength(0);
  });

  it('answers an owner who lost a role with a 403 result on the next call, and records the refusal', async () => {
    const w = await world();
    const token = await sign(w);
    const call = () => send(w, { token, headers: LEGACY, body: legacyCall('list_clients') });
    const before = (await call()).json().result as { isError?: boolean };
    expect(before.isError).toBeFalsy();
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const role = await roleRepository(tx).byName('manage-clients', w.adminDbId);
      if (role === null) throw new Error('no role');
      await tx
        .delete(subjectRoles)
        .where(and(eq(subjectRoles.subjectId, w.subjectId), eq(subjectRoles.roleId, role.id)));
    });
    const after = (await call()).json().result as {
      isError: boolean;
      structuredContent: { error: { status: number } };
    };
    expect(after.isError).toBe(true);
    expect(after.structuredContent.error.status).toBe(403);
    const rows = await auditRows(w, 'agent.tool_call');
    expect(rows.map((r) => r.outcome)).toEqual(['allowed', 'refused']);
    expect(rows[1]?.detail).toMatchObject({ reason: 'missing_capability' });
  });

  it('lists only the tools its owner can use, and still refuses a call to one by name', async () => {
    const w = await world(['view-users']);
    const token = await sign(w);
    const m = modern('tools/list');
    const res = await send(w, { token, headers: m.headers, body: m.body });
    const names = (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain('whoami');
    expect(names).toContain('list_subjects');
    expect(names).toContain('list_roles');
    expect(names).not.toContain('list_clients');
    expect(names).not.toContain('list_audit');
    const named = await send(w, { token, headers: LEGACY, body: legacyCall('list_clients') });
    const result = named.json().result as {
      isError: boolean;
      structuredContent: { error: { status: number } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.status).toBe(403);
  });

  it('keeps two requests at once apart', async () => {
    const [a, b] = await Promise.all([world(CAPS), world(['view-users'])]);
    const [ta, tb] = await Promise.all([sign(a), sign(b)]);
    const calls = await Promise.all(
      Array.from({ length: 6 }, (_v, i) => {
        const w = i % 2 === 0 ? a : b;
        return send(w, {
          token: i % 2 === 0 ? ta : tb,
          headers: LEGACY,
          body: legacyCall('whoami'),
        });
      }),
    );
    calls.forEach((res, i) => {
      const data = (res.json().result as { structuredContent: { data: { subjectId: string } } })
        .structuredContent.data;
      expect(data.subjectId).toBe(i % 2 === 0 ? a.subjectId : b.subjectId);
    });
  });

  it('never sends the presented token to the admin API, only one minted for the call', async () => {
    const w = await world();
    const token = await sign(w);
    const before = adminSeen.length;
    await send(w, { token, headers: LEGACY, body: legacyCall('whoami') });
    const sent = adminSeen.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.authorization).toBeDefined();
      expect(request.authorization).not.toContain(token);
    }
    const minted = (sent[0]?.authorization ?? '').replace(/^Bearer /u, '');
    const claims = JSON.parse(
      Buffer.from(minted.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(claims.aud).toContain(ADMIN_API_AUDIENCE);
    expect(claims).toMatchObject({
      sub: w.subjectId,
      act: { sub: MCP_CLIENT_ID },
      scope: 'mcp:read',
    });
  });

  it('gives a request an id of its own and records it, never the one the caller wrote', async () => {
    const w = await world();
    const res = await send(w, {
      token: await sign(w),
      headers: { ...LEGACY, 'x-request-id': 'chosen-by-the-caller' },
      body: legacyCall('whoami'),
    });
    expect(res.headers['x-request-id']).not.toBe('chosen-by-the-caller');
    const rows = await auditRows(w, 'agent.tool_call');
    expect(rows[0]?.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('the budget', () => {
  it('answers 429 with Retry-After once a principal has spent it, and not another principal', async () => {
    const w = await world();
    const other = await world();
    const token = await sign(w);
    const m = modern('tools/list');
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await send(w, { on: limitedApp, token, headers: m.headers, body: m.body })).status,
      ).toBe(200);
    }
    const refused = await send(w, { on: limitedApp, token, headers: m.headers, body: m.body });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.json()).toMatchObject({ error: { code: -32029 } });
    expect(
      (
        await send(other, {
          on: limitedApp,
          token: await sign(other),
          headers: m.headers,
          body: m.body,
        })
      ).status,
    ).toBe(200);
  });
});

describe('a tenant on its own domain', () => {
  async function withDomain() {
    const w = await world(CAPS);
    const host = `d${w.name.slice(-8)}.domain-tests.net`;
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const row = await domains.insert({ tenantId: w.tenantId, host, challenge: 'c' });
      await domains.markVerified(w.tenantId, row.id, new Date());
      await domains.setCanonical(w.tenantId, row.id);
    });
    const issuer = addressIssuer(domainAddress(host, true));
    return { w, host, issuer, resource: mcpAudienceOfIssuer(issuer) };
  }

  it('serves the endpoint at /mcp on the domain, for a token issued there, and nowhere else', async () => {
    const { w, host, issuer, resource } = await withDomain();
    const token = await sign(w, { iss: issuer, aud: [resource] });
    const m = modern('tools/list');
    const atDomain = await send(w, {
      url: '/mcp',
      token,
      headers: { ...m.headers, host },
      body: m.body,
    });
    expect(atDomain.status).toBe(200);

    const call = await send(w, {
      url: '/mcp',
      token,
      headers: { ...LEGACY, host },
      body: legacyCall('whoami'),
    });
    expect(call.json().result).toMatchObject({
      structuredContent: { data: { subjectId: w.subjectId } },
    });

    const challenge = await send(w, { url: '/mcp', headers: { host } });
    expect(challenge.status).toBe(401);
    expect(challenge.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`,
    );

    const atPath = await send(w, { token, headers: m.headers, body: m.body });
    expect(atPath.status).toBe(404);
  });

  it('refuses a token issued at the address the tenant left, and one made for the other form', async () => {
    const { w, host, issuer, resource } = await withDomain();
    const m = modern('tools/list');
    const atDomain = (token: string) =>
      send(w, { url: '/mcp', token, headers: { ...m.headers, host }, body: m.body });
    expect((await atDomain(await sign(w))).status).toBe(401);
    expect((await atDomain(await sign(w, { iss: issuer }))).status).toBe(401);
    expect((await atDomain(await sign(w, { aud: [resource] }))).status).toBe(401);
  });

  it('refuses a token of another tenant presented at this tenant’s domain, and records it', async () => {
    const one = await withDomain();
    const two = await withDomain();
    const token = await sign(one.w, { iss: one.issuer, aud: [one.resource] });
    const m = modern('tools/list');
    const res = await send(one.w, {
      url: '/mcp',
      token,
      headers: { ...m.headers, host: two.host },
      body: m.body,
    });
    expect(res.status).toBe(401);
    const rows = await auditRows(two.w, 'token.foreign_issuer');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorTenantId: one.w.tenantId });
  });
});

describe('before anything is looked up', () => {
  it('answers 429 to a burst of garbage tokens from one origin without reading the tenant', async () => {
    const w = await world();
    const m = modern('tools/list');
    const garbage = () =>
      send(w, { on: throttledApp, token: 'garbage', headers: m.headers, body: m.body });
    const before = addressingReads;
    for (let i = 0; i < 3; i += 1) expect((await garbage()).status).toBe(401);
    expect(addressingReads - before).toBe(3);
    const refused = await garbage();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(addressingReads - before).toBe(3);
  });
});

describe('a tenant name that is not one', () => {
  it.each([
    ['a NUL', 'a%00b'],
    ['a name far too long', 'a'.repeat(5000)],
    ['bytes that are not UTF-8', '%ff%fe'],
    ['an encoded slash', 'a%2Fb'],
    ['a lone encoded surrogate', '%ED%A0%80'],
  ])('with %s is an unknown tenant, never a server error', async (_l, name) => {
    const w = await world();
    const res = await send(w, {
      url: `/tenants/${name}/mcp`,
      token: await sign(w),
      ...modern('tools/list'),
    });
    expect([400, 404, 414]).toContain(res.status);
  });
});

describe('a token minted by the real flow', () => {
  const PASSWORD = 'correct horse battery staple';
  const MCP_REDIRECT = 'http://127.0.0.1:8080/callback';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  async function mcpTenant() {
    const name = `real-${newId()}`;
    const username = `u${newId().slice(-10)}`;
    const seeded = await seed({
      tenant: name,
      clientId: 'portal',
      redirectUris: ['https://app.example/callback'],
      username,
      password: PASSWORD,
    });
    const subjectId = seeded.userSubjectId;
    if (subjectId === undefined) throw new Error('no user');
    await withTenant(appDb.db, seeded.tenantId, async (tx) => {
      const admin = await clientRepository(tx).byClientId('odudu-admin');
      if (admin === null) throw new Error('no admin client');
      const role = await roleRepository(tx).byName('view-users', admin.id);
      if (role === null) throw new Error('no role');
      await roleRepository(tx).assignToSubject(subjectId, role.id);
    });
    await owner.db
      .update(tenants)
      .set({ clientRegistrationPolicy: 'mcp' })
      .where(eq(tenants.id, seeded.tenantId));
    const issuer = `${BASE}/tenants/${name}`;
    return {
      name,
      username,
      tenantId: seeded.tenantId,
      subjectId,
      issuer,
      resource: mcpAudienceOfIssuer(issuer),
    };
  }

  type Real = Awaited<ReturnType<typeof mcpTenant>>;

  async function register(t: Real, scope: string, grants: string[] = ['authorization_code']) {
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/clients-registrations/openid-connect`,
      headers: { host: HOST },
      payload: {
        client_name: 'Real flow agent',
        redirect_uris: [MCP_REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: grants,
        scope,
        audience: t.resource,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ client_id: string }>().client_id;
  }

  function jarOf(jar: Map<string, string>, res: { headers: Record<string, unknown> }): void {
    const raw = res.headers['set-cookie'];
    const lines: string[] = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : typeof raw === 'string'
        ? [raw]
        : [];
    for (const line of lines) {
      const [pair] = line.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (pair === undefined || eq < 0) continue;
      const value = pair.slice(eq + 1);
      if (value === '') jar.delete(pair.slice(0, eq));
      else jar.set(pair.slice(0, eq), value);
    }
  }

  const cookieHeader = (jar: Map<string, string>) =>
    [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  function sessionField(html: string): string {
    const found = /name="auth_session_id" value="([^"]*)"/u.exec(html)?.[1];
    if (found === undefined) throw new Error(`no auth_session_id in ${html.slice(0, 200)}`);
    return found;
  }

  async function authorize(
    t: Real,
    clientId: string,
    params: { scope: string; resource?: string; redirect?: string },
  ) {
    const jar = new Map<string, string>();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: params.redirect ?? MCP_REDIRECT,
      scope: params.scope,
      state: 's',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      ...(params.resource === undefined ? {} : { resource: params.resource }),
    });
    const page = await app.inject({
      method: 'GET',
      url: `/tenants/${t.name}/protocol/openid-connect/auth?${query.toString()}`,
      headers: { host: HOST },
    });
    jarOf(jar, page);
    return { page, jar };
  }

  async function signInAndConsent(
    t: Real,
    page: { body: string },
    jar: Map<string, string>,
    consent: boolean,
  ) {
    const form = { 'content-type': 'application/x-www-form-urlencoded', host: HOST };
    const login = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/login-actions/authenticate`,
      headers: { ...form, cookie: cookieHeader(jar) },
      payload: new URLSearchParams({
        auth_session_id: sessionField(page.body),
        username: t.username,
        password: PASSWORD,
      }).toString(),
    });
    jarOf(jar, login);
    // A client that needs no consent is sent straight back with its code.
    if (!consent || login.statusCode === 302) return login;
    const allowed = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/login-actions/consent`,
      headers: { ...form, cookie: cookieHeader(jar) },
      payload: new URLSearchParams({
        auth_session_id: sessionField(login.body),
        ...(login.body.includes('value="mcp:read"') ? { scope: 'mcp:read' } : {}),
        decision: 'allow',
      }).toString(),
    });
    jarOf(jar, allowed);
    return allowed;
  }

  function codeOf(res: {
    statusCode: number;
    headers: Record<string, unknown>;
    body: string;
  }): string {
    const location = res.headers.location;
    const code = typeof location === 'string' ? new URL(location).searchParams.get('code') : null;
    if (code === null)
      throw new Error(`no code: ${String(res.statusCode)} ${res.body.slice(0, 200)}`);
    return code;
  }

  async function tokens(
    t: Real,
    clientId: string,
    code: string,
    resource?: string,
    redirect = MCP_REDIRECT,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: HOST },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        client_id: clientId,
        code_verifier: VERIFIER,
        ...(resource === undefined ? {} : { resource }),
      }).toString(),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ access_token: string; refresh_token?: string }>();
  }

  async function atEndpoint(t: Real, token: string, body: ReturnType<typeof modern>) {
    return send({ name: t.name } as World, { token, headers: body.headers, body: body.body });
  }

  it('lists the tools and calls whoami for the person who signed in', async () => {
    const t = await mcpTenant();
    const clientId = await register(t, 'openid mcp:read');
    const { page, jar } = await authorize(t, clientId, {
      scope: 'openid mcp:read',
      resource: t.resource,
    });
    expect(page.statusCode).toBe(200);
    const done = await signInAndConsent(t, page, jar, true);
    const issued = await tokens(t, clientId, codeOf(done), t.resource);

    const claims = JSON.parse(
      Buffer.from(issued.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      aud: string[];
      scope: string;
    };
    expect(claims.aud).toContain(t.resource);
    expect(claims.scope).toContain('mcp:read');

    const list = modern('tools/list');
    const listed = await atEndpoint(t, issued.access_token, list);
    expect(listed.status).toBe(200);
    const names = (listed.json().result as { tools: { name: string }[] }).tools.map((x) => x.name);
    expect(names).toContain('whoami');
    expect(names).toContain('list_subjects');
    expect(names).not.toContain('list_audit');

    const call = await send({ name: t.name } as World, {
      token: issued.access_token,
      headers: LEGACY,
      body: legacyCall('whoami'),
    });
    expect(call.json().result).toMatchObject({
      structuredContent: { data: { subjectId: t.subjectId, issuerTenantId: t.tenantId } },
    });
  });

  it('answers 403 for a token of the right audience that holds no MCP scope', async () => {
    const t = await mcpTenant();
    const clientId = await register(t, 'openid mcp:read');
    const { page, jar } = await authorize(t, clientId, { scope: 'openid' });
    const done = await signInAndConsent(t, page, jar, true);
    const issued = await tokens(t, clientId, codeOf(done));
    const res = await atEndpoint(t, issued.access_token, modern('tools/list'));
    expect(res.status).toBe(403);
    expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
  });

  it('refuses a token of an ordinary client, whose audience is the issuer alone', async () => {
    const t = await mcpTenant();
    const redirect = 'https://app.example/callback';
    const { page, jar } = await authorize(t, 'portal', { scope: 'openid', redirect });
    const done = await signInAndConsent(t, page, jar, true);
    const issued = await tokens(t, 'portal', codeOf(done), undefined, redirect);
    const claims = JSON.parse(
      Buffer.from(issued.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { aud: string[] };
    expect(claims.aud).toEqual([t.issuer]);
    const res = await atEndpoint(t, issued.access_token, modern('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('cannot be had by the built-in client, whose audience is the admin API', async () => {
    const t = await mcpTenant();
    const { page } = await authorize(t, 'odudu-mcp', {
      scope: 'openid mcp:read',
      resource: t.resource,
      redirect: 'http://127.0.0.1:8080',
    });
    expect(page.statusCode === 200 && page.body.includes('auth_session_id')).toBe(false);
  });

  it('loses the audience at refresh once the tenant ends the policy', async () => {
    const t = await mcpTenant();
    const clientId = await register(t, 'openid offline_access mcp:read', [
      'authorization_code',
      'refresh_token',
    ]);
    const { page, jar } = await authorize(t, clientId, {
      scope: 'openid offline_access mcp:read',
      resource: t.resource,
    });
    const done = await signInAndConsent(t, page, jar, true);
    const issued = await tokens(t, clientId, codeOf(done), t.resource);
    expect(issued.refresh_token).toBeDefined();
    expect((await atEndpoint(t, issued.access_token, modern('tools/list'))).status).toBe(200);

    await owner.db
      .update(tenants)
      .set({ clientRegistrationPolicy: 'disabled' })
      .where(eq(tenants.id, t.tenantId));
    const refreshed = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: HOST },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: issued.refresh_token ?? '',
        client_id: clientId,
      }).toString(),
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const next = refreshed.json<{ access_token: string }>().access_token;
    const claims = JSON.parse(
      Buffer.from(next.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      aud: string[];
      scope: string;
    };
    expect(claims.aud).not.toContain(t.resource);
    expect(claims.scope).not.toContain('mcp:read');
    expect((await atEndpoint(t, next, modern('tools/list'))).status).toBe(401);
  });
});
