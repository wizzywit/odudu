import { provisionRealm, requiredActionRepository } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  users,
} from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareAuthenticator,
  softwareRegistrationResponse,
  startTestDatabase,
  type SoftwareAuthenticator,
  type TestDatabase,
} from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
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

const CLIENT_ID = 'passkey-enrolment-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// What the routes are told this deployment is published as, and therefore
// the relying party every response below is produced against. The point of
// driving this over HTTP is that nothing in the request can change it.
const PUBLIC_BASE_URL = 'https://id.example.com';
const RP_ID = 'id.example.com';

async function setupRealm(name: string): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'passkey enrolment test client',
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

function enrolmentPost(realmName: string, fields: Record<string, string>) {
  return post(
    `/realms/${realmName}/login-actions/required-action?action=configure-passkey`,
    fields,
  );
}

// Enrolling a passkey owes a recovery path for it, so a login that has to
// get past the enrolment has to get past this too: the page is shown once
// on the next login, and the acknowledgement clears the action.
async function acknowledgeRecoveryCodes(
  realmName: string,
  authSessionId: string,
): Promise<string[]> {
  const shown = await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  expect(shown.statusCode).toBe(200);
  expect(shown.body).toContain('Save your recovery codes');
  const codes = [
    ...shown.body.matchAll(/<code>([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})<\/code>/gu),
  ].map((match) => match[1] ?? '');
  const acknowledged = await post(
    `/realms/${realmName}/login-actions/required-action?action=generate-recovery-codes`,
    { auth_session_id: authSessionId },
  );
  expect(acknowledged.statusCode).toBe(200);
  return codes;
}

// The challenge is never in the form; what the page carries is the creation
// options the browser is meant to pass to navigator.credentials.create, so
// this is what a browser would read out of the page it was served.
function offeredChallenge(body: string): string {
  const match = /"challenge":"([^"]*)"/.exec(body);
  const challenge = match?.[1];
  if (challenge === undefined) throw new Error('no creation options on the enrolment page');
  return challenge;
}

function credentialFor(challenge: string, overrides: { userVerified?: boolean } = {}): string {
  return JSON.stringify(
    softwareRegistrationResponse({ challenge, rpId: RP_ID, origin: PUBLIC_BASE_URL, ...overrides }),
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

function storedPasskeys(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) =>
    credentialRepository(tx).listFor(subjectId, 'webauthn'),
  );
}

// A second factor for this subject, so the login form's next step is the
// code form — a login page with no script of its own. Never answered, so
// the secret only has to be well shaped.
function enrolTotp(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) =>
    credentialRepository(tx).insert({
      realmId,
      subjectId,
      type: 'totp',
      secret: { kind: 'totp', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', digits: 6, lastStep: 0 },
    }),
  );
}

