import type { CredentialSummary, UserRecord } from '@odudu/domain-identity';
import { addressIssuer, meAudienceOfIssuer, pathAddress } from '@odudu/kernel';
import { configureIssuerBase, configureTenantAddress } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LIMIT } from '@odudu/contracts/me';
import type { DelegationAuditEvent, MeAuditEvent, MeWriteTx } from '#/index';
import { REMOVAL_REFUSAL_MESSAGES, UsernameTakenError } from '#/service/errors';
import { ME_ROUTES, isMeRoute, registerMeRoutes, type MeDeps } from '#/view/routes';

type MeReads = MeDeps['reads'];

const BASE = 'https://id.example.com';
const ISSUER = addressIssuer(pathAddress(BASE, 'acme'));
const AT = new Date('2026-01-01T00:00:00Z');
const NOW = new Date('2026-11-11T10:00:00Z');
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
const DELEGATION_ID = '01a0a992-4657-7d89-8fbf-3385f54810da';
const DELEGATION = {
  id: DELEGATION_ID,
  clientKey: 'portal',
  actorClientKey: 'assistant',
  scopeCeiling: 'openid profile',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  createdAt: NOW,
};
const NEW_DELEGATION = {
  client_id: 'portal',
  actor_client_id: 'assistant',
  scope_ceiling: 'openid profile',
  expires_in: 3600,
};
const OTHER_SESSION = '01a0a992-4657-7d89-8fbf-3385f54810d2';
const SUMMARY: CredentialSummary = {
  id: CRED_ID,
  type: 'totp',
  label: 'Phone',
  createdAt: AT,
  lastUsedAt: null,
};

