import {
  tenants,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
} from '@odudu/db';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, DEFAULT_LOGIN_THROTTLE, DEFAULT_THROTTLE } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// The per-origin throttle, through the real composition root, because what
// it protects is a property of the assembled server: which routes carry it
// and which deliberately do not. The window itself is covered by
// apps/server/src/throttle.test.ts against a fake clock.
//
// Every refusal here is 429. That is what tells a throttle refusal apart
// from the per-account lockout, which answers 200 with the sign-in form —
// see the last test, where both mechanisms fire in one burst.

const PUBLIC_BASE_URL = 'https://idp.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'ada@example.test';

// Two addresses, so "one origin is refused" can be paired with "another is
// not" — without that, a test asserting a 429 would pass on a server that
// refused everything.
const ORIGIN = '198.51.100.7';
const OTHER_ORIGIN = '203.0.113.9';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 11);

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// No `throttle` override: the point is the default every deployment gets.
function buildTestApp(): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    tls: false,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
  });
}

async function setTenantSettings(
  tenantId: string,
  settings: {
    registrationAllowed?: boolean;
    verifyEmail?: boolean;
    resetPasswordAllowed?: boolean;
  },
): Promise<void> {
  await owner.db.update(tenants).set(settings).where(eq(tenants.id, tenantId));
}

function formPost(
  instance: FastifyInstance,
  url: string,
  fields: Record<string, string>,
  remoteAddress: string,
) {
  return instance.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    remoteAddress,
  });
}

async function extractAuthSessionId(
  instance: FastifyInstance,
  tenantName: string,
): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'throttle-app',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const res = await instance.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

