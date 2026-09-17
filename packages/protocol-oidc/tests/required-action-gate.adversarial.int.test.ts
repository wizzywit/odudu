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

const CLIENT_ID = 'required-action-gate-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
      name: 'required action gate test client',
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

function actionPost(realmName: string, action: string, fields: Record<string, string>) {
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

function codesOn(body: string): string[] {
  return [...body.matchAll(/<code>([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})<\/code>/gu)].map(
    (match) => match[1] ?? '',
  );
}

async function subjectIdOf(realmId: string): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const rows = await tx.select().from(users);
    const row = rows[0];
    if (row === undefined) throw new Error('expected the seeded user');
    return row.subjectId;
  });
}

// The rows themselves, by id, not their count: a regeneration writes ten
// fresh rows and deletes ten old ones, which a length assertion cannot see.
async function storedCodeIds(realmId: string, subjectId: string): Promise<string[]> {
  const held = await withRealm(app.db, realmId, (tx) =>
    credentialRepository(tx).listFor(subjectId, 'recovery-code'),
  );
  return held.map((credential) => credential.id).sort();
}

function pendingFor(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId));
}

function storedPassword(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) => credentialRepository(tx).passwordFor(subjectId));
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

// Enrols the second factor and stops there — which is one closed tab, not
// an unusual sequence. Completing configure-totp asks for recovery codes,
// and the page that writes them sits behind the second factor, so the
// account is left owing the action and holding no codes at all.
async function abandonAfterTotpEnrolment(realmName: string): Promise<string> {
  const authSessionId = await startAuthSession(realmName);
  const owed = await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const secret = offeredSecret(owed.body);
  const enrolled = await actionPost(realmName, 'configure-totp', {
    auth_session_id: authSessionId,
    secret,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  expect(enrolled.statusCode).toBe(200);
  return secret;
}

// Leaves the realm's only account in the state an abandoned enrolment
// produces: a TOTP credential, ten recovery codes written by the page that
// displayed them, and generate-recovery-codes still owed because nobody
// acknowledged that page. Returns the codes it saw, so a later assertion
// can tell the same set from a replacement.
async function abandonRecoveryCodePage(
  realmName: string,
): Promise<{ secret: string; codes: string[] }> {
  const authSessionId = await startAuthSession(realmName);
  const owed = await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const secret = offeredSecret(owed.body);
  await actionPost(realmName, 'configure-totp', {
    auth_session_id: authSessionId,
    secret,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  clock.advance(31_000);
  await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const shown = await login(realmName, {
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
async function settleOwedRecoveryCodes(realmName: string, secret: string): Promise<void> {
  clock.advance(31_000);
  const authSessionId = await startAuthSession(realmName);
  await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const owed = await login(realmName, {
    auth_session_id: authSessionId,
    code: totpCode(secret, totpCounter(clock.now())),
  });
  expect(owed.body).toContain('Save your recovery codes');
  const acknowledged = await actionPost(realmName, 'generate-recovery-codes', {
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
    const realmName = `gate-bypass-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    const secret = await abandonAfterTotpEnrolment(realmName);
    expect(await pendingFor(realmId, subjectId)).toEqual(['generate-recovery-codes']);
    expect(await storedCodeIds(realmId, subjectId)).toEqual([]);

    clock.advance(31_000);
    const attacker = await startAuthSession(realmName);
    const firstFactor = await login(realmName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.statusCode).toBe(200);
    expect(firstFactor.body).toContain('name="code"');

    const bypass = await actionPost(realmName, 'generate-recovery-codes', {
      auth_session_id: attacker,
    });

    // Asserted before the status code, so a regression reports the codes it
    // handed out rather than the number 200: no codes on the page and none
    // in the database, which a status assertion alone cannot tell apart
    // from a refusal that issued them anyway.
    expect(codesOn(bypass.body)).toEqual([]);
    expect(await storedCodeIds(realmId, subjectId)).toEqual([]);
    expect(bypass.statusCode).toBe(400);
    expect(bypass.body).toContain('no longer valid');
    expect(await pendingFor(realmId, subjectId)).toEqual(['generate-recovery-codes']);

    // And the second factor is still the second factor: the code the
    // account's own authenticator produces finishes this login, and the
    // refused request changed nothing about that.
    clock.advance(31_000);
    const withTheRealFactor = await login(realmName, {
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
    const realmName = `gate-recovery-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    await abandonRecoveryCodePage(realmName);
    const before = await storedCodeIds(realmId, subjectId);
    expect(before).toHaveLength(10);
    expect(await pendingFor(realmId, subjectId)).toEqual(['generate-recovery-codes']);

    clock.advance(31_000);
    const attacker = await startAuthSession(realmName);
    const firstFactor = await login(realmName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.statusCode).toBe(200);
    expect(firstFactor.body).toContain('name="code"');

    const bypass = await actionPost(realmName, 'generate-recovery-codes', {
      auth_session_id: attacker,
    });

    expect(bypass.statusCode).toBe(400);
    expect(bypass.body).toContain('no longer valid');
    expect(codesOn(bypass.body)).toEqual([]);
    // The same ten rows, by id rather than by count: a regeneration writes
    // ten and deletes ten, which a length assertion cannot see.
    expect(await storedCodeIds(realmId, subjectId)).toEqual(before);
    // And the action is still owed — it is the owner's to complete.
    expect(await pendingFor(realmId, subjectId)).toEqual(['generate-recovery-codes']);

    // And the parked login is exactly where it was: still asking for the
    // factor the refused request tried to walk around.
    const stillOwed = await login(realmName, { auth_session_id: attacker });
    expect(stillOwed.statusCode).toBe(200);
    expect(stillOwed.headers['set-cookie']).toBeUndefined();
    expect(stillOwed.body).toContain('name="code"');
  });

  // An expired password is the one required action an attacker who stole
  // that password most wants: setting a new one from a session that has not
  // passed the second factor would lock the owner out of their own account
  // with the thief's password in force.
  it('refuses update-password from a session still owing its second factor', async () => {
    const realmName = `gate-password-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    const { secret } = await abandonRecoveryCodePage(realmName);
    await settleOwedRecoveryCodes(realmName, secret);
    expect(await pendingFor(realmId, subjectId)).toEqual([]);
    await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).add(realmId, subjectId, 'update-password'),
    );
    const before = await storedPassword(realmId, subjectId);

    clock.advance(31_000);
    const attacker = await startAuthSession(realmName);
    const firstFactor = await login(realmName, {
      auth_session_id: attacker,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(firstFactor.body).toContain('name="code"');

    const refused = await actionPost(realmName, 'update-password', {
      auth_session_id: attacker,
      password: 'a password only the thief knows',
    });

    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');
    expect(await storedPassword(realmId, subjectId)).toBe(before);
    expect(await pendingFor(realmId, subjectId)).toEqual(['update-password']);
  });

  // The order the actions run in is the reason an expired password cannot
  // be used to enrol a second factor, and it has to bind where submissions
  // are judged, not only where pages are rendered.
  it('refuses an owed action that is not the one the login owes next', async () => {
    const realmName = `gate-order-${newId()}`;
    const realmId = await setupRealm(realmName, false);
    const subjectId = await subjectIdOf(realmId);
    await withRealm(app.db, realmId, async (tx) => {
      await requiredActionRepository(tx).add(realmId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(realmId, subjectId, 'configure-passkey');
    });

    const authSessionId = await startAuthSession(realmName);
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.body).toContain('Change your password');

    const refused = await actionPost(realmName, 'configure-passkey', {
      auth_session_id: authSessionId,
    });

    // The message is the evidence of which check fired: an action this
    // deployment cannot complete at all answers with a different one, so a
    // bare 400 would not tell the ordering gate from that.
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no such pending action');
    expect(await pendingFor(realmId, subjectId)).toEqual(
      expect.arrayContaining(['update-password', 'configure-passkey']),
    );
  });

  // The same ordering hole, with the effect the previous case cannot show:
  // this one would have written ten recovery codes and shown them, from a
  // session whose first owed action is still the password change.
  it('issues no recovery codes for an owed action taken out of turn', async () => {
    const realmName = `gate-order-codes-${newId()}`;
    const realmId = await setupRealm(realmName, false);
    const subjectId = await subjectIdOf(realmId);
    await withRealm(app.db, realmId, async (tx) => {
      await requiredActionRepository(tx).add(realmId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(realmId, subjectId, 'generate-recovery-codes');
    });

    const authSessionId = await startAuthSession(realmName);
    await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });

    const refused = await actionPost(realmName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no such pending action');
    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(realmId, subjectId)).toEqual([]);
  });

  // The gate rests on a record of completion, and that record has to move
  // back. Enrolling the factor a realm asked for makes the OTP step apply to
  // a session that had nothing left to pass, so re-running the login parks
  // it on a challenge again — and the action owed after the enrolment must
  // wait for that challenge. A record that only ever moved forwards would
  // still call this attempt finished, for as long as the session lives.
  it('stops treating a session as finished once an enrolment makes a factor apply', async () => {
    const realmName = `gate-reapplies-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);

    // The login completes on the password alone: otp_required, and no
    // credential that could produce a code.
    const authSessionId = await startAuthSession(realmName);
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const secret = offeredSecret(owed.body);
    const enrolled = await actionPost(realmName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(enrolled.statusCode).toBe(200);
    expect(await pendingFor(realmId, subjectId)).toEqual(['generate-recovery-codes']);

    // Same session, login re-run: now there is a code to ask for.
    clock.advance(31_000);
    const challenged = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(challenged.body).toContain('name="code"');

    const refused = await actionPost(realmName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(realmId, subjectId)).toEqual([]);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');

    // Passing the code is what makes the action reachable, and then it is.
    clock.advance(31_000);
    const reached = await login(realmName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(reached.body).toContain('Save your recovery codes');
    expect(await storedCodeIds(realmId, subjectId)).toHaveLength(10);
  });

  // A session that has already driven a login to an authorization code is
  // spent. Whatever it owed was owed before that, so an action arriving
  // against it afterwards is a form the browser still had open — and the
  // code it minted is not a licence to keep changing the account.
  it('refuses an action against a session already spent on a login', async () => {
    const realmName = `gate-consumed-${newId()}`;
    const realmId = await setupRealm(realmName, false);
    const subjectId = await subjectIdOf(realmId);

    const authSessionId = await startAuthSession(realmName);
    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(302);
    await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).add(realmId, subjectId, 'generate-recovery-codes'),
    );

    const refused = await actionPost(realmName, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });

    expect(codesOn(refused.body)).toEqual([]);
    expect(await storedCodeIds(realmId, subjectId)).toEqual([]);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('no longer valid');
  });

  // The mechanism's reason for existing: a realm that turns otp_required on
  // owes configure-totp to a subject with no TOTP credential, and no OTP
  // step can apply to them — there is no code they could produce. That
  // login is complete, so the enrolment it asks for stays submittable.
  it('accepts configure-totp from a subject who has no second factor to pass', async () => {
    const realmName = `gate-enrol-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);

    const authSessionId = await startAuthSession(realmName);
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.body).toContain('otpauth://totp/');
    const secret = offeredSecret(owed.body);

    clock.advance(31_000);
    const enrolled = await actionPost(realmName, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: totpCode(secret, totpCounter(clock.now())),
    });

    expect(enrolled.statusCode).toBe(200);
    expect(
      await withRealm(app.db, realmId, (tx) => credentialRepository(tx).listFor(subjectId, 'totp')),
    ).toHaveLength(1);
  });

  // The other side of the update-password refusal above: once the second
  // factor the realm requires has actually been passed, the password change
  // an aged-out password owes goes through. An expired password must not be
  // a lockout, only a login that cannot complete until it is changed.
  it('accepts update-password once the second factor has been passed', async () => {
    const realmName = `gate-password-ok-${newId()}`;
    const realmId = await setupRealm(realmName, true);
    const subjectId = await subjectIdOf(realmId);
    const { secret } = await abandonRecoveryCodePage(realmName);
    await settleOwedRecoveryCodes(realmName, secret);
    await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).add(realmId, subjectId, 'update-password'),
    );
    const before = await storedPassword(realmId, subjectId);

    clock.advance(31_000);
    const authSessionId = await startAuthSession(realmName);
    await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(owed.body).toContain('Change your password');

    const changed = await actionPost(realmName, 'update-password', {
      auth_session_id: authSessionId,
      password: 'a considerably better passphrase than the old one',
    });

    expect(changed.statusCode).toBe(200);
    expect(await pendingFor(realmId, subjectId)).toEqual([]);
    expect(await storedPassword(realmId, subjectId)).not.toBe(before);
  });
});
