import type { UserRecord } from '@odudu/domain-identity';
import { addressIssuer, meAudienceOfIssuer, pathAddress } from '@odudu/kernel';
import { configureIssuerBase, configureTenantAddress } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LIMIT } from '@odudu/contracts/me';
import { ME_ROUTES, registerMeRoutes, type MeDeps } from '#/view/routes';

type MeReads = MeDeps['reads'];

const BASE = 'https://id.example.com';
const ISSUER = addressIssuer(pathAddress(BASE, 'acme'));
const AT = new Date('2026-01-01T00:00:00Z');
const ID = '01a0a992-4657-7d89-8fbf-3385f54810d1';
const TOKEN = [
  Buffer.from('{"alg":"ES256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ iss: ISSUER })).toString('base64url'),
  'c2ln',
].join('.');

let apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

const LIFESPANS = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

const USER = {
  subjectId: 'subject-1',
  username: 'ada',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada',
  phoneNumberVerified: false,
  profileUpdatedAt: AT,
} as UserRecord;

function build(over: { scope?: string; reads?: Partial<MeReads>; seen?: string[] } = {}) {
  const app = Fastify();
  apps.push(app);
  configureIssuerBase(app, BASE);
  configureTenantAddress(app);
  const note = (what: string) => over.seen?.push(what);
  const reads: MeReads = {
    profile: (t, s) => {
      note(`profile ${t} ${s}`);
      return Promise.resolve(USER);
    },
    credentials: (t, s, page) => {
      note(`credentials ${t} ${s} ${String(page.limit)}`);
      return Promise.resolve({
        rows: [{ id: ID, type: 'totp', label: 'Phone', createdAt: AT, lastUsedAt: null }],
        recoveryCodesLeft: 7,
      });
    },
    sessions: (t, s, _l, _n, page) => {
      note(`sessions ${t} ${s} ${String(page.limit)}`);
      return Promise.resolve([
        { id: ID, createdAt: AT, lastActiveAt: AT, expiresAt: AT, remembered: false },
      ]);
    },
    consents: (t, s, page) => {
      note(`consents ${t} ${s} ${String(page.limit)}`);
      return Promise.resolve([
        { clientId: 'row', clientKey: 'portal', scopeNames: ['openid'], grantedAt: AT },
      ]);
    },
    ...over.reads,
  };
  const deps: MeDeps = {
    acceptedIssuers: () => Promise.resolve([ISSUER]),
    verifyAccessToken: () =>
      Promise.resolve({
        iss: ISSUER,
        aud: [meAudienceOfIssuer(ISSUER)],
        sub: 'subject-1',
        client_id: 'app',
        sid: ID,
        scope: over.scope ?? 'openid me:read',
      }),
    findTenant: (name) =>
      Promise.resolve(
        name === 'acme' ? { id: 'tenant-1', enabled: true, lifespans: LIFESPANS } : null,
      ),
    reads,
    now: () => new Date('2026-11-11T10:00:00Z'),
    logger: { warn: () => undefined },
  };
  registerMeRoutes(app, deps);
  return app;
}

const get = (app: FastifyInstance, path: string, token: string | null = TOKEN) =>
  app.inject({
    method: 'GET',
    url: `/tenants/acme/me/${path}`,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe('the routes', () => {
  it('are four, all GET, none naming a subject', () => {
    expect(ME_ROUTES.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /tenants/:tenant/me/profile',
      'GET /tenants/:tenant/me/credentials',
      'GET /tenants/:tenant/me/sessions',
      'GET /tenants/:tenant/me/consents',
    ]);
    expect(ME_ROUTES.every((r) => !/subject|:id/u.test(r.url))).toBe(true);
  });

  it('are served by the app', () => {
    const app = build();
    for (const route of ME_ROUTES) {
      expect(app.hasRoute({ method: route.method, url: route.url })).toBe(true);
    }
  });
});

describe('GET /me/profile', () => {
  it('answers with the token’s own profile, uncached', async () => {
    const seen: string[] = [];
    const res = await get(build({ seen }), 'profile');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({
      sub: 'subject-1',
      username: 'ada',
      email: 'ada@example.com',
    });
    expect(seen).toEqual(['profile tenant-1 subject-1']);
  });

  it('refuses any query member with 400, a subject among them', async () => {
    const res = await get(build(), 'profile?subject=other');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('answers 404 for a subject with no profile', async () => {
    const app = build({ reads: { profile: () => Promise.resolve(null) } });
    expect((await get(app, 'profile')).statusCode).toBe(404);
  });
});

describe('the lists', () => {
  it('give {items, next_cursor}', async () => {
    const res = await get(build(), 'sessions');
    expect(res.json()).toEqual({
      items: [
        {
          id: ID,
          created_at: AT.toISOString(),
          last_active_at: AT.toISOString(),
          expires_at: AT.toISOString(),
          remembered: false,
          current: true,
          device: null,
        },
      ],
      next_cursor: null,
    });
  });

  it('carry the recovery codes left beside the credentials', async () => {
    const res = await get(build(), 'credentials');
    expect(res.json()).toEqual({
      items: [
        {
          id: ID,
          type: 'totp',
          label: 'Phone',
          created_at: AT.toISOString(),
          last_used_at: null,
        },
      ],
      next_cursor: null,
      recovery_codes_left: 7,
    });
  });

  it('list the consents by the application’s client_id', async () => {
    const res = await get(build(), 'consents');
    expect(res.json()).toEqual({
      items: [{ client_id: 'portal', scope_names: ['openid'], granted_at: AT.toISOString() }],
      next_cursor: null,
    });
  });

  it('read at most the bound, whatever is asked', async () => {
    const seen: string[] = [];
    await get(build({ seen }), `sessions?limit=${String(MAX_LIMIT + 1000)}`);
    expect(seen).toEqual([`sessions tenant-1 subject-1 ${String(MAX_LIMIT + 1)}`]);
  });

  it.each(['limit=0', 'limit=abc', 'subject=other', 'cursor=%%%'])(
    'refuse the query %s with 400',
    async (query) => {
      const res = await get(build(), `consents?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request' });
    },
  );
});

describe('the door', () => {
  it.each(['profile', 'credentials', 'sessions', 'consents'])(
    'challenges %s with no token',
    async (path) => {
      const res = await get(build(), path, null);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    },
  );

  it.each(['profile', 'credentials', 'sessions', 'consents'])(
    'refuses %s for a token holding me:write alone',
    async (path) => {
      const res = await get(build({ scope: 'openid me:write' }), path);
      expect(res.statusCode).toBe(403);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="insufficient_scope", scope="me:read"',
      );
    },
  );

  it('answers an unknown tenant with an empty 404', async () => {
    const res = await build().inject({
      method: 'GET',
      url: '/tenants/other/me/profile',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.payload).toBe('');
  });
});
