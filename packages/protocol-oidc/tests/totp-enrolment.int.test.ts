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
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
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
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK, clock }));
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
    expect(
      await withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId)),
    ).toEqual([]);

    // The enrolment's own code spent its time step, so the login's second
    // factor needs the next one.
    clock.advance(31_000);
    const challenged = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(challenged.statusCode).toBe(200);
    expect(challenged.body).toContain('name="code"');
    expect(challenged.body).not.toContain('name="username"');

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
