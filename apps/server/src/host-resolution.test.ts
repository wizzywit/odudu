import { configureIssuerBase, configureTenantAddress } from '@odudu/protocol-oidc';
import { type HostState } from '@odudu/domain-tenant';
import Fastify, { type FastifyInstance } from 'fastify';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { configureHostResolution } from '#/host-resolution';

const BASE = 'https://id.odudu.example';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';

const LIVE: HostState = {
  kind: 'live',
  route: { tenantId: TENANT_ID, tenantName: 'acme', canonical: true, retiredUntil: null },
};

interface Options {
  states?: Record<string, HostState>;
  trustProxy?: boolean;
  publicBaseUrl?: string | undefined;
}

function build(options: Options = {}) {
  const states = options.states ?? { 'login.acme.com': LIVE };
  const state = vi.fn((host: string): Promise<HostState> => {
    return Promise.resolve(states[host] ?? { kind: 'unknown' });
  });
  const app: FastifyInstance = Fastify({ trustProxy: options.trustProxy ?? false });
  const base = 'publicBaseUrl' in options ? options.publicBaseUrl : BASE;
  configureIssuerBase(app, base);
  configureTenantAddress(app);
  configureHostResolution(app, {
    publicBaseUrl: base,
    trustProxy: options.trustProxy ?? false,
    tls: true,
    state,
  });
  app.get('/tenants/:tenant/ping', (request) => ({
    route: request.routeOptions.url,
    url: request.url,
    tenant: (request.params as { tenant: string }).tenant,
    address: request.tenantAddress,
  }));
  app.get('/tenants/:tenant/.well-known/openid-configuration', () => ({ discovery: true }));
  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/internal/domain-check', () => ({ check: true }));
  app.post('/tenants/:tenant/echo', (request) => ({ body: request.body }));
  return { app, state };
}

const inject = (
  app: FastifyInstance,
  url: string,
  host: string,
  extra: Record<string, string> = {},
) => app.inject({ method: 'GET', url, headers: { host, ...extra } });

describe('a live domain host', () => {
  it('routes a path as the tenant, with the domain as its address', async () => {
    const { app } = build();
    const res = await inject(app, '/ping?x=1', 'login.acme.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      route: '/tenants/:tenant/ping',
      url: '/tenants/acme/ping?x=1',
      tenant: 'acme',
      address: { origin: 'https://login.acme.com', prefix: '' },
    });
  });

  it('routes the discovery document at the well-known path the issuer implies', async () => {
    const { app } = build();
    const res = await inject(app, '/.well-known/openid-configuration', 'login.acme.com');
    expect(res.json()).toEqual({ discovery: true });
  });

  it('delivers a request body through the second routing', async () => {
    const { app } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { host: 'login.acme.com', 'content-type': 'application/json' },
      payload: '{"a":1}',
    });
    expect(res.json()).toEqual({ body: { a: 1 } });
  });

  it('sends a path that names a tenant to where nothing serves it', async () => {
    const { app } = build();
    expect((await inject(app, '/tenants/acme/ping', 'login.acme.com')).statusCode).toBe(404);
    expect((await inject(app, '/admin/tenants/acme', 'login.acme.com')).statusCode).toBe(404);
  });

  it('spells the host as it is stored', async () => {
    const { app } = build();
    const res = await inject(app, '/ping', 'LOGIN.acme.com.:443');
    expect(res.json()).toMatchObject({
      tenant: 'acme',
      address: { origin: 'https://login.acme.com' },
    });
  });
});

describe('a host that is registered and not live', () => {
  const states: Record<string, HostState> = { 'idle.acme.com': { kind: 'not_live' } };

  it.each([
    '/ping',
    '/tenants/acme/ping',
    '/admin/x',
    '/console/',
    '/docs',
    '/.well-known/openid-configuration',
  ])('refuses %s with an empty 404', async (path) => {
    const { app } = build({ states });
    const res = await inject(app, path, 'idle.acme.com');
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });

  it('refuses every path in the same bytes', async () => {
    const { app } = build({ states });
    const [a, b, c] = await Promise.all(
      ['/ping', '/tenants/acme/ping', '/x/y?z=1'].map((p) => inject(app, p, 'idle.acme.com')),
    );
    expect(a?.rawPayload.length).toBe(0);
    expect(b?.headers).toEqual(a?.headers);
    expect(c?.headers).toEqual(a?.headers);
  });
});

