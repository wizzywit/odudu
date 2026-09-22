import { generateSigningKey, signingKeys, totpCode, totpCounter } from '@odudu/crypto';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  users,
} from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { provisionRealm, requiredActionRepository } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'totp-enrolment-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Every code in this file is generated against this clock, and the routes
// read it too, so "the next time step" is exact rather than a 30-second wait.
const clock = new FakeClock(new Date('2031-01-01T00:00:00.000Z'));

async function setupRealm(name: string, otpRequired: boolean): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name, otpRequired });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'totp enrolment test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await credentialRepository(tx).insert({
      realmId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });

    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });
  return realmId;
}

function authorizeUrl(realmName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/realms/${realmName}/protocol/openid-connect/auth?${params.toString()}`;
}

async function startAuthSession(realmName: string): Promise<string> {
  const authorize = await http.inject({ url: authorizeUrl(realmName) });
  expect(authorize.statusCode).toBe(200);
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');
  return authSessionId;
}

function post(url: string, fields: Record<string, string>): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function login(realmName: string, fields: Record<string, string>) {
  return post(`/realms/${realmName}/login-actions/authenticate`, fields);
}

function enrolmentPost(realmName: string, action: string, fields: Record<string, string>) {
  return post(
    `/realms/${realmName}/login-actions/required-action?action=${encodeURIComponent(action)}`,
    fields,
  );
}

function offeredSecret(body: string): string {
  const match = /name="secret" value="([^"]*)"/.exec(body);
  const secret = match?.[1];
  if (secret === undefined) throw new Error('no secret offered on the enrolment page');
  return secret;
}

async function subjectIdOf(realmId: string): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const rows = await tx.select().from(users);
    const row = rows[0];
    if (row === undefined) throw new Error('expected the seeded user');
    return row.subjectId;
  });
}

function offeredCodes(body: string): string[] {
  const codes = [
    ...body.matchAll(/<code>([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})<\/code>/gu),
  ].map((match) => match[1] ?? '');
  if (codes.length === 0) throw new Error('no recovery codes on the page');
  return codes;
}

function storedTotp(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) => credentialRepository(tx).listFor(subjectId, 'totp'));
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;

  http = Fastify();
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('enrolling the second factor a realm asked for', () => {
  it('offers a secret, stores it only once a code proves it, and finishes the login', async () => {
    const realmName = `totp-enrol-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    const authSessionId = await startAuthSession(realmName);

    // The password is right and the login still does not finish: no cookie,
    // no redirect, an enrolment page instead.
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.headers['set-cookie']).toBeUndefined();
    expect(owed.body).toContain('otpauth://totp/');
    const secret = offeredSecret(owed.body);
    expect(await storedTotp(realmId, subjectId)).toEqual([]);

    const wrong = await enrolmentPost(realmName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: '000000',
    });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.body).toContain('Set up your authenticator');
    expect(await storedTotp(realmId, subjectId)).toEqual([]);

    const enrolled = await enrolmentPost(realmName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.body).toContain('name="password"');
    expect(await storedTotp(realmId, subjectId)).toHaveLength(1);
    // The factor is enrolled and a recovery path for it is now owed: a
    // second factor nobody can produce any more is a locked-out account.
    expect(
      await withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId)),
    ).toEqual(['generate-recovery-codes']);

    // The enrolment's own code spent its time step, so the login's second
    // factor needs the next one.
    clock.advance(31_000);
    const secondFactor = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(secondFactor.statusCode).toBe(200);
    expect(secondFactor.body).toContain('name="code"');
    // Beside the app's code, not behind a second page: somebody reaching
    // for a recovery code has already lost what the first field asks for.
    expect(secondFactor.body).toContain('name="recovery_code"');

    // The second factor is satisfied, so now the owed action is reached:
    // the codes, shown once, with no cookie and no code issued.
    const codesOwed = await login(realmName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(codesOwed.statusCode).toBe(200);
    expect(codesOwed.headers['set-cookie']).toBeUndefined();
    expect(codesOwed.body).toContain('Save your recovery codes');
    expect(codesOwed.body).toContain('only time they are shown');

    const acknowledged = await enrolmentPost(realmName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });
    expect(acknowledged.statusCode).toBe(200);
    // The password this attempt already satisfied is not asked for again:
    // what the parked login is still waiting on is the code.
    expect(acknowledged.body).toContain('name="code"');
    expect(acknowledged.body).not.toContain('name="username"');
    expect(
      await withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId)),
    ).toEqual([]);

    // The code above spent its time step, so the login's second factor
    // needs the next one (RFC 6238 §5.2).
    clock.advance(31_000);
    const completed = await login(realmName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(completed.statusCode).toBe(302);
    const location = completed.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('code')).toBeTruthy();
  });

  // Passing the password step is permission to finish the login that asked
  // for it, not permission to attach an authenticator to the account. A
  // stolen password would otherwise buy a TOTP credential that applies to
  // every later login and survives the password reset that ends the
  // compromise.
  it('refuses to enrol anything for a subject who owes no action', async () => {
    const realmName = `totp-unasked-${newId()}`;
    const realmId = await setupRealm(realmName, false);
    const subjectId = await subjectIdOf(realmId);
    const authSessionId = await startAuthSession(realmName);

    // A login that completed: nothing is pending, and the attempt is bound
    // to the subject who just authenticated.
    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(302);

    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const refused = await enrolmentPost(realmName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });

    expect(refused.statusCode).toBe(400);
    expect(await storedTotp(realmId, subjectId)).toEqual([]);
  });

  it('refuses a submission carrying no authentication session', async () => {
    const realmName = `totp-nosession-${newId()}`;
    await setupRealm(realmName, true);

    const refused = await enrolmentPost(realmName, 'configure-totp', {
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      code: '000000',
    });

    expect(refused.statusCode).toBe(400);
  });

  // The same shape guard the login form's own field gets: Postgres raises
  // on a `uuid` comparison against a value it cannot parse, and this
  // endpoint takes the field from a form too.
  it('refuses a malformed authentication session id as unknown, not as a server fault', async () => {
    const realmName = `totp-badsession-${newId()}`;
    await setupRealm(realmName, true);

    for (const malformed of ['not-a-uuid', `${newId()}\n${newId()}`, `${newId()}' or '1'='1`]) {
      const refused = await enrolmentPost(realmName, 'configure-totp', {
        auth_session_id: malformed,
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        code: '000000',
      });
      expect(`${JSON.stringify(malformed)}: ${String(refused.statusCode)}`).toBe(
        `${JSON.stringify(malformed)}: 400`,
      );
    }
  });

  it('refuses an owed action it has no submission for', async () => {
    const realmName = `totp-unsupported-${newId()}`;
    const realmId = await setupRealm(realmName, false);
    const subjectId = await subjectIdOf(realmId);
    await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).add(realmId, subjectId, 'configure-passkey'),
    );
    const authSessionId = await startAuthSession(realmName);
    await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });

    const refused = await enrolmentPost(realmName, 'configure-passkey', {
      auth_session_id: authSessionId,
    });

    expect(refused.statusCode).toBe(400);
  });
});

