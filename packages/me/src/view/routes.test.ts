import type { CredentialSummary, UserRecord } from '@odudu/domain-identity';
import { addressIssuer, meAudienceOfIssuer, pathAddress } from '@odudu/kernel';
import { configureIssuerBase, configureTenantAddress } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LIMIT } from '@odudu/contracts/me';
import type { MeAuditEvent, MeWriteTx } from '#/index';
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

const CRED_ID = '01a0a992-4657-7d89-8fbf-3385f54810d9';
const OTHER_SESSION = '01a0a992-4657-7d89-8fbf-3385f54810d2';
const SUMMARY: CredentialSummary = {
  id: CRED_ID,
  type: 'totp',
  label: 'Phone',
  createdAt: AT,
  lastUsedAt: null,
};

function build(
  over: {
    scope?: string;
    reads?: Partial<MeReads>;
    seen?: string[];
    claims?: Record<string, unknown>;
    tx?: Partial<MeWriteTx>;
    audits?: MeAuditEvent[];
  } = {},
) {
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
        scope: over.scope ?? 'openid me:read me:write',
        ...over.claims,
      }),
    findTenant: (name) =>
      Promise.resolve(
        name === 'acme' ? { id: 'tenant-1', enabled: true, lifespans: LIFESPANS } : null,
      ),
    reads,
    writes: {
      transact: (tenantId, run) => {
        note(`transact ${tenantId}`);
        const tx: MeWriteTx = {
          lockProfile: () => Promise.resolve(USER),
          updateProfile: (_s, patch) => Promise.resolve({ ...USER, ...patch }),
          setVerification: () => Promise.resolve(USER),
          lockOwnedSession: () => Promise.resolve(true),
          liveSessionIds: () => Promise.resolve([OTHER_SESSION]),
          endSessions: (input) => {
            note(`endSessions ${input.sessionIds.join(',')}`);
            return Promise.resolve();
          },
          revokeConsent: () => Promise.resolve({ scopeNames: ['openid'], grantsRevoked: 1 }),
          renameCredential: (_s, _id, label) => Promise.resolve({ ...SUMMARY, label }),
          audit: (event) => {
            over.audits?.push(event);
            return Promise.resolve();
          },
          ...over.tx,
        };
        return run(tx);
      },
    },
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
  it('are four reads and five writes, none naming a subject', () => {
    expect(ME_ROUTES.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /tenants/:tenant/me/profile',
      'GET /tenants/:tenant/me/credentials',
      'GET /tenants/:tenant/me/sessions',
      'GET /tenants/:tenant/me/consents',
      'PATCH /tenants/:tenant/me/profile',
      'DELETE /tenants/:tenant/me/sessions',
      'DELETE /tenants/:tenant/me/sessions/:id',
      'DELETE /tenants/:tenant/me/consents/:client_id',
      'PATCH /tenants/:tenant/me/credentials/:id',
    ]);
    expect(ME_ROUTES.every((r) => !r.url.includes('subject'))).toBe(true);
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

const send = (
  app: FastifyInstance,
  method: 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
  token: string | null = TOKEN,
) =>
  app.inject({
    method,
    url: `/tenants/acme/me/${path}`,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });

const WRITES: readonly [string, 'PATCH' | 'DELETE', string, object | undefined][] = [
  ['the profile', 'PATCH', 'profile', { name: 'Ada L' }],
  ['all other sessions', 'DELETE', 'sessions', undefined],
  ['one session', 'DELETE', `sessions/${OTHER_SESSION}`, undefined],
  ['a consent', 'DELETE', 'consents/portal', undefined],
  ['a credential', 'PATCH', `credentials/${CRED_ID}`, { label: 'Work phone' }],
];

describe('the door of the writes', () => {
  it.each(WRITES)('challenges a change of %s with no token', async (_l, method, path, body) => {
    const res = await send(build(), method, path, body, null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each(WRITES)(
    'refuses a change of %s on me:read alone, naming me:write',
    async (_l, method, path, body) => {
      const seen: string[] = [];
      const res = await send(build({ scope: 'openid me:read', seen }), method, path, body);
      expect(res.statusCode).toBe(403);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="insufficient_scope", scope="me:write"',
      );
      expect(seen).toEqual([]);
    },
  );

  it.each(WRITES)(
    'refuses a change of %s for an agent token, whatever its scope',
    async (_l, method, path, body) => {
      const seen: string[] = [];
      const audits: MeAuditEvent[] = [];
      const app = build({ claims: { act: { sub: 'agent-1', client_id: 'agent' } }, seen, audits });
      const res = await send(app, method, path, body);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
      expect(res.headers['www-authenticate']).toBeUndefined();
      expect(seen).toEqual([]);
      expect(audits).toEqual([]);
    },
  );

  it.each(WRITES)(
    'lets the same change of %s through for a person',
    async (_l, method, path, body) => {
      const res = await send(build(), method, path, body);
      expect(res.statusCode).toBeLessThan(300);
      expect(res.headers['cache-control']).toBe('no-store');
    },
  );

  it('answers an unknown tenant with an empty 404', async () => {
    const res = await app404();
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });
});

function app404() {
  return build().inject({
    method: 'DELETE',
    url: '/tenants/other/me/sessions',
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

describe('PATCH /me/profile', () => {
  it('answers with the amended profile and files the fields changed', async () => {
    const audits: MeAuditEvent[] = [];
    const res = await send(build({ audits }), 'PATCH', 'profile', { name: 'Ada L' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'subject-1', username: 'ada', name: 'Ada L' });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toEqual({ via: 'me', fields: ['name'] });
  });

  it.each([
    [{ email: 'x@example.com' }],
    [{ username: 'grace' }],
    [{ email_verified: true }],
    [{ phone_number_verified: true }],
    [{}],
    [{ name: 4 }],
  ])('refuses the body %j with 400', async (body) => {
    const res = await send(build(), 'PATCH', 'profile', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses a value of the wrong shape, naming the field', async () => {
    const res = await send(build(), 'PATCH', 'profile', { birthdate: 'soon' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/"error_description":"birthdate: /u);
  });

  it('answers 404 for a subject with no profile', async () => {
    const res = await send(
      build({ tx: { lockProfile: () => Promise.resolve(null) } }),
      'PATCH',
      'profile',
      { name: 'x' },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /me/sessions/:id', () => {
  it('ends another session and says the token’s own stays', async () => {
    const seen: string[] = [];
    const res = await send(build({ seen }), 'DELETE', `sessions/${OTHER_SESSION}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ current_session_ended: false });
    expect(seen).toContain(`endSessions ${OTHER_SESSION}`);
  });

  it('says the token’s session ended when it is the one deleted', async () => {
    const res = await send(build(), 'DELETE', `sessions/${ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ current_session_ended: true });
  });

  it.each([['a session that is not the person’s'], ['an id that is no uuid']])(
    'answers 404 for %s',
    async (kind) => {
      const app = build({ tx: { lockOwnedSession: () => Promise.resolve(false) } });
      const path = kind.startsWith('an id') ? 'sessions/nope' : `sessions/${OTHER_SESSION}`;
      expect((await send(app, 'DELETE', path)).statusCode).toBe(404);
    },
  );
});

describe('DELETE /me/sessions', () => {
  it('ends the others and says how many, and whether more remain', async () => {
    const seen: string[] = [];
    const res = await send(build({ seen }), 'DELETE', 'sessions');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ended: 1, more: false });
    expect(seen).toContain(`endSessions ${OTHER_SESSION}`);
  });
});

describe('DELETE /me/consents/:client_id', () => {
  it('revokes the consent with no body', async () => {
    const res = await send(build(), 'DELETE', 'consents/portal');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('answers 404 where the person gave none', async () => {
    const app = build({ tx: { revokeConsent: () => Promise.resolve(null) } });
    expect((await send(app, 'DELETE', 'consents/portal')).statusCode).toBe(404);
  });
});

describe('PATCH /me/credentials/:id', () => {
  it('answers with the relabelled credential', async () => {
    const res = await send(build(), 'PATCH', `credentials/${CRED_ID}`, { label: 'Work phone' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: CRED_ID,
      type: 'totp',
      label: 'Work phone',
      created_at: AT.toISOString(),
      last_used_at: null,
    });
  });

  it.each([[{ label: '' }], [{ label: 'x'.repeat(101) }], [{ label: 'a', type: 'totp' }], [{}]])(
    'refuses the body %j with 400',
    async (body) => {
      const res = await send(build(), 'PATCH', `credentials/${CRED_ID}`, body);
      expect(res.statusCode).toBe(400);
    },
  );

  it('answers 404 for an authenticator the person does not hold', async () => {
    const app = build({ tx: { renameCredential: () => Promise.resolve(null) } });
    expect((await send(app, 'PATCH', `credentials/${CRED_ID}`, { label: 'x' })).statusCode).toBe(
      404,
    );
  });
});
