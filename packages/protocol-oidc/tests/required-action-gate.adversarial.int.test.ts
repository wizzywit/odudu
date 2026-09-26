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
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant, requiredActionRepository, sessions } from '@odudu/authn-flows';
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
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'required-action-gate-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const clock = new FakeClock(new Date('2031-01-01T00:00:00.000Z'));

async function setupTenant(
  name: string,
  otpRequired: boolean,
  consentRequired = false,
  verifyEmail = false,
): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name, otpRequired, verifyEmail });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'required action gate test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      consentRequired,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });

    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });
  return tenantId;
}

function authorizeUrl(tenantName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

async function startAuthSession(tenantName: string): Promise<string> {
  const authorize = await http.inject({ url: authorizeUrl(tenantName) });
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

function login(tenantName: string, fields: Record<string, string>) {
  return post(`/tenants/${tenantName}/login-actions/authenticate`, fields);
}

function actionPost(tenantName: string, action: string, fields: Record<string, string>) {
  return post(
    `/tenants/${tenantName}/login-actions/required-action?action=${encodeURIComponent(action)}`,
    fields,
  );
}

function consentPost(tenantName: string, fields: Record<string, string>) {
  return post(`/tenants/${tenantName}/login-actions/consent`, fields);
}

async function sessionCount(tenantId: string): Promise<number> {
  const rows = await withTenant(app.db, tenantId, (tx) => tx.select().from(sessions));
  return rows.length;
}

function offeredSecret(body: string): string {
  const match = /name="secret" value="([^"]*)"/.exec(body);
  const secret = match?.[1];
  if (secret === undefined) throw new Error('no secret offered on the enrolment page');
  return secret;
}

function codesOn(body: string): string[] {
  return [...body.matchAll(/<code>([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})<\/code>/gu)].map(
    (match) => match[1] ?? '',
  );
}

async function subjectIdOf(tenantId: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const rows = await tx.select().from(users);
    const row = rows[0];
    if (row === undefined) throw new Error('expected the seeded user');
    return row.subjectId;
  });
}

// The rows themselves, by id, not their count: a regeneration writes ten
// fresh rows and deletes ten old ones, which a length assertion cannot see.
async function storedCodeIds(tenantId: string, subjectId: string): Promise<string[]> {
  const held = await withTenant(app.db, tenantId, (tx) =>
    credentialRepository(tx).listFor(subjectId, 'recovery-code'),
  );
  return held.map((credential) => credential.id).sort();
}

function pendingFor(tenantId: string, subjectId: string) {
  return withTenant(app.db, tenantId, (tx) => requiredActionRepository(tx).pendingFor(subjectId));
}

