import http from 'node:http';
import { mcpAudienceOfIssuer } from '@odudu/kernel';
import {
  configureIssuerBase,
  configureTenantAddress,
  type TenantLookup,
} from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createToolLimiter,
  DEFAULT_TOOL_LIMITS,
  type ToolLimiterOptions,
} from '#/service/rate-limit';
import { MCP_BODY_LIMIT_BYTES, registerMcpRoute, type McpRouteDeps } from '#/view/routes/mcp';
import type { McpExchange } from '#/service/endpoint';

const BASE = 'https://id.example.com';
const ISSUER = `${BASE}/tenants/acme`;
const PRM = `${BASE}/.well-known/oauth-protected-resource/tenants/acme/mcp`;
const LIFESPANS = {
  ssoSessionMaxSeconds: 1,
  ssoSessionIdleSeconds: 1,
  rememberMeIdleSeconds: 1,
  rememberMeMaxSeconds: 1,
};
const TENANT: TenantLookup = {
  id: '0194f0a0-0000-7000-8000-000000000001',
  enabled: true,
  ...LIFESPANS,
  verifyEmail: false,
  rememberMeAllowed: false,
  loginWithEmail: false,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  maxSessionsPerBrowser: 5,
  clientRegistrationPolicy: 'disabled',
  cimdEnabled: false,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordRules: {
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
  },
};

