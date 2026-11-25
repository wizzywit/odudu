import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository, users } from '@odudu/domain-identity';
import { FakeClock } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { CIBA_GRANT, hashAuthReqId } from '#/service/ciba';
import {
  signHint,
  seedCibaWorld,
  CIBA_KEK,
  type CibaClient,
  type CibaWorld,
} from '#/testing/ciba-fixture';
import { noBreachedLookup } from '#/testing/breached-check';
import { decideApproval, requestApproval } from '#/usecase/approvals';
import { signClientAssertion } from '#/testing/private-key-jwt-fixture';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const clock = new FakeClock(new Date());
const statements: string[] = [];
let recording = false;
let mailBudgetSpent = false;

const limiter: { denied: boolean; keys: string[] } & ClientSecretLimiter = {
  denied: false,
  keys: [],
  check(key: string) {
    this.keys.push(key);
    return this.denied
      ? { allowed: false, retryAfterSeconds: 7 }
      : { allowed: true, retryAfterSeconds: 0 };
  },
};

let appUrl: string;

async function startApp(db: DatabaseHandle): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(formbody);
  await server.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: db,
      ownerDatabase: owner,
      kek: CIBA_KEK,
      clock,
      publicBaseUrl: 'https://idp.example',
      approvalMailBudget: () => !mailBudgetSpent,
      clientSecretLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      cibaLimiter: limiter,
    }),
  );
  await server.ready();
  return server;
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, {
    max: 8,
    onQueryForTests: (query) => {
      if (recording) statements.push(query);
    },
  });
  http = await startApp(app);
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

type Params = Record<string, string | undefined>;

function body(params: Params): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, value);
  return form.toString();
}