function oweAPasskey(realmId: string, subjectId: string) {
  return withRealm(app.db, realmId, (tx) =>
    requiredActionRepository(tx).add(realmId, subjectId, 'configure-passkey'),
  );
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
      publicBaseUrl: PUBLIC_BASE_URL,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
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

describe('enrolling a passkey over HTTP', () => {
  it('[WEBAUTHN2-7.1.21-01] offers the ceremony, stores nothing until it verifies, and resumes the login', async () => {
    const realmName = `passkey-enrol-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await oweAPasskey(realmId, subjectId);
    const authSessionId = await startAuthSession(realmName);

    // The password is right and the login still does not finish: no
    // cookie, no redirect, the enrolment page instead.
    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.statusCode).toBe(200);
    expect(owed.headers['set-cookie']).toBeUndefined();
    expect(owed.body).toContain('navigator.credentials.create');
    expect(owed.body).toContain(`"id":"${RP_ID}"`);
    expect(await storedPasskeys(realmId, subjectId)).toEqual([]);

    // A response the browser could not have produced: refused, nothing
    // stored, and the page comes back to be tried again.
    const refused = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential: '{"id":"nope"}',
    });
    expect(refused.statusCode).toBe(200);
    expect(refused.body).toContain('Add a passkey');
    expect(await storedPasskeys(realmId, subjectId)).toEqual([]);

    // The re-render issues its own challenge, since the refused one was
    // spent by the attempt that failed.
    const retryChallenge = offeredChallenge(refused.body);
    expect(retryChallenge).not.toBe(offeredChallenge(owed.body));

    const enrolled = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential: credentialFor(retryChallenge),
      label: 'Work laptop',
    });
    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.body).toContain('name="password"');

    const stored = await storedPasskeys(realmId, subjectId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.label).toBe('Work laptop');
    expect(stored[0]?.lookupKey).toBeTruthy();
    // The passkey is enrolled, and the recovery path for it is owed in its
    // place: losing the authenticator is the lockout this prevents.
    expect(
      await withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId)),
    ).toEqual(['generate-recovery-codes']);

    const codes = await acknowledgeRecoveryCodes(realmName, authSessionId);
    expect(codes).toHaveLength(10);
    expect(
      await withRealm(app.db, realmId, (tx) => requiredActionRepository(tx).pendingFor(subjectId)),
    ).toEqual([]);

    // Nothing is owed now, so the same password finishes the login.
    const completed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(completed.statusCode).toBe(302);
    const location = completed.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('code')).toBeTruthy();
  });

  // Passing the password step is permission to finish the login that asked
  // for it, never permission to attach an authenticator to the account: a
  // stolen password would otherwise buy a passkey that outlives the
  // password reset ending the compromise.
  // Only a script can reach an authenticator, and `default-src 'none'`
  // blocks an inline one with no message at all — the page renders and the
  // button does nothing. The nonce in the header has to be the nonce on the
  // element, or this page cannot work in a browser.
  it('serves the page with a policy that licenses its own script and no other', async () => {
    const realmName = `passkey-csp-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await oweAPasskey(realmId, subjectId);
    const authSessionId = await startAuthSession(realmName);

    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });

    const policy = String(owed.headers['content-security-policy']);
    const nonce = /<script nonce="([^"]+)">/u.exec(owed.body)?.[1];
    expect(nonce).toBeDefined();
    expect(policy).toContain(`script-src 'nonce-${String(nonce)}'`);
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it('refuses to enrol anything for a subject who owes no action', async () => {
    const realmName = `passkey-unasked-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    const authSessionId = await startAuthSession(realmName);

    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(302);

    const refused = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential: credentialFor('a-challenge-nobody-issued'),
    });

    expect(refused.statusCode).toBe(400);
    expect(await storedPasskeys(realmId, subjectId)).toEqual([]);
  });

  it('refuses a submission carrying no authentication session', async () => {
    const realmName = `passkey-nosession-${newId()}`;
    await setupRealm(realmName);

    const refused = await enrolmentPost(realmName, {
      credential: credentialFor('a-challenge-nobody-issued'),
    });

    expect(refused.statusCode).toBe(400);
  });

  // The same pairing the service enforces, seen from the outside: the page
  // asks for user verification, so a response without it is refused rather
  // than stored as a factor that looks like two and is one.
  it('refuses a response whose authenticator verified nobody', async () => {
    const realmName = `passkey-nouv-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await oweAPasskey(realmId, subjectId);
    const authSessionId = await startAuthSession(realmName);

    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(owed.body).toContain('"userVerification":"required"');

    const refused = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential: credentialFor(offeredChallenge(owed.body), { userVerified: false }),
    });

    expect(refused.statusCode).toBe(200);
    expect(refused.body).toContain('Add a passkey');
    expect(await storedPasskeys(realmId, subjectId)).toEqual([]);
  });

  // A response is answerable once, and the page it came from is gone: the
  // challenge went with the verification that accepted it.
  it('refuses a replay of the response that already enrolled', async () => {
    const realmName = `passkey-replay-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await oweAPasskey(realmId, subjectId);
    const authSessionId = await startAuthSession(realmName);

    const owed = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    const credential = credentialFor(offeredChallenge(owed.body));

    const first = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential,
    });
    expect(first.body).toContain('name="password"');

    // The action is done, so this submission is refused by the gate before
    // the challenge is even consulted — and the credential count proves
    // nothing was written twice either way.
    const replay = await enrolmentPost(realmName, {
      auth_session_id: authSessionId,
      credential,
    });

    expect(replay.statusCode).toBe(400);
    expect(await storedPasskeys(realmId, subjectId)).toHaveLength(1);
  });
});

// One authenticator carried across both ceremonies, so the assertion below
// is checked against the public key the enrolment above really stored.
async function enrolAPasskey(
  realmName: string,
  realmId: string,
  subjectId: string,
): Promise<SoftwareAuthenticator> {
  const authenticator = softwareAuthenticator();
  await oweAPasskey(realmId, subjectId);
  const authSessionId = await startAuthSession(realmName);
  const owed = await login(realmName, {
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const enrolled = await enrolmentPost(realmName, {
    auth_session_id: authSessionId,
    credential: JSON.stringify(
      authenticator.registration({
        challenge: offeredChallenge(owed.body),
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
        signCount: 1,
      }),
    ),
  });
  expect(enrolled.statusCode).toBe(200);
  expect(await storedPasskeys(realmId, subjectId)).toHaveLength(1);
  await acknowledgeRecoveryCodes(realmName, authSessionId);
  return authenticator;
}

describe('signing in with a passkey over HTTP', () => {
  it('[WEBAUTHN2-7-01] takes no username at all: options, an assertion, a code', async () => {
    const realmName = `passkey-login-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    const authenticator = await enrolAPasskey(realmName, realmId, subjectId);

    // A fresh attempt. The login page offers the button beside the
    // password, and the button asks for options rather than carrying them.
    const authSessionId = await startAuthSession(realmName);
    const offered = await post(`/realms/${realmName}/login-actions/passkey-challenge`, {
      auth_session_id: authSessionId,
    });
    expect(offered.statusCode).toBe(200);
    const options: unknown = offered.json();
    const challenge = offeredChallenge(JSON.stringify(options));
    expect(JSON.stringify(options)).not.toContain('allowCredentials');

    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      assertion: JSON.stringify(
        authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 2,
        }),
      ),
    });

    // No username was sent, and the response is the same success a password
    // login gets: a session cookie and a code on the redirect.
    expect(signedIn.statusCode).toBe(302);
    expect(String(signedIn.headers['set-cookie'])).toContain(`${realmName}-session=`);
    expect(String(signedIn.headers.location)).toContain('code=');
    const stored = await storedPasskeys(realmId, subjectId);
    expect(stored[0]?.secret).toMatchObject({ counter: 2 });
  });

  // This endpoint writes a challenge against the id it is given, so a
  // value Postgres cannot parse as a uuid would raise rather than update
  // nothing. Refused as a bad request, never 500.
  it('refuses a malformed authentication session id, and one nobody offered', async () => {
    const realmName = `passkey-badsession-${newId()}`;
    await setupRealm(realmName);
    const url = `/realms/${realmName}/login-actions/passkey-challenge`;

    for (const malformed of ['not-a-uuid', `${newId()}\n${newId()}`, `${newId()}' or '1'='1`, '']) {
      const refused = await post(url, { auth_session_id: malformed });
      expect(`${JSON.stringify(malformed)}: ${String(refused.statusCode)}`).toBe(
        `${JSON.stringify(malformed)}: 400`,
      );
    }

    // Well-shaped and unknown is a different case: nothing to write to, so
    // the options are issued against a row that does not exist and the
    // assertion they produce finds no challenge to answer.
    const unknown = await post(url, { auth_session_id: newId() });
    expect(unknown.statusCode).toBe(200);
  });

  it('[WEBAUTHN2-7.2.2-01] offers the button on the login page, with no username field of its own', async () => {
    const realmName = `passkey-button-${newId()}`;
    await setupRealm(realmName);

    const page = await http.inject({ url: authorizeUrl(realmName) });

    expect(page.body).toContain('Sign in with a passkey');
    expect(page.body).toContain('navigator.credentials.get');
    expect(page.body).toContain('login-actions/passkey-challenge');
    // A rejected ceremony has to say so on the page rather than leaving the
    // reader at a button that did nothing (WebAuthn §7.2 step 2).
    expect(page.body).toContain('catch (caught)');
    expect(page.body).toContain('did not finish signing in');
    // Nothing in a response reveals a refused script, so the only checkable
    // half is that the policy names the nonce the markup carries. Asserted
    // for the login page as well as the enrolment one: both would look
    // exactly like this if the script never ran.
    const nonce = /<script nonce="([^"]+)">/u.exec(page.body)?.[1];
    expect(nonce).toBeDefined();
    const policy = String(page.headers['content-security-policy']);
    expect(policy).toContain(`script-src 'nonce-${String(nonce)}'`);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  // A page with no script of its own must not be served a policy licensing
  // one: a directive that licenses nothing has stopped describing the page.
  it('sends no script-src on a login page that renders no script', async () => {
    const realmName = `passkey-otpform-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await enrolTotp(realmId, subjectId);
    const authSessionId = await startAuthSession(realmName);

    // The password is right, so the next step is the code form, which has
    // no passkey button and therefore no script.
    const codeForm = await login(realmName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });

    expect(codeForm.body).toContain('one-time-code');
    expect(codeForm.body).not.toContain('<script');
    const policy = String(codeForm.headers['content-security-policy']);
    expect(policy).not.toContain('script-src');
    expect(policy).not.toContain('connect-src');
  });

  // With JavaScript off the passkey form submits an empty field. Read as an
  // attempt, it would take the ALTERNATIVE group away from the password and
  // refuse a login nobody could complete.
  it('treats an empty assertion field as no attempt at all', async () => {
    const realmName = `passkey-noscript-${newId()}`;
    await setupRealm(realmName);
    const authSessionId = await startAuthSession(realmName);

    const signedIn = await login(realmName, {
      auth_session_id: authSessionId,
      assertion: '',
      username: USERNAME,
      password: PASSWORD,
    });

    expect(signedIn.statusCode).toBe(302);
    expect(String(signedIn.headers.location)).toContain('code=');
  });

  it('tells a reader with no JavaScript why the button cannot work', async () => {
    const realmName = `passkey-noscript-msg-${newId()}`;
    await setupRealm(realmName);

    const page = await http.inject({ url: authorizeUrl(realmName) });

    expect(page.body).toContain('<noscript>');
  });
});

describe('a deployment that cannot name a relying party', () => {
  it('reports the action as one it cannot complete, rather than guessing a domain', async () => {
    const realmName = `passkey-unconfigured-${newId()}`;
    const realmId = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId);
    await oweAPasskey(realmId, subjectId);

    // The same routes with no publicBaseUrl — the shape of a deployment
    // that never set ODUDU_PUBLIC_BASE_URL. Outside production the boot
    // guard permits it, so this is what the user meets.
    const unconfigured = Fastify();
    try {
      await unconfigured.register(formbody);
      await unconfigured.register(
        oidcRoutes({
          database: app,
          ownerDatabase: owner,
          kek: KEK,
          clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
        }),
      );
      await unconfigured.ready();

      const authorize = await unconfigured.inject({ url: authorizeUrl(realmName) });
      const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body)?.[1];
      if (authSessionId === undefined) throw new Error('no auth_session_id');

      const owed = await unconfigured.inject({
        method: 'POST',
        url: `/realms/${realmName}/login-actions/authenticate`,
        payload: new URLSearchParams({
          auth_session_id: authSessionId,
          username: USERNAME,
          password: PASSWORD,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(owed.statusCode).toBe(200);
      expect(owed.body).not.toContain('navigator.credentials.create');
      expect(owed.body).toContain('configure-passkey');
      expect(await storedPasskeys(realmId, subjectId)).toEqual([]);
    } finally {
      await unconfigured.close();
    }
  });
});