describe('the per-origin throttle on the routes that cost CPU', () => {
  it('refuses the eleventh registration from one origin, and leaves another origin alone', async () => {
    const tenantName = `throttle-${newId()}`;
    const seeded = await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
    });
    await setTenantSettings(seeded.tenantId, { registrationAllowed: true, verifyEmail: false });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/registration`;
      const allowed: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        const res = await formPost(
          app,
          url,
          {
            username: `ada-${String(attempt)}`,
            email: `ada-${String(attempt)}@example.test`,
            password: PASSWORD,
            password_confirm: PASSWORD,
          },
          ORIGIN,
        );
        allowed.push(res.statusCode);
      }

      const refused = await formPost(
        app,
        url,
        {
          username: 'ada-over',
          email: 'ada-over@example.test',
          password: PASSWORD,
          password_confirm: PASSWORD,
        },
        ORIGIN,
      );

      // The companion assertion: without it, a hook that refused every
      // request would pass the line above.
      const elsewhere = await formPost(
        app,
        url,
        {
          username: 'bob',
          email: 'bob@example.test',
          password: PASSWORD,
          password_confirm: PASSWORD,
        },
        OTHER_ORIGIN,
      );

      expect(allowed).toEqual(Array.from({ length: DEFAULT_THROTTLE.limit }, () => 201));
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.headers['content-type']).toContain('text/html');
      expect(refused.body).toContain('Too many attempts');
      expect(elsewhere.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('leaves /token unthrottled while throttling the login form beside it', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      clientSecret: 'throttle-secret',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp();
    await app.ready();

    try {
      const authSessionId = await extractAuthSessionId(app, tenantName);
      const login = await formPost(
        app,
        `/tenants/${tenantName}/login-actions/authenticate`,
        { auth_session_id: authSessionId, username: 'ada', password: PASSWORD },
        ORIGIN,
      );
      const code = new URL(String(login.headers.location)).searchParams.get('code');
      if (code === null) throw new Error('no authorization code issued');

      const tokenUrl = `/tenants/${tenantName}/protocol/openid-connect/token`;
      const basic = Buffer.from('throttle-app:throttle-secret').toString('base64');
      const exchange = (grantCode: string) =>
        app.inject({
          method: 'POST',
          url: tokenUrl,
          payload: new URLSearchParams({
            grant_type: 'authorization_code',
            code: grantCode,
            redirect_uri: REDIRECT_URI,
            code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
          }).toString(),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${basic}`,
          },
          remoteAddress: ORIGIN,
        });

      const first = await exchange(code);
      // Well past the budget the login form beside it gets. The code is
      // spent after the first exchange, so these are refused on the grant —
      // which is the point: an OAuth refusal, never a throttle one.
      const burst: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit * 3; attempt += 1) {
        burst.push((await exchange(code)).statusCode);
      }

      expect(first.statusCode).toBe(200);
      expect(burst).not.toContain(429);

      // And the throttle is live on this same app, so "never 429" above is
      // an exemption rather than a hook that never fires.
      const loginUrl = `/tenants/${tenantName}/login-actions/authenticate`;
      const afterwards: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        afterwards.push((await formPost(app, loginUrl, { username: 'ada' }, ORIGIN)).statusCode);
      }
      expect(afterwards).toContain(429);
    } finally {
      await app.close();
    }
  });

  it('refuses a reset request without saying whether the address was one it knows', async () => {
    const tenantName = `throttle-${newId()}`;
    const seeded = await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setTenantSettings(seeded.tenantId, { resetPasswordAllowed: true });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/reset-password`;
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        const res = await formPost(app, url, { email: EMAIL }, ORIGIN);
        expect(res.statusCode).toBe(200);
      }

      const known = await formPost(app, url, { email: EMAIL }, ORIGIN);
      const unknown = await formPost(app, url, { email: 'nobody@example.test' }, ORIGIN);

      expect(known.statusCode).toBe(429);
      expect(known.body).toContain('Too many attempts');
      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.body).toBe(known.body);
      // Both carry one, but not necessarily the same one: two requests
      // either side of a second boundary legitimately differ by a second,
      // and the oracle claim is carried by the three assertions around it.
      expect(Number(unknown.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(known.headers['retry-after'])).toBeGreaterThan(0);
      expect(unknown.headers['content-type']).toBe(known.headers['content-type']);

      // The refusal is the throttle's, not the route's: the same request
      // from another origin is still answered.
      const elsewhere = await formPost(app, url, { email: EMAIL }, OTHER_ORIGIN);
      expect(elsewhere.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('holds an administrator’s mail sends to the self-service budget', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({
      tenant: tenantName,
      clientId: 'throttle-admin-app',
      redirectUris: [REDIRECT_URI],
    });
    const app = buildTestApp();
    await app.ready();

    try {
      const subject = newId();
      const send = (tail: string, remoteAddress: string) =>
        app.inject({
          method: 'POST',
          url: `/admin/tenants/${tenantName}/subjects/${subject}/${tail}`,
          headers: { authorization: 'Bearer not-a-token' },
          remoteAddress,
          ...(tail === 'actions-email' ? { payload: { actions: ['configure-totp'] } } : {}),
        });
      const answered: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        answered.push(
          (
            await send(
              ['password-reset', 'verification', 'actions-email'][attempt % 3] ?? '',
              ORIGIN,
            )
          ).statusCode,
        );
      }
      const refused = await send('actions-email', ORIGIN);
      const elsewhere = await send('verification', OTHER_ORIGIN);

      expect(answered).toEqual(Array.from({ length: DEFAULT_THROTTLE.limit }, () => 401));
      expect(refused.statusCode).toBe(429);
      expect(elsewhere.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('holds the SMTP test message to the same budget, one origin at a time', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({ tenant: tenantName, clientId: 'throttle-smtp', redirectUris: [REDIRECT_URI] });
    const app = buildTestApp();
    await app.ready();
    try {
      const send = (remoteAddress: string) =>
        app.inject({
          method: 'POST',
          url: `/admin/tenants/${tenantName}/smtp/test`,
          headers: { authorization: 'Bearer not-a-token' },
          payload: { to: 'ops@example.test' },
          remoteAddress,
        });
      const answered: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        answered.push((await send(ORIGIN)).statusCode);
      }
      expect(answered).toEqual(Array.from({ length: DEFAULT_THROTTLE.limit }, () => 401));
      expect((await send(ORIGIN)).statusCode).toBe(429);
      expect((await send(OTHER_ORIGIN)).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('leaves the rendered forms alone, throttling only the submissions', async () => {
    const tenantName = `throttle-${newId()}`;
    const seeded = await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
    });
    await setTenantSettings(seeded.tenantId, { registrationAllowed: true });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/registration`;
      const gets: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit * 2; attempt += 1) {
        gets.push((await app.inject({ method: 'GET', url, remoteAddress: ORIGIN })).statusCode);
      }

      expect(gets).not.toContain(429);
      // The same origin, the same path, the throttled method.
      const posted: number[] = [];
      for (let attempt = 0; attempt <= DEFAULT_THROTTLE.limit; attempt += 1) {
        posted.push((await formPost(app, url, { username: 'x' }, ORIGIN)).statusCode);
      }
      expect(posted).toContain(429);
    } finally {
      await app.close();
    }
  });

  // The fixture hazard the lockout creates for any burst of wrong
  // passwords: five failures lock the account, and a locked account is
  // refused with the sign-in form at 200, byte-identical to a wrong
  // password. So a 429 in this burst can only be a throttle, and every
  // 200 in it is one mechanism or the other refusing the credential.
  it('answers 429 where the throttle refuses and 200 where the lockout does', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/authenticate`;
      const statuses: number[] = [];
      for (let attempt = 0; attempt <= DEFAULT_LOGIN_THROTTLE.limit; attempt += 1) {
        const authSessionId = await extractAuthSessionId(app, tenantName);
        const res = await formPost(
          app,
          url,
          { auth_session_id: authSessionId, username: 'ada', password: 'wrong' },
          ORIGIN,
        );
        statuses.push(res.statusCode);
      }

      // The fifth wrong password locks the account and is still answered
      // with the form; the sixth submission for this username from this
      // address is over the per-username budget.
      expect(statuses.slice(0, DEFAULT_LOGIN_THROTTLE.limit)).toEqual(
        Array.from({ length: DEFAULT_LOGIN_THROTTLE.limit }, () => 200),
      );
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await app.close();
    }
  });

  // The per-username budget keys on the submitted string, so spending it on
  // a name that is an account and on one that is not must be
  // indistinguishable from outside — the reason ADR 0023 decides it before
  // any lookup.
  it('refuses a username that is an account in the same bytes as one that is not', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/authenticate`;
      const refuseAfterBudget = async (username: string, origin: string) => {
        let last = await formPost(app, url, { username, password: 'wrong' }, origin);
        for (let attempt = 1; attempt <= DEFAULT_LOGIN_THROTTLE.limit; attempt += 1) {
          last = await formPost(app, url, { username, password: 'wrong' }, origin);
        }
        return last;
      };

      // Each from its own address, so neither spends the other's per-origin
      // budget and the only refusal on offer is the per-username one.
      const account = await refuseAfterBudget('ada', ORIGIN);
      const stranger = await refuseAfterBudget('nobody', OTHER_ORIGIN);

      expect(account.statusCode).toBe(429);
      expect(stranger.statusCode).toBe(429);
      const seconds = (body: string) => body.replace(/\d+ seconds?/u, 'N seconds');
      expect(seconds(stranger.body)).toBe(seconds(account.body));
      expect(account.body).toContain('Too many attempts');
      expect(stranger.headers['content-length']).toBe(account.headers['content-length']);
      expect(stranger.headers['content-type']).toBe(account.headers['content-type']);
      expect(
        Math.abs(Number(stranger.headers['retry-after']) - Number(account.headers['retry-after'])),
      ).toBeLessThanOrEqual(1);

      // The refusal is for that username from that address, not for the
      // whole origin: another account is still answered, by the route
      // rather than the throttle.
      const neighbour = await formPost(
        app,
        url,
        { username: 'someone-else', password: 'wrong' },
        ORIGIN,
      );
      expect(neighbour.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });

  // A repeated field parses to an array; the route reads it as absent, and
  // the per-username budget has no key for it, so the two agree: a
  // submission naming `ada` twice attempts no account, however many are
  // sent, and costs ada neither a lockout nor the budget of a real attempt.
  it('treats a repeated username as no attempt at any account', async () => {
    const tenantName = `throttle-${newId()}`;
    await seed({
      tenant: tenantName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp();
    await app.ready();

    try {
      const url = `/tenants/${tenantName}/login-actions/authenticate`;
      const attempts = DEFAULT_LOGIN_THROTTLE.limit + 2;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const authSessionId = await extractAuthSessionId(app, tenantName);
        const res = await app.inject({
          method: 'POST',
          url,
          payload: `auth_session_id=${authSessionId}&username=ada&username=x&password=${encodeURIComponent(PASSWORD)}`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          remoteAddress: ORIGIN,
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers.location).toBeUndefined();
      }

      const authSessionId = await extractAuthSessionId(app, tenantName);
      const single = await formPost(
        app,
        url,
        { auth_session_id: authSessionId, username: 'ada', password: PASSWORD },
        ORIGIN,
      );
      expect(single.statusCode).toBe(302);
    } finally {
      await app.close();
    }
  });
});
