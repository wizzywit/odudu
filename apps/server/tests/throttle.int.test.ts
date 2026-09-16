import {
  realms,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
} from '@odudu/db';
import { capturingSender } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, DEFAULT_THROTTLE } from '#/app';
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
function buildTestApp(sender: ReturnType<typeof capturingSender>): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    sender,
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
  });
}

async function setRealmSettings(
  realmId: string,
  settings: {
    registrationAllowed?: boolean;
    verifyEmail?: boolean;
    resetPasswordAllowed?: boolean;
  },
): Promise<void> {
  await owner.db.update(realms).set(settings).where(eq(realms.id, realmId));
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

async function extractAuthSessionId(instance: FastifyInstance, realmName: string): Promise<string> {
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
    url: `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

describe('the per-origin throttle on the routes that cost CPU', () => {
  it('refuses the eleventh registration from one origin, and leaves another origin alone', async () => {
    const realmName = `throttle-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true, verifyEmail: false });

    const app = buildTestApp(capturingSender());
    await app.ready();

    try {
      const url = `/realms/${realmName}/login-actions/registration`;
      const allowed: number[] = [];
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        const res = await formPost(
          app,
          url,
          {
            username: `ada-${String(attempt)}`,
            email: `ada-${String(attempt)}@example.test`,
            password: PASSWORD,
          },
          ORIGIN,
        );
        allowed.push(res.statusCode);
      }

      const refused = await formPost(
        app,
        url,
        { username: 'ada-over', email: 'ada-over@example.test', password: PASSWORD },
        ORIGIN,
      );

      // The companion assertion: without it, a hook that refused every
      // request would pass the line above.
      const elsewhere = await formPost(
        app,
        url,
        { username: 'bob', email: 'bob@example.test', password: PASSWORD },
        OTHER_ORIGIN,
      );

      expect(allowed).toEqual(Array.from({ length: DEFAULT_THROTTLE.limit }, () => 201));
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(elsewhere.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('leaves /token unthrottled while throttling the login form beside it', async () => {
    const realmName = `throttle-${newId()}`;
    await seed({
      realm: realmName,
      clientId: 'throttle-app',
      clientSecret: 'throttle-secret',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp(capturingSender());
    await app.ready();

    try {
      const authSessionId = await extractAuthSessionId(app, realmName);
      const login = await formPost(
        app,
        `/realms/${realmName}/login-actions/authenticate`,
        { auth_session_id: authSessionId, username: 'ada', password: PASSWORD },
        ORIGIN,
      );
      const code = new URL(String(login.headers.location)).searchParams.get('code');
      if (code === null) throw new Error('no authorization code issued');

      const tokenUrl = `/realms/${realmName}/protocol/openid-connect/token`;
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
      const loginUrl = `/realms/${realmName}/login-actions/authenticate`;
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
    const realmName = `throttle-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setRealmSettings(seeded.realmId, { resetPasswordAllowed: true });

    const app = buildTestApp(capturingSender());
    await app.ready();

    try {
      const url = `/realms/${realmName}/login-actions/reset-password`;
      for (let attempt = 0; attempt < DEFAULT_THROTTLE.limit; attempt += 1) {
        const res = await formPost(app, url, { email: EMAIL }, ORIGIN);
        expect(res.statusCode).toBe(200);
      }

      const known = await formPost(app, url, { email: EMAIL }, ORIGIN);
      const unknown = await formPost(app, url, { email: 'nobody@example.test' }, ORIGIN);

      expect(known.statusCode).toBe(429);
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

  it('leaves the rendered forms alone, throttling only the submissions', async () => {
    const realmName = `throttle-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true });

    const app = buildTestApp(capturingSender());
    await app.ready();

    try {
      const url = `/realms/${realmName}/login-actions/registration`;
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
  // password. So a 429 in this burst can only be the throttle, and every
  // 200 in it is one mechanism or the other refusing the credential.
  it('answers 429 where the throttle refuses and 200 where the lockout does', async () => {
    const realmName = `throttle-${newId()}`;
    await seed({
      realm: realmName,
      clientId: 'throttle-app',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });

    const app = buildTestApp(capturingSender());
    await app.ready();

    try {
      const url = `/realms/${realmName}/login-actions/authenticate`;
      const statuses: number[] = [];
      for (let attempt = 0; attempt <= DEFAULT_THROTTLE.limit; attempt += 1) {
        const authSessionId = await extractAuthSessionId(app, realmName);
        const res = await formPost(
          app,
          url,
          { auth_session_id: authSessionId, username: 'ada', password: 'wrong' },
          ORIGIN,
        );
        statuses.push(res.statusCode);
      }

      expect(statuses.slice(0, DEFAULT_THROTTLE.limit)).toEqual(
        Array.from({ length: DEFAULT_THROTTLE.limit }, () => 200),
      );
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await app.close();
    }
  });
});
