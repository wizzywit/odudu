import { configureIssuerBase, configureTenantAddress } from '@odudu/protocol-oidc';
import { type HostState, type TenantAddressing } from '@odudu/domain-tenant';
import Fastify, { type FastifyInstance } from 'fastify';
import http from 'node:http';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { configureHostResolution } from '#/host-resolution';

const BASE = 'https://id.odudu.example';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';

const LIVE: HostState = {
  kind: 'live',
  route: { tenantId: TENANT_ID, tenantName: 'acme', canonical: true, retiredUntil: null },
};

interface Options {
  addressing?: (tenantName: string, issuer: string) => TenantAddressing | null;
  states?: Record<string, HostState>;
  trustProxy?: boolean;
  publicBaseUrl?: string | undefined;
}

function build(options: Options = {}) {
  const states = options.states ?? { 'login.acme.com': LIVE };
  const state = vi.fn((host: string): Promise<HostState> => {
    return Promise.resolve(states[host] ?? { kind: 'unknown' });
  });
  const answer = options.addressing ?? (() => ({ canonicalHost: null, retiredUntil: null }));
  const addressing = vi.fn((tenantName: string, issuer: string) =>
    Promise.resolve(answer(tenantName, issuer)),
  );
  const app: FastifyInstance = Fastify({ trustProxy: options.trustProxy ?? false });
  const base = 'publicBaseUrl' in options ? options.publicBaseUrl : BASE;
  configureIssuerBase(app, base);
  configureTenantAddress(app);
  configureHostResolution(app, {
    publicBaseUrl: base,
    trustProxy: options.trustProxy ?? false,
    tls: true,
    state,
    addressing,
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
  app.get('/tenants/:tenant/protocol/openid-connect/auth', () => ({ authorize: true }));
  app.get('/tenants/:tenant/protocol/openid-connect/userinfo', () => ({ userinfo: true }));
  return { app, state, addressing };
}

const inject = (
  app: FastifyInstance,
  url: string,
  host: string,
  extra: Record<string, string> = {},
) => app.inject({ method: 'GET', url, headers: { host, ...extra } });

function withoutId(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = { ...headers };
  Reflect.deleteProperty(rest, 'x-request-id');
  return rest;
}

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

  it('names the request in the refusal, so a probe can be correlated', async () => {
    const { app } = build({ states });
    const res = await inject(app, '/ping', 'idle.acme.com');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('[ODUDU-HOST-SELECT-01] refuses every path in the same bytes', async () => {
    const { app } = build({ states });
    const [a, b, c] = await Promise.all(
      ['/ping', '/tenants/acme/ping', '/x/y?z=1'].map((p) => inject(app, p, 'idle.acme.com')),
    );
    expect(a?.rawPayload.length).toBe(0);
    expect(withoutId(b?.headers)).toEqual(withoutId(a?.headers));
    expect(withoutId(c?.headers)).toEqual(withoutId(a?.headers));
  });
});

describe('a host nobody registered', () => {
  it('[ODUDU-HOST-SELECT-01] is routed as it is today', async () => {
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

  it('[ODUDU-HOST-FORWARD-01] selects no tenant while the proxy is not trusted', async () => {
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
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
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
              res.on('end', () => {
                resolve({ status: res.statusCode ?? 0, body: text });
              });
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

describe('targets that try to leave the tenant', () => {
  const listenersBefore = {
    rejection: process.listenerCount('unhandledRejection'),
    exception: process.listenerCount('uncaughtException'),
  };

  it.each(['/../tenants/other/ping', '//ping', '/%2e%2e/tenants/other/ping', '/./ping/../../x'])(
    'keeps %s under the tenant prefix, where no route matches',
    async (path) => {
      const { app } = build();
      const res = await inject(app, path, 'login.acme.com');
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('"tenant":"other"');
    },
  );

  async function listening(app: FastifyInstance): Promise<number> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  it('refuses an absolute-form target on a live host', async () => {
    const { app } = build();
    const port = await listening(app);
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: 'http://other.example.org/tenants/acme/ping',
            headers: { host: 'login.acme.com' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('survives a client that goes away while its host is being looked up', async () => {
    const { app, state } = build();
    let release: (value: HostState) => void = () => undefined;
    state.mockImplementationOnce(
      () =>
        new Promise<HostState>((resolve) => {
          release = resolve;
        }),
    );
    const failures: unknown[] = [];
    const record = (error: unknown) => failures.push(error);
    const port = await listening(app);
    process.on('unhandledRejection', record);
    process.on('uncaughtException', record);
    try {
      const socket = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => socket.on('connect', resolve));
      socket.write('GET /ping HTTP/1.1\r\nhost: login.acme.com\r\n\r\n');
      await vi.waitFor(() => {
        expect(state).toHaveBeenCalledTimes(1);
      });
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      release(LIVE);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(failures).toEqual([]);
      const next = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/ping', headers: { host: 'login.acme.com' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(next).toBe(200);
    } finally {
      process.off('unhandledRejection', record);
      process.off('uncaughtException', record);
      await app.close();
    }
  });

  it('leaves no process listener behind', () => {
    expect(process.listenerCount('unhandledRejection')).toBe(listenersBefore.rejection);
    expect(process.listenerCount('uncaughtException')).toBe(listenersBefore.exception);
  });
});

describe('the previous address of a tenant', () => {
  const FUTURE = new Date('2099-01-01T00:00:00Z');
  const moved = (canonicalHost: string | null, retiredUntil: Date | null) => () => ({
    canonicalHost,
    retiredUntil,
  });
  const PATH = '/tenants/acme';
  const PAGE = { accept: 'text/html' };

  describe('the path address after a switch to a domain', () => {
    it('serves what a token issued there is used at, inside the window', async () => {
      const { app } = build({ addressing: moved('login.acme.com', FUTURE) });
      for (const rest of [
        '/.well-known/openid-configuration',
        '/protocol/openid-connect/userinfo',
      ]) {
        expect((await inject(app, `${PATH}${rest}`, 'id.odudu.example')).statusCode, rest).toBe(
          200,
        );
      }
    });

    it('points at the canonical address instead of authorizing, inside the window', async () => {
      const { app } = build({ addressing: moved('login.acme.com', FUTURE) });
      const res = await inject(
        app,
        `${PATH}/protocol/openid-connect/auth?client_id=a`,
        'id.odudu.example',
        PAGE,
      );
      expect(res.statusCode).toBe(410);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toContain('<h1>This address has moved</h1>');
      expect(res.body).toContain('href="https://login.acme.com"');
    });

    it('asks about the tenant by name and its own path issuer', async () => {
      const { app, addressing } = build({ addressing: moved('login.acme.com', FUTURE) });
      await inject(app, `${PATH}/ping`, 'id.odudu.example');
      expect(addressing).toHaveBeenCalledWith('acme', 'https://id.odudu.example/tenants/acme');
    });

    it('answers the bare 404 on every path once the window is over', async () => {
      const { app } = build({ addressing: moved('login.acme.com', null) });
      const answers = await Promise.all(
        [
          '/.well-known/openid-configuration',
          '/protocol/openid-connect/userinfo',
          '/ping',
          '/x',
        ].map((rest) => inject(app, `${PATH}${rest}`, 'id.odudu.example', PAGE)),
      );
      for (const res of answers) {
        expect(res.statusCode).toBe(404);
        expect(res.body).toBe('');
      }
      expect(withoutId(answers[1]?.headers)).toEqual(withoutId(answers[3]?.headers));
    });

    it('also applies on a host nobody registered, which reaches the same path address', async () => {
      const { app } = build({ addressing: moved('login.acme.com', null) });
      expect((await inject(app, `${PATH}/ping`, 'other.example.org')).statusCode).toBe(404);
    });

    it('reads a percent-encoded tenant segment as the router does', async () => {
      const { app, addressing } = build({ addressing: moved('login.acme.com', null) });
      expect((await inject(app, '/tenants/%61cme/ping', 'id.odudu.example')).statusCode).toBe(404);
      expect(addressing).toHaveBeenCalledWith('acme', 'https://id.odudu.example/tenants/acme');
    });

    it('serves a tenant that is on its path address, and one that does not exist', async () => {
      const onPath = build({ addressing: moved(null, null) });
      expect((await inject(onPath.app, `${PATH}/ping`, 'id.odudu.example')).statusCode).toBe(200);
      const nobody = build({ addressing: () => null });
      expect((await inject(nobody.app, `${PATH}/ping`, 'id.odudu.example')).statusCode).toBe(200);
    });

    it('asks nothing for a path that names no tenant, a probe or an unconfigured base', async () => {
      const { app, addressing } = build({ addressing: moved('login.acme.com', null) });
      await inject(app, '/health/live', 'id.odudu.example');
      await inject(app, '/admin/tenants/acme', 'id.odudu.example');
      await inject(app, '/nope', 'id.odudu.example');
      expect(addressing).not.toHaveBeenCalled();
      const unconfigured = build({ publicBaseUrl: undefined, addressing: moved('x.test', null) });
      await inject(unconfigured.app, `${PATH}/ping`, 'id.odudu.example');
      expect(unconfigured.addressing).not.toHaveBeenCalled();
    });
  });

  describe('a domain the tenant left, inside its window', () => {
    const LEFT: HostState = {
      kind: 'live',
      route: {
        tenantId: TENANT_ID,
        tenantName: 'acme',
        canonical: false,
        retiredUntil: FUTURE,
      },
    };
    const states = { 'old.acme.com': LEFT };

    it('serves what a token issued there is used at', async () => {
      const { app } = build({ states, addressing: moved('login.acme.com', null) });
      const res = await inject(app, '/protocol/openid-connect/userinfo', 'old.acme.com');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userinfo: true });
    });

    it('points at the other domain it moved to', async () => {
      const { app } = build({ states, addressing: moved('login.acme.com', null) });
      const res = await inject(app, '/protocol/openid-connect/auth', 'old.acme.com', PAGE);
      expect(res.statusCode).toBe(410);
      expect(res.body).toContain('href="https://login.acme.com"');
    });

    it('points at the path address when the tenant switched back to it', async () => {
      const { app, addressing } = build({ states, addressing: moved(null, null) });
      const res = await inject(app, '/protocol/openid-connect/auth', 'old.acme.com', PAGE);
      expect(res.statusCode).toBe(410);
      expect(res.body).toContain('href="https://id.odudu.example/tenants/acme"');
      expect(addressing).toHaveBeenCalledWith('acme', 'https://old.acme.com');
    });

    it('does not ask about a domain that is canonical', async () => {
      const { app, addressing } = build();
      await inject(app, '/protocol/openid-connect/auth', 'login.acme.com');
      expect(addressing).not.toHaveBeenCalled();
    });
  });
});