interface World {
  app: FastifyInstance;
  served: { requestId: string; ip: string }[];
  recorded: string[];
  logged: string[];
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

function build(
  over: {
    auth?: 'valid' | 'missing' | 'scope' | 'foreign';
    tenant?: TenantLookup | null;
    serve?: McpExchange['serve'];
    limits?: Partial<ToolLimiterOptions>;
    configured?: boolean;
    logs?: string[];
  } = {},
): World {
  const configured = over.configured ?? true;
  const app = Fastify({
    trustProxy: false,
    ...(over.logs === undefined
      ? {}
      : { logger: { level: 'info', stream: { write: (line: string) => over.logs?.push(line) } } }),
  });
  apps.push(app);
  if (configured) configureIssuerBase(app, BASE);
  configureTenantAddress(app);
  const served: World['served'] = [];
  const recorded: string[] = [];
  const logged: string[] = [];
  const mode = over.auth ?? 'valid';
  const deps = {
    auth: {
      findTenant: () => Promise.resolve(over.tenant === undefined ? TENANT : over.tenant),
      acceptedIssuers: () => Promise.resolve([ISSUER]),
      listPublishableKeys: () => Promise.resolve([]),
      loadGrant: () =>
        Promise.resolve({
          id: 'grant-1',
          tenantId: TENANT.id,
          clientId: 'client-db',
          subjectId: 'subject-1',
          scope: 'mcp:read',
          audience: [mcpAudienceOfIssuer(ISSUER)],
          createdAt: new Date(0),
          revokedAt: null,
          sessionId: 'session-1',
          actorSubjectId: null,
          exchangedFromGrantId: null,
          actChain: null,
          expCeiling: null,
          requestedUserinfoClaims: null,
        }),
      isSessionLive: () => Promise.resolve(true),
      loadClientState: () =>
        Promise.resolve({ enabled: true, builtinMcp: true, builtinAdmin: false }),
      isSubjectEnabled: () => Promise.resolve(true),
      tenantNameAtHost: () => Promise.resolve(null),
      verifyAccessToken: () =>
        Promise.resolve(
          mode === 'valid' || mode === 'scope'
            ? {
                iss: ISSUER,
                aud: [mcpAudienceOfIssuer(ISSUER)],
                sub: 'subject-1',
                client_id: 'odudu-mcp',
                grant_id: 'grant-1',
                sid: 'session-1',
                scope: mode === 'scope' ? 'openid' : 'mcp:read',
                exp: Math.floor(Date.now() / 1000) + 600,
              }
            : null,
        ),
    },
    adminAudience: 'urn:odudu:admin-api',
    addressConfigured: configured,
    limiter: createToolLimiter({ ...DEFAULT_TOOL_LIMITS, ...over.limits }),
    audit: {
      foreignIssuer: () => {
        recorded.push('foreign');
        return Promise.resolve();
      },
      agentWithoutScope: () => {
        recorded.push('scope');
        return Promise.resolve();
      },
    },
    open: (_principal, info) => {
      served.push(info);
      return {
        serve:
          over.serve ??
          ((_req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end('{"jsonrpc":"2.0","id":1,"result":{}}');
            return Promise.resolve();
          }),
      };
    },
    now: () => new Date(),
    logger: {
      debug: () => undefined,
      warn: (_c: Record<string, unknown>, m: string) => logged.push(m),
      error: (_c: Record<string, unknown>, m: string) => logged.push(m),
    },
  } satisfies McpRouteDeps;
  registerMcpRoute(app, deps);
  return { app, served, recorded, logged };
}

// Only its `iss` is read before the (faked) signature check.
const TOKEN = [
  Buffer.from('{"alg":"ES256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ iss: ISSUER })).toString('base64url'),
  'c2ln',
].join('.');

const JSONRPC = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function post(
  w: World,
  over: { headers?: Record<string, string>; payload?: unknown; url?: string } = {},
) {
  return w.app.inject({
    method: 'POST',
    url: over.url ?? '/tenants/acme/mcp',
    headers: {
      host: 'id.example.com',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...over.headers,
    },
    payload: JSON.stringify(over.payload ?? JSONRPC),
  });
}

describe('the answers before a token is read', () => {
  it('refuses a Host the tenant is not served at, whatever else the request holds', async () => {
    const w = build();
    for (const host of [
      'evil.example',
      'id.example.com.evil.example',
      'id.example.com@evil.example',
    ]) {
      const res = await post(w, { headers: { host } });
      expect(res.statusCode, host).toBe(403);
    }
    expect(w.served).toHaveLength(0);
  });

  it('refuses a browser Origin that is not the tenant’s own, and lets none through', async () => {
    const w = build();
    expect((await post(w, { headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await post(w, { headers: { origin: 'null' } })).statusCode).toBe(403);
    expect((await post(w, { headers: { origin: BASE } })).statusCode).toBe(200);
    expect((await post(w)).statusCode).toBe(200);
  });

  it('answers 405 with Allow: POST to GET and DELETE, without asking who is asking', async () => {
    const w = build({ auth: 'missing' });
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await w.app.inject({
        method,
        url: '/tenants/acme/mcp',
        headers: { host: 'id.example.com' },
      });
      expect(res.statusCode, method).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });

  it('answers an unknown and a disabled tenant with the same bare 404', async () => {
    const unknown = await post(build({ tenant: null }));
    const disabled = await post(build({ tenant: { ...TENANT, enabled: false } }));
    expect(unknown.statusCode).toBe(404);
    expect(disabled.statusCode).toBe(404);
    expect(disabled.payload).toBe(unknown.payload);
    expect(unknown.payload).toBe('');
    const strip = (h: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'date' && k !== 'x-request-id'));
    expect(strip(disabled.headers)).toEqual(strip(unknown.headers));
  });
});

describe('the challenge', () => {
  it('is Bearer with the metadata URL and the scope, and an empty body, for no token', async () => {
    const res = await post(build({ auth: 'missing' }), { headers: { authorization: '' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${PRM}", scope="mcp:read"`,
    );
    expect(res.payload).toBe('');
  });

  it('adds error="invalid_token" for a token that does not verify, and never echoes it', async () => {
    const res = await post(build({ auth: 'foreign' }), {
      headers: {
        authorization:
          'Bearer eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lkLmV4YW1wbGUuY29tL3RlbmFudHMvYWNtZSJ9.c2ln',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer error="invalid_token", resource_metadata="${PRM}", scope="mcp:read"`,
    );
    expect(JSON.stringify(res.headers) + res.payload).not.toContain('c2ln');
  });

  it('is 403 insufficient_scope for a valid token without an MCP scope, and records it', async () => {
    const w = build({ auth: 'scope' });
    const res = await post(w);
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer error="insufficient_scope", scope="mcp:read", resource_metadata="${PRM}"`,
    );
    expect(w.recorded).toEqual(['scope']);
  });

  it('reads a token from the Authorization header alone', async () => {
    const w = build({ auth: 'missing' });
    const url = `/tenants/acme/mcp?access_token=${TOKEN}`;
    const res = await w.app.inject({
      method: 'POST',
      url,
      headers: {
        host: 'id.example.com',
        'content-type': 'application/json',
        cookie: `access_token=${TOKEN}`,
      },
      payload: JSON.stringify({ ...JSONRPC, access_token: TOKEN }),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('the budget', () => {
  it('answers 429 with Retry-After and a JSON-RPC error once the principal has spent it', async () => {
    const w = build({ limits: { perPrincipal: { limit: 2, windowSeconds: 60 } } });
    expect((await post(w)).statusCode).toBe(200);
    expect((await post(w)).statusCode).toBe(200);
    const res = await post(w);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32029 } });
    expect(w.served).toHaveLength(2);
  });

  it('refuses a request while the principal has the most in flight, and frees the slot at the end', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = build({
      limits: { maxConcurrentPerPrincipal: 1 },
      serve: async (_req, res) => {
        await gate;
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      },
    });
    const first = post(w);
    await new Promise((r) => setTimeout(r, 20));
    expect((await post(w)).statusCode).toBe(429);
    release();
    expect((await first).statusCode).toBe(200);
    expect((await post(w)).statusCode).toBe(200);
  });

  it('frees the slot of a request whose body is refused before it is served', async () => {
    const w = build({ limits: { maxConcurrentPerPrincipal: 1 } });
    for (let i = 0; i < 3; i += 1) {
      const res = await post(w, { payload: { pad: 'x'.repeat(MCP_BODY_LIMIT_BYTES + 1) } });
      expect(res.statusCode).toBe(413);
    }
    expect((await post(w)).statusCode).toBe(200);
  });
});

describe('what is served', () => {
  it('refuses a JSON-RPC batch, which would spend many requests of the budget in one', async () => {
    const w = build();
    const res = await post(w, { payload: [JSONRPC, JSONRPC] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: -32600 } });
    expect(w.served).toHaveLength(0);
  });

  it('gives each request an id of its own, never the one the caller wrote', async () => {
    const w = build();
    const a = await post(w, { headers: { 'x-request-id': 'attacker-chosen' } });
    const b = await post(w);
    expect(w.served[0]?.requestId).not.toBe('attacker-chosen');
    expect(w.served[0]?.requestId).not.toBe(w.served[1]?.requestId);
    expect(a.headers['x-request-id']).toBe(w.served[0]?.requestId);
    expect(b.headers['x-request-id']).toBe(w.served[1]?.requestId);
  });

  it('answers an internal failure with a correlation id and nothing of the error', async () => {
    const w = build({
      serve: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.4 password=hunter2')),
    });
    const res = await post(w);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: { code: -32603, data: { correlation_id: w.served[0]?.requestId } },
    });
    expect(res.payload).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.4/u);
    expect(w.logged).toContain('mcp request failed');
  });
});

describe('with no configured address', () => {
  it('refuses a Host and Origin that name only each other, and takes a loopback one', async () => {
    const w = build({ configured: false });
    const evil = await post(w, {
      headers: { host: 'evil.example', origin: 'http://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    const refusedHost = await post(build({ configured: true }), {
      headers: { host: 'evil.example' },
    });
    expect(evil.payload).toBe(refusedHost.payload);
    expect(w.served).toHaveLength(0);
    const local = build({ configured: false });
    expect((await post(local, { headers: { host: 'localhost:3000' } })).statusCode).toBe(200);
  });
});

describe('odd forms of the request', () => {
  it.each([
    ['a bare scheme', 'Bearer'],
    ['a scheme and spaces', 'Bearer   '],
    ['another scheme', 'Token abc'],
    ['basic', 'Basic dXNlcjpwYXNz'],
  ])('with %s is no token', async (_l, authorization) => {
    const res = await post(build({ auth: 'missing' }), { headers: { authorization } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${PRM}", scope="mcp:read"`,
    );
  });

  it.each([`bearer ${TOKEN}`, `BEARER   ${TOKEN}`, `Bearer\t${TOKEN}`])(
    'reads the token after %j however the scheme is spelled',
    async (authorization) => {
      expect((await post(build(), { headers: { authorization } })).statusCode).toBe(200);
    },
  );

  it('takes the first of two Authorization headers, as the server keeps one', async () => {
    const w = build();
    await w.app.listen({ port: 0, host: '127.0.0.1' });
    const address = w.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          port,
          host: '127.0.0.1',
          method: 'POST',
          path: '/tenants/acme/mcp',
          headers: { host: 'id.example.com', 'content-type': 'application/json' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.setHeader('authorization', [`Bearer ${TOKEN}`, 'Bearer other']);
      req.end(JSON.stringify(JSONRPC));
    });
    expect(status).toBe(200);
  });

  it.each([
    ['a port', 'https://id.example.com:8443', 403],
    ['the default port', 'https://id.example.com:443', 200],
    ['capitals', 'HTTPS://ID.EXAMPLE.COM', 200],
    ['null', 'null', 403],
    ['a path', 'https://id.example.com/x', 403],
    ['another scheme', 'http://id.example.com', 403],
  ])('treats an Origin with %s', async (_l, origin, status) => {
    expect((await post(build(), { headers: { origin } })).statusCode).toBe(status);
  });

  it('accepts a Host written with a trailing dot', async () => {
    expect((await post(build(), { headers: { host: 'id.example.com.' } })).statusCode).toBe(200);
  });
});

describe('the log', () => {
  it('records a served request, which a hijacked reply would otherwise leave out', async () => {
    const logs: string[] = [];
    const w = build({ logs });
    await post(w);
    expect(
      logs.some((l) => l.includes('request completed') && l.includes('"statusCode":200')),
    ).toBe(true);
  });
});
