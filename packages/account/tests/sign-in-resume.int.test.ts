import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  REUSED_PASSWORD,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { emailOutbox, sendPending, type EmailMessage, type EmailSender } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { desc, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountTestDeps } from '#/testing/support';
import { actionTokenRepository, enqueueResetLink } from '#/index';
import { actionTokens } from '#/schema/action-tokens';
import { pendingRegistrations } from '#/schema/pending-registrations';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type FindHeldSignIn } from '#/service/sign-in-resume';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { registerRegistrationRoute } from '#/view/routes/registration';
import { registerResetPasswordRoute } from '#/view/routes/reset-password';

// What a mailed link may offer back to the browser that opens it. The cookie
// and the parked request belong to @odudu/authn-flows, which this package does
// not import, so the lookup is stood in for by a header naming the held
// sign-in; the real one is exercised end to end in apps/server.

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let sender: EmailSender & { sent: EmailMessage[] };
let lookups: number;

const SESSION = '0192f2a0-0000-7000-8000-0000000000aa';
const OTHER_SESSION = '0192f2a0-0000-7000-8000-0000000000bb';
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new passphrase';
const NO_LINK = 'Return to the application you were signing in to and sign in again.';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

function authorizePath(tenant: string, client = 'console'): string {
  return `/tenants/${tenant}/protocol/openid-connect/auth?response_type=code&client_id=${client}&state=the%20state&nonce=the-nonce`;
}

// `held=<session>` stands for a browser whose cookie names that live sign-in;
// the sign-in's request is the tenant's authorize path for the console.
const findHeldSignIn: FindHeldSignIn = (tenant, header) => {
  lookups += 1;
  const session = /(?:^|; )held=([^;]+)/u.exec(header ?? '')?.[1];
  return Promise.resolve(
    session === undefined
      ? null
      : { sessionId: session, signInPath: authorizePath(tenant.name), clientId: 'console' },
  );
};

async function createAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: { username: string; email: string; password: string },
): Promise<{ subjectId: string }> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId,
    username: input.username,
    email: input.email,
  });
  await credentialRepository(tx).insert({
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashPassword(input.password) },
  });
  return { subjectId: subject.id };
}

async function seedTenant(): Promise<{ id: string; name: string }> {
  const id = newId();
  const name = `resume-${id}`;
  await owner.db.insert(tenants).values({
    id,
    name,
    resetPasswordAllowed: true,
    registrationAllowed: true,
    verifyEmail: true,
  });
  await withTenant(app.db, id, (tx) =>
    createAccount(tx, id, { username: 'ada', email: 'ada@example.test', password: PASSWORD }),
  );
  return { id, name };
}