// The page and the browser are where the difference between "never issued"
// and "already spent" actually reaches somebody: the flow engine reports
// them apart, and this is the one path that shows it does.
describe('signing in with a recovery code instead of the second factor', () => {
  it('spends a code once, then says that code is spent', async () => {
    const realmName = `recovery-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    const enrolling = await startAuthSession(realmName);

    const owed = await login(realmName, {
      auth_session_id: enrolling,
      username: USERNAME,
      password: PASSWORD,
    });
    const secret = offeredSecret(owed.body);
    await enrolmentPost(realmName, 'configure-totp', {
      auth_session_id: enrolling,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    clock.advance(31_000);
    await login(realmName, { auth_session_id: enrolling, username: USERNAME, password: PASSWORD });
    const shown = await login(realmName, {
      auth_session_id: enrolling,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    const codes = offeredCodes(shown.body);
    expect(codes).toHaveLength(10);
    await enrolmentPost(realmName, 'generate-recovery-codes', { auth_session_id: enrolling });

    // A fresh attempt: the authenticator is gone, and the code form's second
    // field is the way back in.
    const authSessionId = await startAuthSession(realmName);
    await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      recovery_code: codes[0] ?? '',
    });
    expect(signedIn.statusCode).toBe(302);
    expect(String(signedIn.headers['set-cookie'])).toContain(`${realmName}-session=`);
    expect(String(signedIn.headers.location)).toContain('code=');

    const replay = await startAuthSession(realmName);
    await login(realmName, { auth_session_id: replay, username: USERNAME, password: PASSWORD });
    const refused = await login(realmName, {
      auth_session_id: replay,
      recovery_code: codes[0] ?? '',
    });
    expect(refused.statusCode).toBe(200);
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(refused.body).toContain('already used that recovery code');

    // An unknown code says nothing of the sort: which codes a list holds is
    // not something a wrong guess should report on.
    const unknown = await login(realmName, {
      auth_session_id: replay,
      recovery_code: 'ZZZZZ-ZZZZZ',
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body).not.toContain('already used');
    expect(
      await withRealm(app.db, realmId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'recovery-code'),
      ),
    ).toHaveLength(10);
  });
});