function basic(client: CibaClient): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`,
  };
}

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function authorize(
  world: CibaWorld,
  client: CibaClient | null,
  params: Params,
  secret?: string,
): Promise<LightMyRequestResponse> {
  const headers =
    client === null ? {} : secret === undefined ? basic(client) : basic({ ...client, secret });
  return http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
    headers: { ...FORM, ...headers },
    payload: body(params),
  });
}

function poll(
  world: CibaWorld,
  client: CibaClient,
  authReqId: string | undefined,
  grantType: string = CIBA_GRANT,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
    headers: { ...FORM, ...basic(client) },
    payload: body({ grant_type: grantType, auth_req_id: authReqId }),
  });
}

interface Acknowledgement {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

async function request(
  world: CibaWorld,
  hint: Params = { login_hint: 'alice' },
  client: CibaClient = world.agent,
  extra: Params = {},
): Promise<Acknowledgement> {
  const res = await authorize(world, client, { scope: 'openid', ...hint, ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Acknowledgement>();
}

async function approvalOf(world: CibaWorld, authReqId: string) {
  return withTenant(app.db, world.tenantId, async (tx) => {
    const row = await cibaRequestRepository(tx).byHash(hashAuthReqId(authReqId));
    if (row === null) throw new Error('no such request');
    return row;
  });
}

function decide(world: CibaWorld, approvalId: string, subjectId: string, approve: boolean) {
  return withTenant(app.db, world.tenantId, (tx) =>
    decideApproval(
      tx,
      { tenantId: world.tenantId },
      { approvalId, subjectId, approve, via: 'ciba_page', now: clock.now() },
    ),
  );
}

// What each statement does and to which table, so a path that reads or writes
// a different table cannot hide behind the same verb.
const STATEMENT = /^\s*(select|insert|update|delete)\b[\s\S]*?\b(?:from|into)\s+"?([a-z_]+)"?/iu;

function shapes(queries: readonly string[]): string[] {
  return queries
    .filter((q) => /^\s*(select|insert|update|delete|with)\b/iu.test(q))
    .filter((q) => !q.includes('set_config'))
    .map((q) => {
      const match = STATEMENT.exec(q);
      const verb = q.trimStart().split(/\s+/u)[0]?.toLowerCase() ?? '';
      return match === null ? verb : `${verb} ${match[2]?.toLowerCase() ?? ''}`;
    });
}

async function issuerOf(on: CibaWorld): Promise<string> {
  const res = await http.inject({ url: `/tenants/${on.tenant}/.well-known/openid-configuration` });
  return res.json<{ issuer: string }>().issuer;
}

// The form fields of a signed assertion for the client that authenticates that way.
async function assertionFields(audience: string): Promise<Params> {
  return {
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await signClientAssertion({
      key: world.assertion.key,
      clientId: world.assertion.clientId,
      audience,
      kek: CIBA_KEK,
      now: clock.now(),
    }),
  };
}

function detailOf(row: { detail?: unknown }): Record<string, unknown> {
  return typeof row.detail === 'object' && row.detail !== null
    ? (row.detail as Record<string, unknown>)
    : {};
}

function payload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

let world: CibaWorld;
beforeAll(async () => {
  world = await seedCibaWorld(app, 'flow');
});

// Each test starts with nothing of the shared tenant's still waiting, so the
// limits on a person do not carry from one test to the next.
beforeEach(async () => {
  const past = new Date(clock.now().getTime() - 1000);
  await owner.db.execute(
    sql`update ciba_requests set expires_at = ${past.toISOString()}::timestamptz where tenant_id = ${world.tenantId}`,
  );
  await owner.db.execute(
    sql`update agent_approvals set state = 'expired' where tenant_id = ${world.tenantId} and state = 'pending'`,
  );
});

describe('the backchannel authentication endpoint', () => {
  it('[OIDC-CIBA-13-01] answers an error as JSON with error, 400, 401 for invalid_client and 403 for access_denied', async () => {
    const bad = await authorize(world, world.agent, { scope: 'openid' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'invalid_request' });
    expect(bad.headers['content-type']).toMatch(/^application\/json/u);
    const refused = await authorize(world, world.agent, { scope: 'openid', login_hint: 'a' }, 'x');
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: 'invalid_client' });
    const full = await seedCibaWorld(app, 'thirteen');
    for (let i = 0; i < 21; i += 1) {
      await authorize(full, full.agent, { scope: 'openid', login_hint: 'alice' });
    }
    const last = await authorize(full, full.agent, { scope: 'openid', login_hint: 'alice' });
    expect(last.statusCode).toBe(403);
    expect(last.json()).toMatchObject({ error: 'access_denied' });
  });

  it('[OIDC-CIBA-7.1-01] takes a form-encoded POST and nothing else', async () => {
    const get = await http.inject({
      method: 'GET',
      url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize?scope=openid&login_hint=alice`,
      headers: basic(world.agent),
    });
    expect(get.statusCode).toBe(404);
    const res = await authorize(world, world.agent, { scope: 'openid', login_hint: 'alice' });
    expect(res.statusCode).toBe(200);
  });

  it('[OIDC-CIBA-7.3-01] acknowledges with auth_req_id, expires_in and interval as JSON', async () => {
    const res = await authorize(world, world.agent, { scope: 'openid', login_hint: 'alice' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/u);
    expect(res.headers['cache-control']).toBe('no-store');
    const ack = res.json<Acknowledgement>();
    expect(Object.keys(ack).sort()).toEqual(['auth_req_id', 'expires_in', 'interval']);
    expect(Number.isInteger(ack.expires_in)).toBe(true);
    expect(ack.expires_in).toBeGreaterThan(0);
    expect(ack.expires_in).toBeLessThanOrEqual(600);
  });

  it('[OIDC-CIBA-7.3-03] tells the client to wait five seconds between polls', async () => {
    expect((await request(world)).interval).toBe(5);
  });

  it('[OIDC-CIBA-7.3-02] gives each request its own unguessable id, held only as a digest', async () => {
    const first = await request(world);
    const second = await request(world);
    expect(first.auth_req_id).not.toBe(second.auth_req_id);
    const stored = await owner.db.execute<{ auth_req_hash: string }>(
      sql`select auth_req_hash from ciba_requests where tenant_id = ${world.tenantId}`,
    );
    expect(stored.map((row) => row.auth_req_hash)).not.toContain(first.auth_req_id);
    expect(stored.map((row) => row.auth_req_hash)).toContain(hashAuthReqId(first.auth_req_id));
  });

  it('[OIDC-CIBA-7.2-01] refuses a client that does not authenticate', async () => {
    const wrong = await authorize(
      world,
      world.agent,
      { scope: 'openid', login_hint: 'alice' },
      'not-the-secret',
    );
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: 'invalid_client' });
    const none = await authorize(world, null, { scope: 'openid', login_hint: 'alice' });
    expect(none.statusCode).toBe(401);
  });

  it('[OIDC-CIBA-7.1-02] authenticates a client by its registered method', async () => {
    const res = await authorize(world, null, {
      scope: 'openid',
      login_hint: 'alice',
      client_id: world.agent.clientId,
      client_secret: world.agent.secret,
    });
    expect(res.statusCode).toBe(401);
  });

  it('[OIDC-CIBA-7.2-04] refuses a client that lacks the grant with unauthorized_client', async () => {
    const res = await authorize(world, world.plain, { scope: 'openid', login_hint: 'alice' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
    const polled = await poll(world, world.plain, 'x');
    expect(polled.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('[OIDC-CIBA-7.1.1-01] refuses a request carrying a parameter it does not support', async () => {
    for (const name of ['user_code', 'client_notification_token', 'request', 'login_hint_token']) {
      const res = await authorize(world, world.agent, {
        scope: 'openid',
        login_hint: 'alice',
        [name]: 'x',
      });
      expect(res.statusCode, name).toBe(400);
      expect(res.json(), name).toMatchObject({ error: 'invalid_request' });
    }
  });

  it('[OIDC-CIBA-7.1.2-01] does not accept a user code', async () => {
    const res = await authorize(world, world.agent, {
      scope: 'openid',
      login_hint: 'alice',
      user_code: '1234',
    });
    expect(res.statusCode).toBe(400);
  });

  it('[OIDC-CIBA-7.2-02] refuses two hints, and none', async () => {
    const two = await authorize(world, world.agent, {
      scope: 'openid',
      login_hint: 'alice',
      id_token_hint: 'a.b.c',
    });
    expect(two.json()).toMatchObject({ error: 'invalid_request' });
    const none = await authorize(world, world.agent, { scope: 'openid' });
    expect(none.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('[OIDC-CIBA-7.2-05] ignores parameters it does not know', async () => {
    const res = await authorize(world, world.agent, {
      scope: 'openid',
      login_hint: 'alice',
      acr_values: '2',
      anything: 'goes',
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a scope without openid, and one the client is not assigned', async () => {
    const res = await authorize(world, world.agent, { scope: 'profile', login_hint: 'alice' });
    expect(res.json()).toMatchObject({ error: 'invalid_scope' });
    const unknown = await authorize(world, world.agent, {
      scope: 'openid nonsense',
      login_hint: 'alice',
    });
    expect(unknown.json()).toMatchObject({ error: 'invalid_scope' });
  });

  it('[OIDC-CIBA-7.1-05] stores the binding message as validated text and refuses one past 140 characters', async () => {
    const ack = await request(world, { login_hint: 'alice' }, world.agent, {
      binding_message: '<img src=x onerror=alert(1)>',
    });
    const row = await approvalOf(world, ack.auth_req_id);
    expect(row.bindingMessage).toBe('<img src=x onerror=alert(1)>');
    const long = await authorize(world, world.agent, {
      scope: 'openid',
      login_hint: 'alice',
      binding_message: 'x'.repeat(141),
    });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toMatchObject({ error: 'invalid_binding_message' });
  });

  it('[OIDC-CIBA-7.1-06] caps requested_expiry at the tenant approval lifetime', async () => {
    const shorter = await request(world, { login_hint: 'alice' }, world.agent, {
      requested_expiry: '60',
    });
    expect(shorter.expires_in).toBe(60);
    const longer = await request(world, { login_hint: 'alice' }, world.agent, {
      requested_expiry: '86400',
    });
    expect(longer.expires_in).toBe(600);
    const bad = await authorize(world, world.agent, {
      scope: 'openid',
      login_hint: 'alice',
      requested_expiry: 'soon',
    });
    expect(bad.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('answers a request the client sent too often with a 429 and a Retry-After', async () => {
    limiter.denied = true;
    try {
      const res = await authorize(world, world.agent, { scope: 'openid', login_hint: 'alice' });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('7');
      expect(limiter.keys.at(-1)).toBe(`${world.tenantId}:${world.agent.dbId}`);
    } finally {
      limiter.denied = false;
    }
  });

  it('[OIDC-CIBA-7.2-03] accepts an id_token_hint issued to the client and refuses one issued to another', async () => {
    const issuer = (
      await http.inject({ url: `/tenants/${world.tenant}/.well-known/openid-configuration` })
    ).json<{ issuer: string }>().issuer;
    const own = await signHint(world, issuer, world.agent.clientId, world.alice.subjectId);
    const accepted = await authorize(world, world.agent, { scope: 'openid', id_token_hint: own });
    expect(accepted.statusCode).toBe(200);
    const row = await approvalOf(world, accepted.json<Acknowledgement>().auth_req_id);
    expect(row.subjectId).toBe(world.alice.subjectId);
    const foreign = await signHint(world, issuer, world.other.clientId, world.alice.subjectId);
    const refused = await authorize(world, world.agent, {
      scope: 'openid',
      id_token_hint: foreign,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'invalid_request' });
    const garbage = await authorize(world, world.agent, {
      scope: 'openid',
      id_token_hint: 'not.a.jwt',
    });
    expect(garbage.statusCode).toBe(400);
  });
});

describe('polling the token endpoint', () => {
  it('[OIDC-CIBA-11-01] answers authorization_pending while nobody has decided', async () => {
    const ack = await request(world);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'authorization_pending' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('[OIDC-CIBA-10.1-01] refuses a poll with no auth_req_id', async () => {
    const res = await poll(world, world.agent, undefined);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('[OIDC-CIBA-10.1-02] authenticates the client at the token endpoint', async () => {
    const ack = await request(world);
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
      headers: {
        ...FORM,
        authorization: `Basic ${Buffer.from(`${world.agent.clientId}:wrong`).toString('base64')}`,
      },
      payload: body({ grant_type: CIBA_GRANT, auth_req_id: ack.auth_req_id }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('[OIDC-CIBA-11-02] answers slow_down to a poll before the interval and raises the interval by five seconds', async () => {
    const ack = await request(world);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'authorization_pending',
    });
    clock.advance(2000);
    const early = await poll(world, world.agent, ack.auth_req_id);
    expect(early.statusCode).toBe(400);
    expect(early.json()).toMatchObject({ error: 'slow_down' });
    expect((await approvalOf(world, ack.auth_req_id)).intervalSeconds).toBe(10);

    clock.advance(6000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'slow_down',
    });
    expect((await approvalOf(world, ack.auth_req_id)).intervalSeconds).toBe(15);

    clock.advance(16_000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'authorization_pending',
    });
  });

  it('[OIDC-CIBA-8-01] issues tokens for the person who approved, once they have', async () => {
    const ack = await request(world, { login_hint: 'alice' }, world.agent, {
      scope: 'openid profile',
    });
    clock.advance(6000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'authorization_pending',
    });
    const row = await approvalOf(world, ack.auth_req_id);
    expect(row.approvalId).not.toBeNull();
    expect(await decide(world, row.approvalId ?? '', world.alice.subjectId, true)).toBe('decided');

    clock.advance(6000);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const tokens = res.json<Record<string, unknown>>();
    expect(tokens).toMatchObject({ token_type: 'Bearer' });
    expect(tokens.expires_in).toBe(300);
    expect(String(tokens.scope).split(' ')).toEqual(['openid', 'profile']);
    expect(tokens).not.toHaveProperty('refresh_token');

    const access = payload(String(tokens.access_token));
    expect(access.sub).toBe(world.alice.subjectId);
    expect(access.client_id).toBe(world.agent.clientId);
    expect(access).not.toHaveProperty('act');
    const idToken = payload(String(tokens.id_token));
    expect(idToken.sub).toBe(world.alice.subjectId);
    expect(idToken.aud).toBe(world.agent.clientId);
    expect(idToken.iss).toBe(access.iss);
    expect(typeof idToken.auth_time).toBe('number');

    await withTenant(app.db, world.tenantId, async (tx) => {
      const rows = await auditRepository(tx).list({ limit: 200 });
      const issued = rows.find(
        (r) => r.action === 'ciba.token_issued' && detailOf(r).approval === row.approvalId,
      );
      expect(issued).toMatchObject({
        eventType: 'agent_identity',
        outcome: 'allowed',
        actorSubjectId: world.alice.subjectId,
        actorClientId: world.agent.dbId,
        detail: { owner: world.alice.subjectId, agent_client: world.agent.dbId },
      });
    });
  });

  it('[OIDC-CIBA-10.1.1-01] answers access_token, token_type, expires_in and id_token', async () => {
    const ack = await request(world);
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    clock.advance(6000);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.statusCode).toBe(200);
    const tokens = res.json<Record<string, unknown>>();
    expect(typeof tokens.access_token).toBe('string');
    expect(typeof tokens.id_token).toBe('string');
    expect(tokens.token_type).toBe('Bearer');
    expect(Number.isInteger(tokens.expires_in)).toBe(true);
  });

  it('[OIDC-CIBA-10.1-04] never redeems an auth_req_id twice', async () => {
    const ack = await request(world);
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    clock.advance(6000);
    expect((await poll(world, world.agent, ack.auth_req_id)).statusCode).toBe(200);
    clock.advance(6000);
    const again = await poll(world, world.agent, ack.auth_req_id);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('[OIDC-CIBA-11-04] answers access_denied when the person refused', async () => {
    const ack = await request(world);
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, false);
    clock.advance(6000);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'access_denied' });
  });

  it('[OIDC-CIBA-11-03] answers expired_token once the request has expired', async () => {
    const ack = await request(world, { login_hint: 'alice' }, world.agent, {
      requested_expiry: '30',
    });
    clock.advance(31_000);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'expired_token' });
  });

  it('answers expired_token for an approval that came after the request expired', async () => {
    const ack = await request(world, { login_hint: 'alice' }, world.agent, {
      requested_expiry: '30',
    });
    const row = await approvalOf(world, ack.auth_req_id);
    clock.advance(31_000);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'expired_token',
    });
  });

  it('[OIDC-CIBA-11-05] answers invalid_grant for an id that is unknown', async () => {
    const res = await poll(world, world.agent, 'no-such-request');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('[OIDC-CIBA-10.1-03] answers invalid_grant to a client that was not issued the id, and leaves it spendable', async () => {
    const ack = await request(world);
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    clock.advance(6000);
    const stolen = await poll(world, world.other, ack.auth_req_id);
    expect(stolen.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await poll(world, world.agent, ack.auth_req_id)).statusCode).toBe(200);
  });

  it('answers invalid_grant for the id of another tenant', async () => {
    const elsewhere = await seedCibaWorld(app, 'elsewhere');
    const ack = await request(elsewhere);
    const res = await poll(world, world.agent, ack.auth_req_id);
    expect(res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('does not issue to a person disabled since they approved', async () => {
    const ack = await request(world, { login_hint: 'bob' });
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.bob.subjectId, true);
    await owner.db.execute(
      sql`update subjects set disabled_at = now() where id = ${world.bob.subjectId}`,
    );
    try {
      clock.advance(6000);
      expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
        error: 'invalid_grant',
      });
    } finally {
      await owner.db.execute(
        sql`update subjects set disabled_at = null where id = ${world.bob.subjectId}`,
      );
    }
  });

  it('records a poll refusal and the request in the audit trail', async () => {
    const ack = await request(world);
    await poll(world, world.agent, ack.auth_req_id);
    clock.advance(1000);
    await poll(world, world.agent, ack.auth_req_id);
    const row = await approvalOf(world, ack.auth_req_id);
    await withTenant(app.db, world.tenantId, async (tx) => {
      const rows = await auditRepository(tx).list({ limit: 500 });
      expect(
        rows.some((r) => r.action === 'ciba.requested' && detailOf(r).approval === row.approvalId),
      ).toBe(true);
      expect(
        rows.some(
          (r) =>
            r.action === 'ciba.poll_refused' &&
            r.outcome === 'refused' &&
            detailOf(r).reason === 'polled_early' &&
            detailOf(r).approval === row.approvalId,
        ),
      ).toBe(true);
    });
  });
});

describe('a person the hint does not identify', () => {
  async function counted(hint: Params, on: CibaWorld = world) {
    statements.length = 0;
    recording = true;
    try {
      const res = await authorize(on, on.agent, { scope: 'openid', ...hint });
      return { res, verbs: shapes(statements) };
    } finally {
      recording = false;
    }
  }

  it('[ODUDU-CIBA-UNKNOWN-01] is answered with the same status, body shape, headers and statements as a known one', async () => {
    const known = await counted({ login_hint: 'alice' });
    const unknown = await counted({ login_hint: 'nobody-by-that-name' });
    expect(unknown.res.statusCode).toBe(known.res.statusCode);
    expect(Object.keys(unknown.res.json<object>()).sort()).toEqual(
      Object.keys(known.res.json<object>()).sort(),
    );
    expect(unknown.res.json<Acknowledgement>().expires_in).toBe(
      known.res.json<Acknowledgement>().expires_in,
    );
    expect(unknown.res.json<Acknowledgement>().interval).toBe(
      known.res.json<Acknowledgement>().interval,
    );
    expect(unknown.res.headers['content-type']).toBe(known.res.headers['content-type']);
    expect(unknown.res.headers['cache-control']).toBe(known.res.headers['cache-control']);
    expect(unknown.verbs.length).toBeGreaterThan(5);
    expect(known.verbs).toContain('insert email_outbox');
    expect(unknown.verbs).toEqual(known.verbs);

    await fillApprovals(world, world.bob.subjectId, 20);
    const atCap = await counted({ login_hint: 'bob' });
    expect(atCap.res.statusCode).toBe(known.res.statusCode);
    expect(atCap.verbs).toEqual(known.verbs);
  });

  it('[ODUDU-CIBA-UNKNOWN-06] runs the same statements for a person whose address is over its mail budget', async () => {
    const mailed = await counted({ login_hint: 'alice' });
    mailBudgetSpent = true;
    try {
      const over = await counted({ login_hint: 'alice' });
      expect(over.res.statusCode).toBe(200);
      expect(over.verbs).toEqual(mailed.verbs);
    } finally {
      mailBudgetSpent = false;
    }
  });

  it('[ODUDU-CIBA-UNKNOWN-05] runs the same statements for a known person whose address cannot be mailed', async () => {
    const mailed = await counted({ login_hint: 'alice' });
    const unmailed = await counted({ login_hint: 'bob' });
    expect(unmailed.res.statusCode).toBe(200);
    expect(unmailed.verbs).toEqual(mailed.verbs);
  });

  it('[ODUDU-CIBA-UNKNOWN-02] polls as authorization_pending until it expires, creates no approval and sends nothing', async () => {
    const before = await owner.db.execute<{ approvals: number; mail: number }>(sql`
      select (select count(*)::int from agent_approvals where tenant_id = ${world.tenantId}) as approvals,
             (select count(*)::int from email_outbox where tenant_id = ${world.tenantId}) as mail`);
    const ack = await request(world, { login_hint: 'ghost' }, world.agent, {
      requested_expiry: '30',
    });
    const row = await approvalOf(world, ack.auth_req_id);
    expect(row.subjectId).toBeNull();
    expect(row.approvalId).toBeNull();

    clock.advance(6000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'authorization_pending',
    });
    clock.advance(1000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'slow_down',
    });
    clock.advance(31_000);
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'expired_token',
    });
    const after = await owner.db.execute<{ approvals: number; mail: number }>(sql`
      select (select count(*)::int from agent_approvals where tenant_id = ${world.tenantId}) as approvals,
             (select count(*)::int from email_outbox where tenant_id = ${world.tenantId}) as mail`);
    expect(after[0]).toEqual(before[0]);
  });

  it('[ODUDU-CIBA-UNKNOWN-03] hits the pending limit exactly as a known person does, with access_denied', async () => {
    const results = { known: [] as number[], unknown: [] as number[] };
    for (const [label, hint] of [
      ['known', 'bob'],
      ['unknown', 'nonexistent-person'],
    ] as const) {
      for (let i = 0; i < 21; i += 1) {
        const res = await authorize(world, world.agent, { scope: 'openid', login_hint: hint });
        results[label].push(res.statusCode);
        if (i === 20) {
          expect(res.json(), label).toMatchObject({ error: 'access_denied' });
          expect(res.statusCode).toBe(403);
        }
      }
    }
    expect(results.known).toEqual(results.unknown);
    expect(results.known.slice(0, 20).every((status) => status === 200)).toBe(true);
  });

  it('[ODUDU-CIBA-UNKNOWN-04] counts a lookup the same by email where the tenant accepts it', async () => {
    await owner.db.execute(
      sql`update tenants set login_with_email = true where id = ${world.tenantId}`,
    );
    try {
      const known = await counted({ login_hint: 'alice@example.test' });
      const unknown = await counted({ login_hint: 'nobody@example.test' });
      expect(known.res.statusCode).toBe(200);
      expect(unknown.res.statusCode).toBe(200);
      expect(unknown.verbs).toEqual(known.verbs);
      const row = await approvalOf(world, known.res.json<Acknowledgement>().auth_req_id);
      expect(row.subjectId).toBe(world.alice.subjectId);
    } finally {
      await owner.db.execute(
        sql`update tenants set login_with_email = false where id = ${world.tenantId}`,
      );
    }
  });
});

// Another source of pending approvals for one person: another client's.
async function fillApprovals(on: CibaWorld, subjectId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await withTenant(app.db, on.tenantId, (tx) =>
      requestApproval(
        tx,
        { tenantId: on.tenantId },
        {
          subjectId,
          requestingClientId: on.other.dbId,
          instanceId: null,
          kind: 'tool_call',
          summary: 'Something else',
          actionDigest: 'b'.repeat(64),
          now: clock.now(),
        },
      ),
    );
  }
}

describe('the limit on requests for one hint', () => {
  async function twentyOne(on: CibaWorld, hints: string[], extra: Params = {}) {
    const statuses: number[] = [];
    for (const [i, hint] of hints.entries()) {
      const res = await authorize(on, on.agent, {
        scope: 'openid',
        login_hint: hint,
        ...extra,
      });
      statuses.push(res.statusCode);
      if (i === hints.length - 1 && res.statusCode === 403) {
        expect(res.json()).toMatchObject({ error: 'access_denied' });
      }
    }
    return statuses;
  }

  it('[ODUDU-CIBA-CAP-01] counts a request that was shortened by requested_expiry the same for a known and an unknown hint', async () => {
    const fresh = await seedCibaWorld(app, 'cap-expiry');
    for (const hint of ['alice', 'ghost']) {
      const statuses = await twentyOne(fresh, Array(20).fill(hint) as string[], {
        requested_expiry: '1',
      });
      expect(
        statuses.every((status) => status === 200),
        hint,
      ).toBe(true);
      clock.advance(2000);
      const again = await authorize(fresh, fresh.agent, { scope: 'openid', login_hint: hint });
      expect(again.statusCode, hint).toBe(200);
    }
  });

  it('[ODUDU-CIBA-CAP-02] shares one counter between spellings of one address, known or not', async () => {
    const fresh = await seedCibaWorld(app, 'cap-alias');
    await owner.db.execute(
      sql`update tenants set login_with_email = true where id = ${fresh.tenantId}`,
    );
    const spellings = (local: string) =>
      Array.from(
        { length: 21 },
        (_, i) =>
          [
            `${local}@example.test`,
            `${local[0]?.toUpperCase() ?? ''}${local.slice(1)}@Example.Test`,
            `${local.toUpperCase()}@EXAMPLE.TEST`,
          ][i % 3] ?? '',
      );
    const known = await twentyOne(fresh, spellings('alice'));
    const unknown = await twentyOne(fresh, spellings('ghost'));
    expect(known.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(known.at(-1)).toBe(403);
    expect(unknown).toEqual(known);
  });

  it('[ODUDU-CIBA-CAP-03] gives a person with pending approvals from elsewhere the answer of an unknown one, and no approval', async () => {
    const fresh = await seedCibaWorld(app, 'cap-other');
    await fillApprovals(fresh, fresh.bob.subjectId, 20);
    const known = await authorize(fresh, fresh.agent, { scope: 'openid', login_hint: 'bob' });
    const unknown = await authorize(fresh, fresh.agent, { scope: 'openid', login_hint: 'ghost' });
    expect(known.statusCode).toBe(200);
    expect(Object.keys(known.json<object>()).sort()).toEqual(
      Object.keys(unknown.json<object>()).sort(),
    );
    expect(known.json<Acknowledgement>().expires_in).toBe(
      unknown.json<Acknowledgement>().expires_in,
    );

    const ack = known.json<Acknowledgement>();
    const row = await withTenant(app.db, fresh.tenantId, async (tx) =>
      cibaRequestRepository(tx).byHash(hashAuthReqId(ack.auth_req_id)),
    );
    expect(row?.approvalId).toBeNull();
    const approvals = await owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_approvals where tenant_id = ${fresh.tenantId} and subject_id = ${fresh.bob.subjectId}`,
    );
    expect(approvals[0]?.n).toBe(20);

    clock.advance(6000);
    expect((await poll(fresh, fresh.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'authorization_pending',
    });
    clock.advance(700_000);
    expect((await poll(fresh, fresh.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'expired_token',
    });
  });

  it('[ODUDU-CIBA-CAP-06] leaves one audit row and no mail when the person is at their approval limit', async () => {
    const fresh = await seedCibaWorld(app, 'cap-audit');
    await fillApprovals(fresh, fresh.bob.subjectId, 20);
    const res = await authorize(fresh, fresh.agent, { scope: 'openid', login_hint: 'bob' });
    expect(res.statusCode).toBe(200);
    await withTenant(app.db, fresh.tenantId, async (tx) => {
      const rows = (await auditRepository(tx).list({ limit: 500 })).filter(
        (row) => row.action === 'ciba.requested',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: 'allowed',
        actorSubjectId: fresh.bob.subjectId,
        detail: {
          agent_client: fresh.agent.dbId,
          owner: fresh.bob.subjectId,
          reason: 'approval_limit',
        },
      });
      expect(detailOf(rows[0] ?? {}).approval).toBeUndefined();
    });
    const mail = await owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from email_outbox where tenant_id = ${fresh.tenantId}`,
    );
    expect(mail[0]?.n).toBe(0);
  });

  it('[ODUDU-CIBA-CAP-04] gives the refusal its own sentence', async () => {
    const fresh = await seedCibaWorld(app, 'cap-words');
    const statuses = await twentyOne(fresh, Array(21).fill('alice') as string[]);
    expect(statuses.at(-1)).toBe(403);
    const last = await authorize(fresh, fresh.agent, { scope: 'openid', login_hint: 'alice' });
    expect(last.json<{ error_description: string }>().error_description).not.toBe(
      'The user did not allow the request.',
    );
  });
});

describe('the requests that need care', () => {
  it('[ODUDU-CIBA-HINT-01] refuses a control character in a login hint as an invalid request', async () => {
    for (const hint of ['ali\u0000ce', 'ali\nce', 'ali\u2028ce', 'ali\u202Ece']) {
      const res = await authorize(world, world.agent, { scope: 'openid', login_hint: hint });
      expect(res.statusCode, JSON.stringify(hint)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request' });
    }
  });

  it('[ODUDU-CIBA-HINT-02] resolves a username that holds a zero-width joiner like any other', async () => {
    const joined = 'ra\u200Dmya';
    const subjectId = await withTenant(app.db, world.tenantId, async (tx) => {
      const subject = await subjectRepository(tx).create({
        tenantId: world.tenantId,
        type: 'user',
      });
      await tx
        .insert(users)
        .values({ subjectId: subject.id, tenantId: world.tenantId, username: joined });
      return subject.id;
    });
    const ack = await request(world, { login_hint: joined });
    expect((await approvalOf(world, ack.auth_req_id)).subjectId).toBe(subjectId);
  });

  it('[ODUDU-CIBA-CONF-01] refuses a public client at bc-authorize and at the token endpoint', async () => {
    const res = await authorize(world, null, {
      client_id: world.pub.clientId,
      scope: 'openid',
      login_hint: 'alice',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
    const polled = await http.inject({
      method: 'POST',
      url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
      headers: FORM,
      payload: body({
        grant_type: CIBA_GRANT,
        client_id: world.pub.clientId,
        auth_req_id: 'anything',
      }),
    });
    expect(polled.statusCode).toBe(400);
    expect(polled.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('[ODUDU-CIBA-CONF-10] refuses a client registered over the wire even when its row holds the grant', async () => {
    const res = await authorize(world, world.wire, { scope: 'openid', login_hint: 'alice' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
    const ack = await request(world);
    const polled = await poll(world, world.wire, ack.auth_req_id);
    expect(polled.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('[ODUDU-CIBA-CONF-11] still serves a client an administrator created', async () => {
    const ack = await request(world, { login_hint: 'alice' }, world.agent);
    expect(ack.auth_req_id).toBeTruthy();
  });

  it('[ODUDU-CIBA-CONF-02] refuses a public client even when it holds an id issued to a confidential one', async () => {
    const ack = await request(world);
    const polled = await http.inject({
      method: 'POST',
      url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
      headers: FORM,
      payload: body({
        grant_type: CIBA_GRANT,
        client_id: world.pub.clientId,
        auth_req_id: ack.auth_req_id,
      }),
    });
    expect(polled.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('[OIDC-CIBA-7.1-07] accepts the issuer, the token endpoint or the endpoint itself as the audience of a client assertion', async () => {
    const issuer = (
      await http.inject({ url: `/tenants/${world.tenant}/.well-known/openid-configuration` })
    ).json<{ issuer: string }>().issuer;
    const send = async (audience: string) =>
      http.inject({
        method: 'POST',
        url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
        headers: FORM,
        payload: body({
          scope: 'openid',
          login_hint: 'alice',
          client_assertion_type: CLIENT_ASSERTION_TYPE,
          client_assertion: await signClientAssertion({
            key: world.assertion.key,
            clientId: world.assertion.clientId,
            audience,
            kek: CIBA_KEK,
            now: clock.now(),
          }),
        }),
      });
    for (const audience of [
      issuer,
      `${issuer}/protocol/openid-connect/token`,
      `${issuer}/protocol/openid-connect/bc-authorize`,
    ]) {
      const res = await send(audience);
      expect(res.statusCode, `${audience}: ${res.body}`).toBe(200);
    }
    expect((await send(`${issuer}/protocol/openid-connect/revoke`)).statusCode).toBe(401);
  });
});

describe('polling concurrently', () => {
  it('[ODUDU-CIBA-CONC-01] lets exactly one of two simultaneous polls have the tokens', async () => {
    const ack = await request(world);
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    clock.advance(6000);
    const both = await Promise.all([
      poll(world, world.agent, ack.auth_req_id),
      poll(world, world.agent, ack.auth_req_id),
    ]);
    expect(both.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(both.filter((res) => res.statusCode === 400)).toHaveLength(1);
  });

  it('[ODUDU-CIBA-CONC-02] answers more simultaneous polls than the pool has connections, refusals and signed assertions included', async () => {
    const tiny = createDatabase(appUrl, { max: 2 });
    const server = await startApp(tiny);
    try {
      const issuer = await issuerOf(world);
      const pending = await Promise.all(Array.from({ length: 2 }, () => request(world)));
      const expiring = await Promise.all(
        Array.from({ length: 2 }, () =>
          request(world, { login_hint: 'alice' }, world.agent, { requested_expiry: '30' }),
        ),
      );
      const denied = await Promise.all(
        Array.from({ length: 2 }, async () => {
          const ack = await request(world);
          const row = await approvalOf(world, ack.auth_req_id);
          await decide(world, row.approvalId ?? '', world.alice.subjectId, false);
          return ack;
        }),
      );
      const signed = await Promise.all(
        Array.from({ length: 2 }, async () => {
          const res = await http.inject({
            method: 'POST',
            url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
            headers: FORM,
            payload: body({
              scope: 'openid',
              login_hint: 'alice',
              ...(await assertionFields(`${issuer}/protocol/openid-connect/bc-authorize`)),
            }),
          });
          return res.json<Acknowledgement>();
        }),
      );
      clock.advance(31_000);
      const plain = (ack: Acknowledgement) =>
        server.inject({
          method: 'POST',
          url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
          headers: { ...FORM, ...basic(world.agent) },
          payload: body({ grant_type: CIBA_GRANT, auth_req_id: ack.auth_req_id }),
        });
      const viaAssertion = async (ack: Acknowledgement) =>
        server.inject({
          method: 'POST',
          url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
          headers: FORM,
          payload: body({
            grant_type: CIBA_GRANT,
            auth_req_id: ack.auth_req_id,
            ...(await assertionFields(`${issuer}/protocol/openid-connect/token`)),
          }),
        });
      const answers = await Promise.all([
        ...pending.map(plain),
        ...expiring.map(plain),
        ...denied.map(plain),
        ...signed.map(viaAssertion),
      ]);
      expect(answers.map((res) => res.json<{ error: string }>().error)).toEqual([
        'authorization_pending',
        'authorization_pending',
        'expired_token',
        'expired_token',
        'access_denied',
        'access_denied',
        'authorization_pending',
        'authorization_pending',
      ]);
    } finally {
      await server.close();
      await tiny.close();
    }
  }, 30_000);

  it('[ODUDU-CIBA-CONC-04] answers more simultaneous id_token_hint requests than the pool has connections', async () => {
    const tiny = createDatabase(appUrl, { max: 2 });
    const server = await startApp(tiny);
    try {
      const issuer = await issuerOf(world);
      const hints = await Promise.all(
        Array.from({ length: 6 }, () =>
          signHint(world, issuer, world.agent.clientId, world.alice.subjectId),
        ),
      );
      const answers = await Promise.all(
        hints.map((hint) =>
          server.inject({
            method: 'POST',
            url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
            headers: { ...FORM, ...basic(world.agent) },
            payload: body({ scope: 'openid', id_token_hint: hint }),
          }),
        ),
      );
      expect(answers.map((res) => res.statusCode)).toEqual(Array(6).fill(200));
    } finally {
      await server.close();
      await tiny.close();
    }
  }, 20_000);
});

describe('polling as a client that signs assertions', () => {
  it('[ODUDU-CIBA-CONC-03] records a poll that is refused, so the interval still grows', async () => {
    const issuer = (
      await http.inject({ url: `/tenants/${world.tenant}/.well-known/openid-configuration` })
    ).json<{ issuer: string }>().issuer;
    const assertionFor = async (audience: string) =>
      signClientAssertion({
        key: world.assertion.key,
        clientId: world.assertion.clientId,
        audience,
        kek: CIBA_KEK,
        now: clock.now(),
      });
    const made = await http.inject({
      method: 'POST',
      url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
      headers: FORM,
      payload: body({
        scope: 'openid',
        login_hint: 'alice',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: await assertionFor(`${issuer}/protocol/openid-connect/bc-authorize`),
      }),
    });
    expect(made.statusCode, made.body).toBe(200);
    const ack = made.json<Acknowledgement>();
    const pollSigned = async () =>
      http.inject({
        method: 'POST',
        url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
        headers: FORM,
        payload: body({
          grant_type: CIBA_GRANT,
          auth_req_id: ack.auth_req_id,
          client_assertion_type: CLIENT_ASSERTION_TYPE,
          client_assertion: await signClientAssertion({
            key: world.assertion.key,
            clientId: world.assertion.clientId,
            audience: `${issuer}/protocol/openid-connect/token`,
            kek: CIBA_KEK,
            now: clock.now(),
          }),
        }),
      });
    expect((await pollSigned()).json()).toMatchObject({ error: 'authorization_pending' });
    clock.advance(1000);
    expect((await pollSigned()).json()).toMatchObject({ error: 'slow_down' });
    expect((await approvalOf(world, ack.auth_req_id)).intervalSeconds).toBe(10);
  });
});

describe('what an approval binds', () => {
  async function approvedRequest() {
    const ack = await request(world, { login_hint: 'alice' }, world.agent, {
      binding_message: 'pay the invoice',
    });
    const row = await approvalOf(world, ack.auth_req_id);
    await decide(world, row.approvalId ?? '', world.alice.subjectId, true);
    clock.advance(6000);
    return { ack, row };
  }

  it('[ODUDU-CIBA-BIND-01] is not redeemed once the digest stored with the approval is not the request’s', async () => {
    const { ack, row } = await approvedRequest();
    await owner.db.execute(
      sql`update agent_approvals set action_digest = ${'0'.repeat(64)} where id = ${row.approvalId}`,
    );
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('[ODUDU-CIBA-BIND-02] is not redeemed once the request was altered after it was approved', async () => {
    const { ack } = await approvedRequest();
    await owner.db.execute(
      sql`update ciba_requests set binding_message = 'pay another invoice' where tenant_id = ${world.tenantId} and auth_req_hash = ${hashAuthReqId(ack.auth_req_id)}`,
    );
    expect((await poll(world, world.agent, ack.auth_req_id)).json()).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('[ODUDU-CIBA-BIND-03] is redeemed when nothing was altered', async () => {
    const { ack } = await approvedRequest();
    expect((await poll(world, world.agent, ack.auth_req_id)).statusCode).toBe(200);
  });
});

describe('the request in the audit trail', () => {
  it('[ODUDU-CIBA-AUDIT-01] records a refused request with a reason from the closed list and no hint', async () => {
    const tenantWorld = await seedCibaWorld(app, 'audit');
    for (let i = 0; i < 21; i += 1) {
      await authorize(tenantWorld, tenantWorld.agent, { scope: 'openid', login_hint: 'alice' });
    }
    await withTenant(app.db, tenantWorld.tenantId, async (tx) => {
      const rows = await auditRepository(tx).list({ limit: 500 });
      const refused = rows.find((r) => r.action === 'ciba.requested' && r.outcome === 'refused');
      expect(refused?.detail).toEqual({
        agent_client: tenantWorld.agent.dbId,
        reason: 'rate_limited',
      });
      expect(JSON.stringify(refused)).not.toContain('alice');
    });
  });
});