describe('a host nobody registered', () => {
  it('is routed as it is today', async () => {
    const { app, state } = build();
    const path = await inject(app, '/tenants/acme/ping', 'other.example.org');
    expect(path.statusCode).toBe(200);
    expect(path.json()).toMatchObject({
      url: '/tenants/acme/ping',
      address: { prefix: '/tenants/acme' },
    });
    expect((await inject(app, '/ping', 'other.example.org')).statusCode).toBe(404);
    expect(state).toHaveBeenCalledTimes(2);
  });
});

describe('what is answered without a lookup', () => {
  it.each([
    ['the base host', '/tenants/acme/ping', 'id.odudu.example'],
    ['the base host with a default port', '/tenants/acme/ping', 'ID.odudu.example:443'],
    ['a health probe by internal name', '/health/live', 'odudu'],
    ['a health probe on a domain host', '/health/live', 'login.acme.com'],
    ['the domain check', '/internal/domain-check', 'login.acme.com'],
    ['an address', '/tenants/acme/ping', '127.0.0.1'],
    ['a host with a port of its own', '/tenants/acme/ping', 'login.acme.com:8443'],
  ])('%s', async (_name, path, host) => {
    const { app, state } = build();
    const res = await inject(app, path, host);
    expect(res.statusCode).toBe(200);
    expect(state).not.toHaveBeenCalled();
  });

  it('is everything when no base URL is configured', async () => {
    const { app, state } = build({ publicBaseUrl: undefined });
    const res = await inject(app, '/ping', 'login.acme.com');
    expect(res.statusCode).toBe(404);
    expect((await inject(app, '/tenants/acme/ping', 'login.acme.com')).statusCode).toBe(200);
    expect(state).not.toHaveBeenCalled();
  });
});

describe('X-Forwarded-Host', () => {
  const forged = { 'x-forwarded-host': 'login.acme.com' };

  it('selects no tenant while the proxy is not trusted', async () => {
    const { app, state } = build({ trustProxy: false });
    const res = await inject(app, '/ping', 'evil.test', forged);
    expect(res.statusCode).toBe(404);
    expect(state).toHaveBeenCalledWith('evil.test');
    expect(state).not.toHaveBeenCalledWith('login.acme.com');
  });

  it('selects the tenant once it is', async () => {
    const { app } = build({ trustProxy: true });
    const res = await inject(app, '/ping', 'evil.test', forged);
    expect(res.json()).toMatchObject({
      tenant: 'acme',
      address: { origin: 'https://login.acme.com' },
    });
  });
});

describe('a lookup that fails', () => {
  it('answers a server error and routes nothing', async () => {
    const { app, state } = build();
    state.mockRejectedValueOnce(new Error('down'));
    const res = await inject(app, '/ping', 'login.acme.com');
    expect(res.statusCode).toBe(500);
  });
});

describe('over a real socket', () => {
  it('routes a live host again with its body and answers on the same connection', async () => {
    const { app } = build();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const call = (path: string, method: string, host: string, body?: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              path,
              method,
              agent,
              headers: {
                host,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
              },
            },
            (res) => {
              let text = '';
              res.on('data', (chunk: Buffer) => (text += chunk.toString()));
              res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: text }); });
            },
          );
          req.on('error', reject);
          req.end(body);
        });
      const posted = await call('/echo', 'POST', 'login.acme.com', '{"a":1}');
      expect(JSON.parse(posted.body)).toEqual({ body: { a: 1 } });
      const next = await call('/ping', 'GET', 'login.acme.com');
      expect(next.status).toBe(200);
      expect((await call('/ping', 'GET', 'nobody.example.org')).status).toBe(404);
      agent.destroy();
    } finally {
      await app.close();
    }
  });
});