const PASSWORD: CredentialSummary = {
  id: '01a0a992-4657-7d89-8fbf-3385f54810d8',
  type: 'password',
  label: null,
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
    delegationAudits?: DelegationAuditEvent[];
    // When the session behind the token was signed in to; null for one that is gone.
    signedInAt?: Date | null;
    // The authenticators the session behind the token ran.
    authenticators?: readonly string[];
    usernameEditable?: boolean;
    // The origins the token's client allows, and the tenant's union for a preflight.
    origins?: readonly string[];
    // The tenant's origin allowlist cannot be read.
    originsFail?: boolean;
    // Each time the door looks a tenant up.
    door?: string[];
    // Every route the app registers, as `METHOD url`.
    routes?: string[];
  } = {},
) {
  const app = Fastify();
  apps.push(app);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) over.routes?.push(`${method} ${route.url}`);
  });
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
        recoveryCodesHeld: 10,
        recoveryCodeWarnBelow: 8,
      });
    },
    sessions: (t, s, _l, _n, page) => {
      note(`sessions ${t} ${s} ${String(page.limit)}`);
      return Promise.resolve([
        {
          id: ID,
          createdAt: AT,
          lastActiveAt: AT,
          expiresAt: AT,
          remembered: false,
          deviceId: 'a1b2',
        },
      ]);
    },
    consents: (t, s, page) => {
      note(`consents ${t} ${s} ${String(page.limit)}`);
      return Promise.resolve([
        { clientId: 'row', clientKey: 'portal', scopeNames: ['openid'], grantedAt: AT },
      ]);
    },
    delegations: (t, s) => {
      note(`delegations ${t} ${s}`);
      return Promise.resolve([DELEGATION]);
    },
    ...over.reads,
  };
  const deps: MeDeps = {
    subjectEnabled: () => Promise.resolve(true),
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
    findTenant: (name) => {
      over.door?.push(name);
      return Promise.resolve(
        name === 'acme'
          ? {
              id: 'tenant-1',
              enabled: true,
              lifespans: LIFESPANS,
              freshnessSeconds: 300,
              usernameEditable: over.usernameEditable ?? true,
            }
          : null,
      );
    },
    reads,
    sessionAuth: {
      signedInAt: (t, s, sessionId) => {
        note(`signedInAt ${t} ${s} ${sessionId}`);
        return Promise.resolve(
          over.signedInAt === undefined ? new Date(NOW.getTime() - 10_000) : over.signedInAt,
        );
      },
      authenticators: () => Promise.resolve(over.authenticators ?? ['pwd', 'otp']),
    },
    writes: {
      transact: (tenantId, run) => {
        note(`transact ${tenantId}`);
        const tx: MeWriteTx = {
          lockProfile: () => Promise.resolve(USER),
          updateProfile: (_s, patch) => Promise.resolve({ ...USER, ...patch }),
          renameUser: (_s, username) => Promise.resolve({ ...USER, username }),
          setVerification: () => Promise.resolve(USER),
          lockOwnedSession: () => Promise.resolve(true),
          liveSessionIds: () => Promise.resolve([OTHER_SESSION]),
          endSessions: (input) => {
            note(`endSessions ${input.sessionIds.join(',')}`);
            return Promise.resolve();
          },
          revokeConsent: () => Promise.resolve({ scopeNames: ['openid'], grantsRevoked: 1 }),
          renameCredential: (_s, _id, label) => Promise.resolve({ ...SUMMARY, label }),
          credentialOf: () => Promise.resolve(SUMMARY),
          heldCredentials: () => Promise.resolve([PASSWORD, SUMMARY]),
          tenantRequiresSecondFactor: () => Promise.resolve(false),
          deleteCredential: (id) => {
            note(`deleteCredential ${id}`);
            return Promise.resolve();
          },
          afterSecondFactorRemoved: () => Promise.resolve(0),
          noticeOwnChange: () => Promise.resolve('sent'),
          mailIsAvailable: () => Promise.resolve(true),
          mailBudgetAllows: () => true,
          holderOfEmail: () => Promise.resolve(null),
          clearPendingEmail: () => Promise.resolve(),
          setPendingEmail: (_s, email) => {
            note(`setPendingEmail ${email}`);
            return Promise.resolve();
          },
          queueAddressProof: (input) => {
            note(`queueAddressProof ${input.email}`);
            return Promise.resolve();
          },
          delegationClient: (key) =>
            Promise.resolve({ id: `row-${key}`, clientKey: key, enabled: true, agentType: true }),
          createDelegation: (input) => {
            note(
              `createDelegation ${input.subjectId} ${input.actor.clientKey} ${String(input.cap)}`,
            );
            return Promise.resolve(DELEGATION);
          },
          revokeDelegation: (subjectId, id) => {
            note(`revokeDelegation ${subjectId} ${id}`);
            return Promise.resolve(DELEGATION);
          },
          auditDelegation: (event) => {
            over.delegationAudits?.push(event);
            return Promise.resolve();
          },
          audit: (event) => {
            over.audits?.push(event);
            return Promise.resolve();
          },
          ...over.tx,
        };
        return run(tx);
      },
    },
    cors: {
      clientOrigins: (_tenantId, clientId) =>
        Promise.resolve(new Set(clientId === 'app' ? (over.origins ?? []) : [])),
      originAllowed: (_tenantId, origin) =>
        over.originsFail === true
          ? Promise.reject(new Error('allowlist unavailable'))
          : Promise.resolve((over.origins ?? []).includes(origin)),
    },
    now: () => NOW,
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
  it('are five reads and eight writes, none naming a subject', () => {
    expect(ME_ROUTES.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /tenants/:tenant/me/profile',
      'GET /tenants/:tenant/me/credentials',
      'GET /tenants/:tenant/me/sessions',
      'GET /tenants/:tenant/me/consents',
      'GET /tenants/:tenant/me/delegations',
      'PATCH /tenants/:tenant/me/profile',
      'DELETE /tenants/:tenant/me/sessions',
      'DELETE /tenants/:tenant/me/sessions/:id',
      'DELETE /tenants/:tenant/me/consents/:client_id',
      'PATCH /tenants/:tenant/me/credentials/:id',
      'DELETE /tenants/:tenant/me/credentials/:id',
      'POST /tenants/:tenant/me/delegations',
      'DELETE /tenants/:tenant/me/delegations/:id',
    ]);
    expect(ME_ROUTES.every((r) => !r.url.includes('subject'))).toBe(true);
  });

  it('equal the routes the app registers, both ways', () => {
    const routes: string[] = [];
    build({ routes });
    const served = routes.filter((r) => !r.startsWith('OPTIONS ') && !r.startsWith('HEAD '));
    expect(served.sort()).toEqual(ME_ROUTES.map((r) => `${r.method} ${r.url}`).sort());
  });

  it('answer an error only at an error status, and nothing only at a success', () => {
    for (const route of ME_ROUTES) {
      for (const [status, answer] of Object.entries(route.responses)) {
        if (answer === 'error') expect(Number(status), route.url).toBeGreaterThanOrEqual(400);
        if (answer === 'empty') expect(Number(status), route.url).toBe(204);
        if (typeof answer === 'object') {
          expect(Number(status), route.url).toBeLessThan(300);
        }
      }
    }
  });

  it('do not take the document for a me route', () => {
    expect(isMeRoute('/me/openapi.json')).toBe(false);
    expect(isMeRoute('/tenants/:tenant/me/profile')).toBe(true);
  });

  it('name a scope, and the writes name me:write', () => {
    for (const route of ME_ROUTES) {
      expect(route.scope, route.url).toBe(route.method === 'GET' ? 'me:read' : 'me:write');
    }
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
          device: 'a1b2',
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
      recovery_codes_low: true,
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
  it.each(['profile', 'credentials', 'sessions', 'consents', 'delegations'])(
    'challenges %s with no token',
    async (path) => {
      const res = await get(build(), path, null);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    },
  );

  it.each(['profile', 'credentials', 'sessions', 'consents', 'delegations'])(
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
  method: 'PATCH' | 'DELETE' | 'POST',
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

const WRITES: readonly [string, 'PATCH' | 'DELETE' | 'POST', string, object | undefined][] = [
  ['the profile', 'PATCH', 'profile', { name: 'Ada L' }],
  ['all other sessions', 'DELETE', 'sessions', undefined],
  ['one session', 'DELETE', `sessions/${OTHER_SESSION}`, undefined],
  ['a consent', 'DELETE', 'consents/portal', undefined],
  ['a credential', 'PATCH', `credentials/${CRED_ID}`, { label: 'Work phone' }],
  ['removing a credential', 'DELETE', `credentials/${CRED_ID}`, undefined],
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

  it.each([[{ email_verified: true }], [{ phone_number_verified: true }], [{}], [{ name: 4 }]])(
    'refuses the body %j with 400',
    async (body) => {
      const res = await send(build(), 'PATCH', 'profile', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request' });
    },
  );

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

describe('GET /me/delegations', () => {
  it('lists the token’s own, uncached, with the clients by their client_id', async () => {
    const seen: string[] = [];
    const res = await get(build({ seen }), 'delegations');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      items: [
        {
          id: DELEGATION_ID,
          client_id: 'portal',
          actor_client_id: 'assistant',
          scope_ceiling: 'openid profile',
          expires_at: '2026-12-01T00:00:00.000Z',
          created_at: NOW.toISOString(),
        },
      ],
    });
    expect(seen).toEqual(['delegations tenant-1 subject-1']);
  });

  it('refuses any query member with 400', async () => {
    expect((await get(build(), 'delegations?subject=x')).statusCode).toBe(400);
  });
});

describe('POST /me/delegations', () => {
  it('answers 201 with the delegation and files the lineage row', async () => {
    const seen: string[] = [];
    const delegationAudits: DelegationAuditEvent[] = [];
    const res = await send(
      build({ seen, delegationAudits }),
      'POST',
      'delegations',
      NEW_DELEGATION,
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ id: DELEGATION_ID, actor_client_id: 'assistant' });
    expect(seen).toContain('createDelegation subject-1 assistant 20');
    expect(delegationAudits.map((event) => event.action)).toEqual(['agent.delegation_created']);
  });

  it.each([
    ['a member it does not name', { ...NEW_DELEGATION, subject_id: 'x' }],
    ['no scope', { ...NEW_DELEGATION, scope_ceiling: '' }],
    ['a lifetime of zero', { ...NEW_DELEGATION, expires_in: 0 }],
  ])('answers 400 for %s, before any write', async (_, body) => {
    const seen: string[] = [];
    const res = await send(build({ seen }), 'POST', 'delegations', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(seen.some((entry) => entry.startsWith('transact'))).toBe(false);
  });

  it('answers 400 naming the member when an actor is not an agent client', async () => {
    const tx = {
      delegationClient: (key: string) =>
        Promise.resolve({ id: key, clientKey: key, enabled: true, agentType: false }),
    };
    const res = await send(build({ tx }), 'POST', 'delegations', NEW_DELEGATION);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid_request',
      error_description: 'actor_client_id: is not an agent client',
    });
  });

  it('answers 409 at the limit and files nothing', async () => {
    const delegationAudits: DelegationAuditEvent[] = [];
    const res = await send(
      build({ delegationAudits, tx: { createDelegation: () => Promise.resolve(null) } }),
      'POST',
      'delegations',
      NEW_DELEGATION,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'conflict' });
    expect(delegationAudits).toEqual([]);
  });

  it('is refused for a token that holds me:read alone', async () => {
    const res = await send(
      build({ scope: 'openid me:read' }),
      'POST',
      'delegations',
      NEW_DELEGATION,
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /me/delegations/:id', () => {
  it('revokes the caller’s own with no body and files the lineage row', async () => {
    const delegationAudits: DelegationAuditEvent[] = [];
    const seen: string[] = [];
    const res = await send(
      build({ delegationAudits, seen }),
      'DELETE',
      `delegations/${DELEGATION_ID}`,
    );
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(seen).toContain(`revokeDelegation subject-1 ${DELEGATION_ID}`);
    expect(delegationAudits.map((event) => event.action)).toEqual(['agent.delegation_revoked']);
  });

  it('answers 404 for one that is not theirs or is not live', async () => {
    const app = build({ tx: { revokeDelegation: () => Promise.resolve(null) } });
    expect((await send(app, 'DELETE', `delegations/${DELEGATION_ID}`)).statusCode).toBe(404);
  });

  it('answers 404 for an id that is not a uuid, without reading the session', async () => {
    const seen: string[] = [];
    expect((await send(build({ seen }), 'DELETE', 'delegations/nope')).statusCode).toBe(404);
    expect(seen).toEqual([]);
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

const STALE = new Date(NOW.getTime() - 301_000);
const CHALLENGE =
  'Bearer error="insufficient_user_authentication", ' +
  'error_description="A recent sign-in is required", max_age="300"';

const GATED: readonly [string, 'PATCH' | 'DELETE' | 'POST', string, object | undefined][] = [
  ['ending all other sessions', 'DELETE', 'sessions', undefined],
  ['revoking a consent', 'DELETE', 'consents/portal', undefined],
  ['changing the username', 'PATCH', 'profile', { username: 'grace' }],
  ['making a delegation', 'POST', 'delegations', NEW_DELEGATION],
];

const UNGATED: readonly [string, 'PATCH' | 'DELETE' | 'POST', string, object | undefined][] = [
  ['ending one session', 'DELETE', `sessions/${OTHER_SESSION}`, undefined],
  ['renaming an authenticator', 'PATCH', `credentials/${CRED_ID}`, { label: 'Work phone' }],
  ['amending a claim', 'PATCH', 'profile', { name: 'Ada L' }],
  ['revoking a delegation', 'DELETE', `delegations/${DELEGATION_ID}`, undefined],
];

describe('the freshness gate', () => {
  it.each(GATED)('asks for a new sign-in before %s on an old one', async (_l, m, path, body) => {
    const seen: string[] = [];
    const audits: MeAuditEvent[] = [];
    const res = await send(build({ signedInAt: STALE, seen, audits }), m, path, body);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(seen).toEqual([`signedInAt tenant-1 subject-1 ${ID}`]);
    expect(audits).toEqual([]);
  });

  it.each(GATED)(
    'lets %s through on a recent sign-in, after one read',
    async (_l, m, path, body) => {
      const seen: string[] = [];
      const res = await send(build({ seen }), m, path, body);
      expect(res.statusCode).toBeLessThan(300);
      expect(seen.filter((entry) => entry.startsWith('signedInAt'))).toEqual([
        `signedInAt tenant-1 subject-1 ${ID}`,
      ]);
    },
  );

  it.each(GATED)('treats a sign-in exactly at the window as recent for %s', async (_l, m, p, b) => {
    const at = new Date(NOW.getTime() - 300_000);
    expect((await send(build({ signedInAt: at }), m, p, b)).statusCode).toBeLessThan(300);
  });

  it.each(GATED)('refuses %s with no challenge once the session has ended', async (_l, m, p, b) => {
    const seen: string[] = [];
    const res = await send(build({ signedInAt: null, seen }), m, p, b);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    expect(res.headers['www-authenticate']).not.toContain('insufficient_user_authentication');
    expect(seen).toEqual([`signedInAt tenant-1 subject-1 ${ID}`]);
  });

  it.each(GATED)(
    'refuses %s with no challenge for a token with no session',
    async (_l, m, p, b) => {
      const seen: string[] = [];
      const app = build({ claims: { sid: undefined }, seen });
      const res = await send(app, m, p, b);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
      expect(seen).toEqual([]);
    },
  );

  it.each(UNGATED)(
    'reads the session once for %s and ignores how old it is',
    async (_l, m, p, b) => {
      const seen: string[] = [];
      const res = await send(build({ signedInAt: STALE, seen }), m, p, b);
      expect(res.statusCode).toBeLessThan(300);
      expect(seen.filter((entry) => entry.startsWith('signedInAt'))).toEqual([
        `signedInAt tenant-1 subject-1 ${ID}`,
      ]);
    },
  );

  it.each(UNGATED)(
    'refuses %s with no challenge once the session has ended',
    async (_l, m, p, b) => {
      const seen: string[] = [];
      const audits: MeAuditEvent[] = [];
      const res = await send(build({ signedInAt: null, seen, audits }), m, p, b);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
      expect(seen.filter((entry) => entry.startsWith('signedInAt'))).toHaveLength(1);
      expect(seen.some((entry) => entry.startsWith('endSessions'))).toBe(false);
      expect(audits).toEqual([]);
    },
  );

  it.each(UNGATED)('refuses %s for a token with no session', async (_l, m, p, b) => {
    const seen: string[] = [];
    const res = await send(build({ claims: { sid: undefined }, seen }), m, p, b);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    expect(seen).toEqual([]);
  });

  it.each(UNGATED)(
    'still refuses an agent token before %s reads the session',
    async (_l, m, p, b) => {
      const seen: string[] = [];
      const app = build({ claims: { act: { sub: 'agent-1', client_id: 'agent' } }, seen });
      expect((await send(app, m, p, b)).statusCode).toBe(403);
      expect(seen).toEqual([]);
    },
  );

  it.each(['profile', 'credentials', 'sessions', 'consents', 'delegations'])(
    'does not read the session to read %s',
    async (path) => {
      const seen: string[] = [];
      await get(build({ signedInAt: STALE, seen }), path);
      expect(seen.some((entry) => entry.startsWith('signedInAt'))).toBe(false);
    },
  );

  it.each(GATED)('still refuses an agent token before %s is judged', async (_l, m, p, b) => {
    const seen: string[] = [];
    const app = build({
      claims: { act: { sub: 'agent-1', client_id: 'agent' } },
      signedInAt: STALE,
      seen,
    });
    const res = await send(app, m, p, b);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
    expect(seen).toEqual([]);
  });
});

describe('PATCH /me/profile, a username or an email', () => {
  it('renames the person on a recent sign-in', async () => {
    const res = await send(build(), 'PATCH', 'profile', { username: 'grace' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: 'grace' });
  });

  it('refuses a rename in a tenant that has not turned it on, without reading the session', async () => {
    const seen: string[] = [];
    const res = await send(build({ usernameEditable: false, seen }), 'PATCH', 'profile', {
      username: 'grace',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(res.body).toContain('username_editable');
    expect(seen).toEqual([]);
  });

  it('answers 409 for a name another subject holds', async () => {
    const app = build({
      tx: { renameUser: () => Promise.reject(new UsernameTakenError()) },
    });
    const res = await send(app, 'PATCH', 'profile', { username: 'grace' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'conflict' });
  });

  it('answers 202 for a new address, queuing one mail and leaving the profile as it is', async () => {
    const seen: string[] = [];
    const audits: MeAuditEvent[] = [];
    const res = await send(build({ seen, audits }), 'PATCH', 'profile', {
      email: 'new@example.com',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ email_verification_sent: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(seen).toContain('setPendingEmail new@example.com');
    expect(seen).toContain('queueAddressProof new@example.com');
    expect(audits.map((a) => a.action)).toEqual(['subject.profile_amend']);
  });

  it('answers the same 202 for an address another account holds, and sends nothing', async () => {
    const seen: string[] = [];
    const tx = { holderOfEmail: () => Promise.resolve('someone-else') };
    const res = await send(build({ seen, tx }), 'PATCH', 'profile', { email: 'taken@example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ email_verification_sent: true });
    expect(seen.some((entry) => entry.startsWith('queueAddressProof'))).toBe(false);
  });

  it('asks for a new sign-in when the sign-in is old, before any write', async () => {
    const seen: string[] = [];
    const res = await send(build({ seen, signedInAt: STALE }), 'PATCH', 'profile', {
      email: 'new@example.com',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
    expect(seen.some((entry) => entry.startsWith('transact'))).toBe(false);
  });

  it('refuses an agent token before the session is read', async () => {
    const seen: string[] = [];
    const app = build({ seen, claims: { act: { sub: 'agent-1', client_id: 'agent' } } });
    const res = await send(app, 'PATCH', 'profile', { email: 'new@example.com' });
    expect(res.statusCode).toBe(403);
    expect(seen).toEqual([]);
  });

  it.each([[null], ['not an address'], [4]])('answers 400 for the address %j', async (email) => {
    const seen: string[] = [];
    const res = await send(build({ seen }), 'PATCH', 'profile', { email });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(res.body).toContain('email');
    expect(seen).toEqual([]);
  });

  it('refuses an address sent beside other members, which would be answered two ways', async () => {
    const res = await send(build(), 'PATCH', 'profile', {
      email: 'new@example.com',
      name: 'Ada L',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('email');
  });

  it('answers 503 where the deployment cannot send mail', async () => {
    const tx = { mailIsAvailable: () => Promise.resolve(false) };
    const res = await send(build({ tx }), 'PATCH', 'profile', { email: 'new@example.com' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'mail_unavailable' });
  });
});

describe('DELETE /me/credentials/:id', () => {
  const remove = (app: FastifyInstance, id = CRED_ID) => send(app, 'DELETE', `credentials/${id}`);
  const TOTP_ACR = `${CHALLENGE}, acr_values="2"`;

  it('removes the authenticator and answers 204 with no body, uncached', async () => {
    const seen: string[] = [];
    const audits: MeAuditEvent[] = [];
    const res = await remove(build({ seen, audits }));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(seen).toContain(`deleteCredential ${CRED_ID}`);
    expect(audits.map((a) => a.action)).toEqual(['subject.credential_delete']);
  });

  it('asks a person who holds a second factor for a new sign-in that used one', async () => {
    const seen: string[] = [];
    const res = await remove(build({ signedInAt: STALE, seen }));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(TOTP_ACR);
    expect(seen.some((entry) => entry.startsWith('deleteCredential'))).toBe(false);
  });

  it('asks a person who holds none for a recent sign-in and names no context', async () => {
    const reads = {
      credentials: () =>
        Promise.resolve({
          rows: [PASSWORD],
          recoveryCodesLeft: 0,
          recoveryCodesHeld: 0,
          recoveryCodeWarnBelow: 3,
        }),
    };
    const res = await remove(build({ signedInAt: STALE, reads }));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
  });

  it('answers a gone session with no challenge', async () => {
    const res = await remove(build({ signedInAt: null }));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('refuses an agent token before anything is read', async () => {
    const seen: string[] = [];
    const app = build({ claims: { act: { sub: 'agent-1', client_id: 'agent' } }, seen });
    const res = await remove(app);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
    expect(seen).toEqual([]);
  });

  it.each(['last_sign_in_method', 'last_second_factor'] as const)(
    'answers 409 %s with its own message and removes nothing',
    async (code) => {
      const seen: string[] = [];
      const passkey: CredentialSummary = { ...SUMMARY, type: 'webauthn' };
      const tx =
        code === 'last_sign_in_method'
          ? {
              credentialOf: () => Promise.resolve(passkey),
              heldCredentials: () => Promise.resolve([passkey]),
            }
          : { tenantRequiresSecondFactor: () => Promise.resolve(true) };
      const res = await remove(build({ seen, tx }));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: code,
        error_description: REMOVAL_REFUSAL_MESSAGES[code],
      });
      expect(seen.some((entry) => entry.startsWith('deleteCredential'))).toBe(false);
    },
  );

  it('answers 404 for a credential the person does not hold, after the gate', async () => {
    const seen: string[] = [];
    const app = build({ seen, tx: { credentialOf: () => Promise.resolve(null) } });
    expect((await remove(app)).statusCode).toBe(404);
    expect(seen.filter((entry) => entry.startsWith('signedInAt'))).toHaveLength(1);
  });

  it('answers 404 for the password, which this route does not remove', async () => {
    const app = build({ tx: { credentialOf: () => Promise.resolve(PASSWORD) } });
    expect((await remove(app, PASSWORD.id)).statusCode).toBe(404);
  });

  it('answers 404 for an id that is not a uuid, without reading the session', async () => {
    const seen: string[] = [];
    expect((await remove(build({ seen }), 'nope')).statusCode).toBe(404);
    expect(seen).toEqual([]);
  });
});

describe('cross-origin calls', () => {
  const ORIGIN = 'https://spa.example';
  const withOrigin = (app: FastifyInstance, origin: string, token: string | null = TOKEN) =>
    app.inject({
      method: 'GET',
      url: '/tenants/acme/me/profile',
      headers: {
        origin,
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
    });

  it('echo the origin the token’s client allows, and say Vary', async () => {
    const res = await withOrigin(build({ origins: [ORIGIN] }), ORIGIN);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers.vary).toBe('Origin');
  });

  it('withhold the header from any other origin', async () => {
    const other = await withOrigin(build({ origins: [ORIGIN] }), 'https://other.example');
    expect(other.statusCode).toBe(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(other.headers['access-control-expose-headers']).toBeUndefined();
    expect(other.headers.vary).toBe('Origin');
  });

  it('let a script read the challenge and the wait: both headers are exposed', async () => {
    const res = await withOrigin(build({ origins: [ORIGIN] }), ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe('WWW-Authenticate, Retry-After');
  });

  it('answer a refusal before admission to an origin the tenant lists, so a script reads the status', async () => {
    const app = build({ origins: [ORIGIN] });
    const noToken = await withOrigin(app, ORIGIN, null);
    expect(noToken.statusCode).toBe(401);
    expect(noToken.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(noToken.headers['access-control-expose-headers']).toBe('WWW-Authenticate, Retry-After');
    const unlisted = await withOrigin(app, 'https://other.example', null);
    expect(unlisted.statusCode).toBe(401);
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
    expect(unlisted.headers.vary).toBe('Origin');
  });

  it('keep a refusal a refusal when the allowlist cannot be read', async () => {
    const res = await withOrigin(build({ origins: [ORIGIN], originsFail: true }), ORIGIN, null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers.vary).toBe('Origin');
  });

  it('answer a refusal of a scope the token lacks the same way', async () => {
    const res = await withOrigin(build({ origins: [ORIGIN], scope: 'openid' }), ORIGIN);
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('never reflect an origin for a tenant that is not there', async () => {
    const res = await build({ origins: [ORIGIN] }).inject({
      method: 'GET',
      url: '/tenants/other/me/profile',
      headers: { origin: ORIGIN },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answer a preflight for an origin the tenant allows, and for no other', async () => {
    const app = build({ origins: [ORIGIN] });
    const ask = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/tenants/acme/me/sessions/abc',
        headers: { origin, 'access-control-request-method': 'DELETE' },
      });
    const allowed = await ask(ORIGIN);
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-methods']).toBe('GET, POST, PATCH, DELETE, OPTIONS');
    const refused = await ask('https://other.example');
    expect(refused.statusCode).toBe(204);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    expect(refused.headers.vary).toBe('Origin');
  });

  it('answer a preflight for an unknown tenant with no allowance', async () => {
    const res = await build({ origins: [ORIGIN] }).inject({
      method: 'OPTIONS',
      url: '/tenants/other/me/profile',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('isMeRoute', () => {
  it('holds for what is under a tenant’s me address, the preflight route included', () => {
    expect(isMeRoute('/tenants/:tenant/me/profile')).toBe(true);
    expect(isMeRoute('/tenants/:tenant/me/*')).toBe(true);
    expect(isMeRoute('/tenants/:tenant/mcp')).toBe(false);
    expect(isMeRoute(undefined)).toBe(false);
  });
});

describe('DELETE /me/credentials/{id}, on a sign-in that ran one factor', () => {
  it('refuses removing a second factor with the challenge, and removes nothing', async () => {
    const seen: string[] = [];
    const res = await send(
      build({
        authenticators: ['password'],
        tx: { heldCredentials: () => Promise.resolve([PASSWORD, SUMMARY]) },
        seen,
      }),
      'DELETE',
      `credentials/${CRED_ID}`,
    );
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('acr_values="2"');
    expect(seen.some((entry) => entry.startsWith('deleteCredential'))).toBe(false);
  });
});

describe('an id that is not one', () => {
  it.each<['DELETE' | 'PATCH', string]>([
    ['DELETE', 'sessions/not-an-id'],
    ['PATCH', 'credentials/not-an-id'],
    ['DELETE', 'credentials/not-an-id'],
  ])('is answered 404 by %s %s before the door reads anything', async (method, path) => {
    const door: string[] = [];
    const res = await send(
      build({ door }),
      method,
      path,
      method === 'PATCH' ? { label: 'x' } : undefined,
    );
    expect(res.statusCode).toBe(404);
    expect(door).toEqual([]);
  });
});