function storedPassword(tenantId: string, subjectId: string) {
  return withTenant(app.db, tenantId, (tx) => credentialRepository(tx).passwordFor(subjectId));
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
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
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

// Enrols the second factor and stops there — which is one closed tab, not
// an unusual sequence. Completing configure-totp asks for recovery codes,
// and the page that writes them sits behind the second factor, so the
// account is left owing the action and holding no codes at all.
async function abandonAfterTotpEnrolment(tenantName: string): Promise<string> {
  const authSessionId = await startAuthSession(tenantName);
  const owed = await login(tenantName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const secret = offeredSecret(owed.body);
  const enrolled = await actionPost(tenantName, 'configure-totp', {
    auth_session_id: authSessionId,
    secret,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  expect(enrolled.statusCode).toBe(200);
  return secret;
}

// Leaves the tenant's only account in the state an abandoned enrolment
// produces: a TOTP credential, ten recovery codes written by the page that
// displayed them, and generate-recovery-codes still owed because nobody
// acknowledged that page. Returns the codes it saw, so a later assertion
// can tell the same set from a replacement.
async function abandonRecoveryCodePage(
  tenantName: string,
): Promise<{ secret: string; codes: string[] }> {
  const authSessionId = await startAuthSession(tenantName);
  const owed = await login(tenantName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const secret = offeredSecret(owed.body);
  await actionPost(tenantName, 'configure-totp', {
    auth_session_id: authSessionId,
    secret,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  clock.advance(31_000);
  await login(tenantName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const shown = await login(tenantName, {
    auth_session_id: authSessionId,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  const codes = codesOn(shown.body);
  expect(codes).toHaveLength(10);
  return { secret, codes };
}

// Signs the account in properly — password then code — and acknowledges the
// codes the abandoned page left owed, so the account ends up holding a saved
// set and owing nothing.
async function settleOwedRecoveryCodes(tenantName: string, secret: string): Promise<void> {
  clock.advance(31_000);
  const authSessionId = await startAuthSession(tenantName);
  await login(tenantName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const owed = await login(tenantName, {
    auth_session_id: authSessionId,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  expect(owed.body).toContain('Save your recovery codes');
  const acknowledged = await actionPost(tenantName, 'generate-recovery-codes', {
    auth_session_id: authSessionId,
  });
  expect(acknowledged.statusCode).toBe(200);
}

describe('a required action is not satisfiable before the login that owes it is complete', () => {
  // The bypass this gate exists to close. A password alone binds the
  // attempt to a subject and the browser gets that same auth_session_id
  // back on the code form; posting it to the required-action endpoint used
  // to reach the page that issues recovery codes, and a recovery code
  // stands in for the second factor. Ten of them, printed to whoever holds
  // the password, is the second factor handed over.
  it('hands over no recovery codes to a session still owing its second factor', async () => {
    const tenantName = `gate-bypass-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);
    const secret = await abandonAfterTotpEnrolment(tenantName);
    expect(await pendingFor(tenantId, subjectId)).toEqual(['generate-recovery-codes']);
    expect(await storedCodeIds(tenantId, subjectId)).toEqual([]);

    clock.advance(31_000);
    const attacker = await startAuthSession(tenantName);
    const firstFactor = await login(tenantName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.statusCode).toBe(200);
    expect(firstFactor.body).toContain('name="code"');

    const bypass = await actionPost(tenantName, 'generate-recovery-codes', {
      auth_session_id: attacker,
    });

    // Asserted before the status code, so a regression reports the codes it
    // handed out rather than the number 200: no codes on the page and none
    // in the database, which a status assertion alone cannot tell apart
    // from a refusal that issued them anyway.
    expect(codesOn(bypass.body)).toEqual([]);
    expect(await storedCodeIds(tenantId, subjectId)).toEqual([]);
    expect(bypass.statusCode).toBe(400);
    expect(bypass.body).toContain('no longer valid');
    expect(await pendingFor(tenantId, subjectId)).toEqual(['generate-recovery-codes']);

    // And the second factor is still the second factor: the code the
    // account's own authenticator produces finishes this login, and the
    // refused request changed nothing about that.
    clock.advance(31_000);
    const withTheRealFactor = await login(tenantName, {
      auth_session_id: attacker,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(withTheRealFactor.statusCode).toBe(200);
    expect(withTheRealFactor.body).toContain('Save your recovery codes');
  });

  // The same refusal against the other reachable state: the codes were
  // issued by the page and the acknowledgement never arrived, so the account
  // owes the action *and* holds a set. No codes are leaked here even without
  // the gate — the acknowledgement finds the ten and succeeds, rather than
  // reaching the page that issues them — so what a password alone bought was
  // clearing the action on the owner's behalf. This test's job is that the
  // stored set comes through untouched, which only an assertion on the rows
  // themselves can say.
  it('refuses generate-recovery-codes from a session still owing its second factor', async () => {
    const tenantName = `gate-recovery-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);
    await abandonRecoveryCodePage(tenantName);
    const before = await storedCodeIds(tenantId, subjectId);
    expect(before).toHaveLength(10);
    expect(await pendingFor(tenantId, subjectId)).toEqual(['generate-recovery-codes']);

    clock.advance(31_000);
    const attacker = await startAuthSession(tenantName);
    const firstFactor = await login(tenantName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.statusCode).toBe(200);
    expect(firstFactor.body).toContain('name="code"');

    const bypass = await actionPost(tenantName, 'generate-recovery-codes', {
      auth_session_id: attacker,
    });

    expect(bypass.statusCode).toBe(400);
    expect(bypass.body).toContain('no longer valid');
    expect(codesOn(bypass.body)).toEqual([]);
    // The same ten rows, by id rather than by count: a regeneration writes
    // ten and deletes ten, which a length assertion cannot see.
    expect(await storedCodeIds(tenantId, subjectId)).toEqual(before);
    // And the action is still owed — it is the owner's to complete.
    expect(await pendingFor(tenantId, subjectId)).toEqual(['generate-recovery-codes']);

    // And the parked login is exactly where it was: still asking for the
    // factor the refused request tried to walk around.
    const stillOwed = await login(tenantName, { auth_session_id: attacker });
    expect(stillOwed.statusCode).toBe(200);
    expect(stillOwed.headers['set-cookie']).toBeUndefined();
    expect(stillOwed.body).toContain('name="code"');
  });

  // An expired password is the one required action an attacker who stole
  // that password most wants: setting a new one from a session that has not
  // passed the second factor would lock the owner out of their own account
  // with the thief's password in force.
  it('refuses update-password from a session still owing its second factor', async () => {
    const tenantName = `gate-password-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);
    const { secret } = await abandonRecoveryCodePage(tenantName);
    await settleOwedRecoveryCodes(tenantName, secret);
    expect(await pendingFor(tenantId, subjectId)).toEqual([]);
    await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).add(tenantId, subjectId, 'update-password'),
    );
    const before = await storedPassword(tenantId, subjectId);

    clock.advance(31_000);
    const attacker = await startAuthSession(tenantName);
    const firstFactor = await login(tenantName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.body).toContain('name="code"');

    const refused = await actionPost(tenantName, 'update-password', {
      auth_session_id: attacker,
      password: 'a password only the thief knows',
    });

    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');
    expect(await storedPassword(tenantId, subjectId)).toBe(before);
    expect(await pendingFor(tenantId, subjectId)).toEqual(['update-password']);
  });

  // The order the actions run in is the reason an expired password cannot
  // be used to enrol a second factor, and it has to bind where submissions
  // are judged, not only where pages are rendered.
  it('refuses an owed action that is not the one the login owes next', async () => {
    const tenantName = `gate-order-${newId()}`;
    const tenantId = await setupTenant(tenantName, false);
    const subjectId = await subjectIdOf(tenantId);
    await withTenant(app.db, tenantId, async (tx) => {
      await requiredActionRepository(tx).add(tenantId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(tenantId, subjectId, 'configure-passkey');
    });

    const authSessionId = await startAuthSession(tenantName);
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.body).toContain('Change your password');

    const refused = await actionPost(tenantName, 'configure-passkey', {
      auth_session_id: authSessionId,
    });

    // The message is the evidence of which check fired: an action this
    // deployment cannot complete at all answers with a different one, so a
    // bare 400 would not tell the ordering gate from that.
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no such pending action');
    expect(await pendingFor(tenantId, subjectId)).toEqual(
      expect.arrayContaining(['update-password', 'configure-passkey']),
    );
  });

  // The same ordering hole, with the effect the previous case cannot show:
  // this one would have written ten recovery codes and shown them, from a
  // session whose first owed action is still the password change.
  it('issues no recovery codes for an owed action taken out of turn', async () => {
    const tenantName = `gate-order-codes-${newId()}`;
    const tenantId = await setupTenant(tenantName, false);
    const subjectId = await subjectIdOf(tenantId);
    await withTenant(app.db, tenantId, async (tx) => {
      await requiredActionRepository(tx).add(tenantId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(tenantId, subjectId, 'generate-recovery-codes');
    });

    const authSessionId = await startAuthSession(tenantName);
    await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });

    const refused = await actionPost(tenantName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no such pending action');
    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(tenantId, subjectId)).toEqual([]);
  });

  // The gate rests on a record of completion, and that record has to move
  // back. Enrolling the factor a tenant asked for makes the OTP step apply to
  // a session that had nothing left to pass, so re-running the login parks
  // it on a challenge again — and the action owed after the enrolment must
  // wait for that challenge. A record that only ever moved forwards would
  // still call this attempt finished, for as long as the session lives.
  it('stops treating a session as finished once an enrolment makes a factor apply', async () => {
    const tenantName = `gate-reapplies-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);

    // The login completes on the password alone: otp_required, and no
    // credential that could produce a code.
    const authSessionId = await startAuthSession(tenantName);
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const secret = offeredSecret(owed.body);
    const enrolled = await actionPost(tenantName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(enrolled.statusCode).toBe(200);
    expect(await pendingFor(tenantId, subjectId)).toEqual(['generate-recovery-codes']);

    // Same session, login re-run: now there is a code to ask for.
    clock.advance(31_000);
    const challenged = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(challenged.body).toContain('name="code"');

    const refused = await actionPost(tenantName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(tenantId, subjectId)).toEqual([]);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');

    // Passing the code is what makes the action reachable, and then it is.
    clock.advance(31_000);
    const reached = await login(tenantName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(reached.body).toContain('Save your recovery codes');
    expect(await storedCodeIds(tenantId, subjectId)).toHaveLength(10);
  });

  // A session that has already driven a login to an authorization code is
  // spent. Whatever it owed was owed before that, so an action arriving
  // against it afterwards is a form the browser still had open — and the
  // code it minted is not a licence to keep changing the account.
  it('refuses an action against a session already spent on a login', async () => {
    const tenantName = `gate-consumed-${newId()}`;
    const tenantId = await setupTenant(tenantName, false);
    const subjectId = await subjectIdOf(tenantId);

    const authSessionId = await startAuthSession(tenantName);
    const signedIn = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(302);
    await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).add(tenantId, subjectId, 'generate-recovery-codes'),
    );

    const refused = await actionPost(tenantName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(tenantId, subjectId)).toEqual([]);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');
  });

  // The mechanism's reason for existing: a tenant that turns otp_required on
  // owes configure-totp to a subject with no TOTP credential, and no OTP
  // step can apply to them — there is no code they could produce. That
  // login is complete, so the enrolment it asks for stays submittable.
  it('accepts configure-totp from a subject who has no second factor to pass', async () => {
    const tenantName = `gate-enrol-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);

    const authSessionId = await startAuthSession(tenantName);
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.body).toContain('otpauth://totp/');
    const secret = offeredSecret(owed.body);

    clock.advance(31_000);
    const enrolled = await actionPost(tenantName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });

    expect(enrolled.statusCode).toBe(200);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'totp'),
      ),
    ).toHaveLength(1);
  });

  // The other side of the update-password refusal above: once the second
  // factor the tenant requires has actually been passed, the password change
  // an aged-out password owes goes through. An expired password must not be
  // a lockout, only a login that cannot complete until it is changed.
  it('accepts update-password once the second factor has been passed', async () => {
    const tenantName = `gate-password-ok-${newId()}`;
    const tenantId = await setupTenant(tenantName, true);
    const subjectId = await subjectIdOf(tenantId);
    const { secret } = await abandonRecoveryCodePage(tenantName);
    await settleOwedRecoveryCodes(tenantName, secret);
    await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).add(tenantId, subjectId, 'update-password'),
    );
    const before = await storedPassword(tenantId, subjectId);

    clock.advance(31_000);
    const authSessionId = await startAuthSession(tenantName);
    await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(owed.body).toContain('Change your password');

    const changed = await actionPost(tenantName, 'update-password', {
      auth_session_id: authSessionId,
      password: 'a considerably better passphrase than the old one',
    });

    expect(changed.statusCode).toBe(200);
    expect(await pendingFor(tenantId, subjectId)).toEqual([]);
    expect(await storedPassword(tenantId, subjectId)).not.toBe(before);
  });

  // The third door onto the same gate. A client that requires consent parks
  // the request on the same auth_session_id whether the login form or the
  // consent endpoint is what eventually resumes it, so an owed action must
  // refuse a decision=allow posted straight at /login-actions/consent
  // exactly as it refuses one taken out of turn on /login-actions/required-
  // action above — an admin-forced password reset is not something the
  // authenticating user gets to skip by finding the other door.
  it('refuses to establish a session from a consent decision while a password reset is owed', async () => {
    const tenantName = `gate-consent-${newId()}`;
    const tenantId = await setupTenant(tenantName, false, true);
    const subjectId = await subjectIdOf(tenantId);
    await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).add(tenantId, subjectId, 'update-password'),
    );

    const authSessionId = await startAuthSession(tenantName);
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.body).toContain('Change your password');

    const bypass = await consentPost(tenantName, {
      auth_session_id: authSessionId,
      decision: 'allow',
    });

    // The evidence that nothing was established or issued, not merely a
    // status code: a 302 here would be the same page a legitimate consent
    // grant produces, and only the absence of a cookie and a session row
    // tells the two apart.
    expect(bypass.statusCode).toBe(200);
    expect(bypass.headers['set-cookie']).toBeUndefined();
    expect(bypass.body).toContain('Change your password');
    expect(await sessionCount(tenantId)).toBe(0);
    expect(await pendingFor(tenantId, subjectId)).toEqual(['update-password']);

    // And the parked login is exactly where it was: still owing the reset
    // the bypass attempt tried to walk around.
    const stillOwed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(stillOwed.statusCode).toBe(200);
    expect(stillOwed.headers['set-cookie']).toBeUndefined();
    expect(stillOwed.body).toContain('Change your password');
  });

  // The other gate the same third door has to clear, proven independently:
  // a build with refusedForUnverifiedEmail deleted from the consent path
  // would pass every other test in this file, since the required-action
  // case above never sets verify_email. This one does, and owes nothing
  // but an unverified address, so it fails on this gate alone.
  it('refuses to establish a session from a consent decision while the email is unverified', async () => {
    const tenantName = `gate-consent-unverified-${newId()}`;
    const tenantId = await setupTenant(tenantName, false, true, true);

    const authSessionId = await startAuthSession(tenantName);
    const owed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.body).toContain("Can't sign in yet");

    const bypass = await consentPost(tenantName, {
      auth_session_id: authSessionId,
      decision: 'allow',
    });

    expect(bypass.statusCode).toBe(200);
    expect(bypass.headers['set-cookie']).toBeUndefined();
    expect(bypass.body).toContain("Can't sign in yet");
    expect(await sessionCount(tenantId)).toBe(0);

    // And the parked login is exactly where it was: still asking for the
    // verification the bypass attempt tried to walk around.
    const stillOwed = await login(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(stillOwed.statusCode).toBe(200);
    expect(stillOwed.headers['set-cookie']).toBeUndefined();
    expect(stillOwed.body).toContain("Can't sign in yet");
  });
});