beforeEach(async () => {
  lookups = 0;
  const sent: EmailMessage[] = [];
  sender = {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
  http = Fastify();
  await http.register(formbody);
  const findTenant = (name: string) => tenantSettingsRepository(owner.db).byName(name);
  registerResetPasswordRoute(http, {
    ...accountTestDeps,
    findHeldSignIn,
    database: app,
    findTenant,
    publicBaseUrl: 'https://idp.example.test',
    now: () => new Date(),
    findByEmail: async (tx, email) => {
      const user = await userRepository(tx).byEmail(email);
      return user?.email == null ? null : { subjectId: user.subjectId, email: user.email };
    },
  });
  registerRegistrationRoute(http, {
    ...accountTestDeps,
    findHeldSignIn,
    database: app,
    findTenant,
    publicBaseUrl: 'https://idp.example.test',
    now: () => new Date(),
    createAccount,
    evaluatePassword,
  });
  registerActionTokenRoute(http, {
    ...accountTestDeps,
    findHeldSignIn,
    database: app,
    findTenant,
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    setPassword: async (tx, subjectId, password) => {
      await credentialRepository(tx).setPassword(subjectId, await hashPassword(password));
    },
    getUsername: async (tx, subjectId) => {
      const user = await userRepository(tx).bySubjectId(subjectId);
      if (user === null) throw new Error(`no user found for subject ${subjectId}`);
      return user.username;
    },
    evaluatePassword,
    unchangedPasswordViolations: async (tx, subjectId, candidate) => {
      const current = await credentialRepository(tx).passwordFor(subjectId);
      if (current === null) return [];
      return (await verifyPassword(current, candidate)) ? [REUSED_PASSWORD] : [];
    },
    clearPasswordUpdateAction: () => Promise.resolve(),
    addRequiredActions: () => Promise.resolve(),
  });
  await http.ready();
});

function form(
  url: string,
  fields: Record<string, string>,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
}

function get(url: string, cookie?: string): Promise<LightMyRequestResponse> {
  return http.inject({ url, ...(cookie === undefined ? {} : { headers: { cookie } }) });
}

async function latestToken(tenantId: string) {
  const rows = await withTenant(app.db, tenantId, (tx) =>
    tx.select().from(actionTokens).orderBy(desc(actionTokens.createdAt)).limit(1),
  );
  return rows[0];
}

async function latestPending(tenantId: string) {
  const rows = await withTenant(app.db, tenantId, (tx) =>
    tx.select().from(pendingRegistrations).orderBy(desc(pendingRegistrations.createdAt)).limit(1),
  );
  return rows[0];
}

async function mailedKey(tenantId: string): Promise<string> {
  await sendPending(
    { database: app, ownerDatabase: owner, resolveSender: () => Promise.resolve(sender) },
    new Date(),
    { batchSize: 10, maxAttempts: 3, retryBackoffSeconds: 60 },
  );
  const message = sender.sent.at(-1);
  const link = /(?:visiting this link|to finish):\n\n(\S+)/u.exec(message?.text ?? '')?.[1];
  if (link === undefined) throw new Error('no link in the mail');
  expect(new URL(link).searchParams.get('return_to')).toBeNull();
  expect([...new URL(link).searchParams.keys()]).toEqual(['key']);
  expect(await withTenant(app.db, tenantId, (tx) => tx.select().from(emailOutbox))).not.toEqual([]);
  return new URL(link).searchParams.get('key') ?? '';
}

const tokenUrl = (tenant: string, key: string): string =>
  `/tenants/${tenant}/login-actions/action-token?key=${encodeURIComponent(key)}`;
const continueLink = (tenant: string): string =>
  `<a href="${authorizePath(tenant).replaceAll('&', '&amp;')}">Continue to sign in</a>`;

beforeEach(async () => {
  await owner.db.delete(emailOutbox);
});

describe('a reset link mailed from a sign-in', () => {
  async function requestReset(
    tenant: { id: string; name: string },
    fields: Record<string, string>,
    cookie?: string,
  ) {
    const res = await form(
      `/tenants/${tenant.name}/login-actions/reset-password`,
      { email: 'ada@example.test', ...fields },
      cookie,
    );
    expect(res.statusCode).toBe(200);
    return mailedKey(tenant.id);
  }

  it('keeps the sign-in beside the token when this browser holds it and the page carried it', async () => {
    const tenant = await seedTenant();
    await requestReset(tenant, { return_to: authorizePath(tenant.name) }, `held=${SESSION}`);
    expect((await latestToken(tenant.id))?.authenticationSessionId).toBe(SESSION);
  });

  it.each([
    ['holds no sign-in', undefined, authorizePath('x')],
    ['carried no request', `held=${SESSION}`, undefined],
    ['carried another request than the held one', `held=${SESSION}`, 'other'],
  ])('names no sign-in when the browser %s', async (_label, cookie, carried) => {
    const tenant = await seedTenant();
    const returnTo =
      carried === undefined
        ? {}
        : {
            return_to:
              carried === 'other'
                ? authorizePath(tenant.name, 'portal')
                : authorizePath(tenant.name),
          };
    await requestReset(tenant, returnTo, cookie);
    expect((await latestToken(tenant.id))?.authenticationSessionId).toBeNull();
  });

  it('does not look for a held sign-in when the page carried no request', async () => {
    const tenant = await seedTenant();
    await requestReset(tenant, {}, `held=${SESSION}`);
    expect(lookups).toBe(0);
  });

  it('answers a known and an unknown address with the same bytes, the lookup made for both', async () => {
    const tenant = await seedTenant();
    const url = `/tenants/${tenant.name}/login-actions/reset-password`;
    const fields = { return_to: authorizePath(tenant.name) };
    const known = await form(url, { email: 'ada@example.test', ...fields }, `held=${SESSION}`);
    const afterKnown = lookups;
    const unknown = await form(url, { email: 'nobody@example.test', ...fields }, `held=${SESSION}`);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(lookups - afterKnown).toBe(afterKnown);
  });

  async function resetThrough(
    tenant: { id: string; name: string },
    key: string,
    cookie?: string,
  ): Promise<LightMyRequestResponse> {
    const page = await get(tokenUrl(tenant.name, key), cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('return_to');
    return form(
      `/tenants/${tenant.name}/login-actions/action-token`,
      { key, password: NEW_PASSWORD },
      cookie,
    );
  }

  it('offers Continue to sign in, the original request, only to the browser that holds the sign-in', async () => {
    const tenant = await seedTenant();
    const key = await requestReset(
      tenant,
      { return_to: authorizePath(tenant.name) },
      `held=${SESSION}`,
    );
    const done = await resetThrough(tenant, key, `held=${SESSION}`);
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain(continueLink(tenant.name));
    expect(done.body).toContain('the%20state');
    expect(done.body).toContain('nonce=the-nonce');
    expect(done.body).not.toContain(NO_LINK);
  });

  it.each([
    ['a different browser, holding no sign-in', undefined],
    ['a browser holding another sign-in', `held=${OTHER_SESSION}`],
  ])('offers no link to %s, and says what to do instead', async (_label, cookie) => {
    const tenant = await seedTenant();
    const key = await requestReset(
      tenant,
      { return_to: authorizePath(tenant.name) },
      `held=${SESSION}`,
    );
    const done = await resetThrough(tenant, key, cookie);
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain('Continue to sign in');
    expect(done.body).not.toContain('<a ');
    expect(done.body).toContain(
      'Return to the application you were signing in to and sign in with your new password.',
    );
  });

  it('offers none for a link no sign-in sent, and never asks which sign-in this browser holds', async () => {
    const tenant = await seedTenant();
    await withTenant(app.db, tenant.id, async (tx) => {
      const user = await userRepository(tx).byEmail('ada@example.test');
      if (user?.email == null) throw new Error('no ada');
      await enqueueResetLink(
        tx,
        {
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantDisplayName: tenant.name,
          issuerBase: 'https://idp.example.test',
          now: () => new Date(),
        },
        { subjectId: user.subjectId, email: user.email },
      );
    });
    const key = await mailedKey(tenant.id);
    lookups = 0;
    const done = await resetThrough(tenant, key, `held=${SESSION}`);
    expect(done.body).not.toContain('Continue to sign in');
    expect(lookups).toBe(0);
  });

  it('ignores a way back the request itself names', async () => {
    const tenant = await seedTenant();
    const key = await requestReset(
      tenant,
      { return_to: authorizePath(tenant.name) },
      `held=${SESSION}`,
    );
    const evil = encodeURIComponent('https://evil.example/x');
    const page = await get(`${tokenUrl(tenant.name, key)}&return_to=${evil}`, `held=${SESSION}`);
    expect(page.body).not.toContain('evil.example');
    const done = await form(
      `/tenants/${tenant.name}/login-actions/action-token`,
      { key, password: NEW_PASSWORD, return_to: 'https://evil.example/x' },
      `held=${SESSION}`,
    );
    expect(done.body).not.toContain('evil.example');
    expect(done.body).toContain(continueLink(tenant.name));
  });

  it('offers the way back from a spent link to the browser that holds the sign-in, and to no other', async () => {
    const tenant = await seedTenant();
    const key = await requestReset(
      tenant,
      { return_to: authorizePath(tenant.name) },
      `held=${SESSION}`,
    );
    await resetThrough(tenant, key, `held=${SESSION}`);

    const replayHeld = await get(tokenUrl(tenant.name, key), `held=${SESSION}`);
    expect(replayHeld.statusCode).toBe(400);
    expect(replayHeld.body).toContain('Back to sign in');
    const replayOther = await get(tokenUrl(tenant.name, key));
    expect(replayOther.statusCode).toBe(400);
    expect(replayOther.body).not.toContain('Back to sign in');
  });

  it('does not sign the person in: the reset changes the password and sets no cookie', async () => {
    const tenant = await seedTenant();
    const key = await requestReset(
      tenant,
      { return_to: authorizePath(tenant.name) },
      `held=${SESSION}`,
    );
    const done = await resetThrough(tenant, key, `held=${SESSION}`);
    expect(done.headers['set-cookie']).toBeUndefined();
  });
});

describe('a verification link mailed from a registration', () => {
  async function register(
    tenant: { id: string; name: string },
    username: string,
    cookie?: string,
  ): Promise<string> {
    const res = await form(
      `/tenants/${tenant.name}/login-actions/registration`,
      {
        username,
        email: `${username}@example.test`,
        password: PASSWORD,
        password_confirm: PASSWORD,
        return_to: authorizePath(tenant.name),
      },
      cookie,
    );
    expect(res.statusCode).toBe(201);
    return mailedKey(tenant.id);
  }

  it('is verified in any browser, and offers Continue to sign in to the one that holds the sign-in', async () => {
    const tenant = await seedTenant();
    const key = await register(tenant, 'grace', `held=${SESSION}`);
    expect((await latestPending(tenant.id))?.authenticationSessionId).toBe(SESSION);

    const held = await form(
      `/tenants/${tenant.name}/login-actions/action-token`,
      { key },
      `held=${SESSION}`,
    );
    expect(held.statusCode).toBe(200);
    expect(held.body).toContain(continueLink(tenant.name));
  });

  it('shows the others the no-link text, with the link still spent', async () => {
    const tenant = await seedTenant();
    const key = await register(tenant, 'hopper', `held=${SESSION}`);
    const other = await form(`/tenants/${tenant.name}/login-actions/action-token`, { key });
    expect(other.statusCode).toBe(200);
    expect(other.body).not.toContain('Continue to sign in');
    expect(other.body).toContain('Return to the application you were signing in to and sign in.');
  });

  it('names no sign-in when the browser holds none', async () => {
    const tenant = await seedTenant();
    await register(tenant, 'curie');
    expect((await latestPending(tenant.id))?.authenticationSessionId).toBeNull();
  });
});

describe('the reference to a sign-in', () => {
  it('is not a column of the token a foreign tenant can read', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const token = await withTenant(app.db, tenantA.id, async (tx) => {
      const user = await userRepository(tx).byEmail('ada@example.test');
      if (user === null) throw new Error('no ada');
      return actionTokenRepository(tx).issue({
        tenantId: tenantA.id,
        subjectId: user.subjectId,
        type: 'reset_password',
        authenticationSessionId: SESSION,
        ttlSeconds: 600,
      });
    });
    const fromB = await withTenant(app.db, tenantB.id, (tx) =>
      actionTokenRepository(tx).describe(token.token),
    );
    expect(fromB).toBeNull();
    const rows = await withTenant(app.db, tenantB.id, (tx) =>
      tx.select().from(actionTokens).where(eq(actionTokens.authenticationSessionId, SESSION)),
    );
    expect(rows).toEqual([]);
  });
});
