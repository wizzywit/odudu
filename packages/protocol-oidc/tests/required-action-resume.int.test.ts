import { provisionTenant, requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys, totpCode, totpCounter } from '@odudu/crypto';
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
  hashPassword,
  subjectRepository,
  users,
} from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareRegistrationResponse,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

// A required action is one more page inside the login that owes it, never a
// second login. Each walk below answers whatever page the server shows, the
// way a person would, and counts what it was asked for.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'resume-client';
const CONSENT_CLIENT_ID = 'resume-consent-client';
const CLIENT_SECRET = 'resume-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different horse, battery and staple';
const KEK = Buffer.alloc(32, 9);
const PUBLIC_BASE_URL = 'https://id.example.com';
const RP_ID = 'id.example.com';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const clock = new FakeClock(new Date('2031-01-01T00:00:00.000Z'));

interface Seeded {
  tenantName: string;
  tenantId: string;
  subjectId: string;
}

async function seed(
  options: { owes?: RequiredAction[]; holdsTotp?: boolean; rememberMe?: boolean } = {},
): Promise<Seeded> {
  const tenantName = `resume-${newId()}`;
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: tenantName, rememberMeAllowed: options.rememberMe ?? false });
    await provisionTenant(tx, tenantId);
    for (const [clientId, consentRequired] of [
      [CLIENT_ID, false],
      [CONSENT_CLIENT_ID, true],
    ] as const) {
      const clientDbId = newId();
      await tx.insert(clients).values({
        id: clientDbId,
        tenantId,
        clientId,
        name: clientId,
        type: 'confidential',
        secretHash: await hashPassword(CLIENT_SECRET),
      });
      await provisionClientDefaults(tx, clientDbId);
      await clientOidcConfigRepository(tx).create({
        clientId: clientDbId,
        tenantId,
        redirectUris: [REDIRECT_URI],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        consentRequired,
      });
    }
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });
    if (options.holdsTotp === true) {
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject.id,
        type: 'totp',
        secret: { kind: 'totp', secret: SECRET, digits: 6, lastStep: 0 },
      });
    }
    for (const action of options.owes ?? []) {
      await requiredActionRepository(tx).add(tenantId, subject.id, action);
    }
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
    return subject.id;
  });
  return { tenantName, tenantId, subjectId };
}

function post(url: string, fields: Record<string, string>): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function hidden(body: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]*)"`).exec(body)?.[1];
  if (value === undefined) throw new Error(`no ${name} on the page:\n${body}`);
  return value;
}

interface Walk {
  pages: string[];
  // The form-action directive each page was served with, in page order.
  formActions: (string | undefined)[];
  passwordForms: number;
  codes: number;
  final: LightMyRequestResponse;
}

// Answers each page until the server redirects, at most a dozen times.
async function walk(
  tenantName: string,
  options: { clientId?: string; rememberMe?: boolean } = {},
): Promise<Walk> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId ?? CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  let res = await http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const pages: string[] = [];
  const formActions: (string | undefined)[] = [];
  let passwordForms = 0;
  let codes = 0;
  let secret = SECRET;
  let password = PASSWORD;
  const actions = `/tenants/${tenantName}/login-actions`;
  const action = (name: string) => `${actions}/required-action?action=${name}`;

  for (let turn = 0; turn < 12 && res.statusCode === 200; turn += 1) {
    const body = res.body;
    const authSessionId = hidden(body, 'auth_session_id');
    formActions.push(
      String(res.headers['content-security-policy'])
        .split('; ')
        .find((directive) => directive.startsWith('form-action')),
    );
    if (body.includes('Set up your authenticator')) {
      pages.push('configure-totp');
      secret = hidden(body, 'secret');
      codes += 1;
      res = await post(action('configure-totp'), {
        auth_session_id: authSessionId,
        secret,
        code: totpCode(secret, totpCounter(clock.now())),
      });
    } else if (body.includes('Change your password')) {
      pages.push('update-password');
      password = NEW_PASSWORD;
      res = await post(action('update-password'), { auth_session_id: authSessionId, password });
    } else if (body.includes('Save your recovery codes')) {
      pages.push('generate-recovery-codes');
      res = await post(action('generate-recovery-codes'), { auth_session_id: authSessionId });
    } else if (body.includes('Add a passkey')) {
      pages.push('configure-passkey');
      const challenge = /"challenge":"([^"]*)"/.exec(body)?.[1] ?? '';
      const credential = softwareRegistrationResponse({
        challenge,
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
      });
      res = await post(action('configure-passkey'), {
        auth_session_id: authSessionId,
        credential: JSON.stringify(credential),
      });
    } else if (body.includes('is asking for access')) {
      pages.push('consent');
      res = await post(`${actions}/consent`, { auth_session_id: authSessionId, decision: 'allow' });
    } else if (body.includes('name="username"')) {
      pages.push('password');
      passwordForms += 1;
      res = await post(`${actions}/authenticate`, {
        auth_session_id: authSessionId,
        username: USERNAME,
        password,
        ...(options.rememberMe === true ? { remember_me: 'true' } : {}),
      });
    } else if (body.includes('name="code"')) {
      pages.push('otp');
      // A code from a time step nothing in this attempt has spent yet.
      clock.advance(31_000);
      codes += 1;
      res = await post(`${actions}/authenticate`, {
        auth_session_id: authSessionId,
        code: totpCode(secret, totpCounter(clock.now())),
      });
    } else {
      throw new Error(`a page this walk does not know:\n${body}`);
    }
  }
  return { pages, formActions, passwordForms, codes, final: res };
}

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

// The walk ended in a code issued to the client, and this is what the ID
// token redeemed from it says about how the End-User authenticated.
async function redeemed(
  tenantName: string,
  final: LightMyRequestResponse,
  clientId = CLIENT_ID,
): Promise<{ amr: unknown; acr: unknown }> {
  expect(final.statusCode).toBe(302);
  const location = new URL(String(final.headers.location));
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
  const code = location.searchParams.get('code');
  if (code === null) throw new Error(`no code in ${location.toString()}`);
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  const payload = jwtPayload(res.json<{ id_token: string }>().id_token);
  return { amr: payload.amr, acr: payload.acr };
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
      publicBaseUrl: PUBLIC_BASE_URL,
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

describe('a finished required action resumes the login that owed it', () => {
  it('[OIDC-CORE-3.1.2.5-01] update-password: one password form, then the code', async () => {
    const { tenantName } = await seed({ owes: ['update-password'] });
    const run = await walk(tenantName);
    expect(run.pages).toEqual(['password', 'update-password']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(0);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['pwd'], acr: '1' });
  });

  it('generate-recovery-codes for a password-only subject: one password form', async () => {
    const { tenantName } = await seed({ owes: ['generate-recovery-codes'] });
    const run = await walk(tenantName);
    expect(run.pages).toEqual(['password', 'generate-recovery-codes']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(0);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['pwd'], acr: '1' });
  });

  it('configure-passkey, then the recovery codes it owes: one password form', async () => {
    const { tenantName } = await seed({ owes: ['configure-passkey'] });
    const run = await walk(tenantName);
    expect(run.pages).toEqual(['password', 'configure-passkey', 'generate-recovery-codes']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(0);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['pwd'], acr: '1' });
  });

  it('configure-totp, then the recovery codes: one password form and one code', async () => {
    const { tenantName } = await seed({ owes: ['configure-totp'] });
    const run = await walk(tenantName);
    expect(run.pages).toEqual(['password', 'configure-totp', 'generate-recovery-codes']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(1);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['otp', 'pwd'], acr: '2' });
  });

  it('update-password then configure-totp: one password form and one code', async () => {
    const { tenantName } = await seed({ owes: ['update-password', 'configure-totp'] });
    const run = await walk(tenantName);
    expect(run.pages).toEqual([
      'password',
      'update-password',
      'configure-totp',
      'generate-recovery-codes',
    ]);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(1);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['otp', 'pwd'], acr: '2' });
  });

  it('update-password for a subject who already holds TOTP: one password form and one code', async () => {
    const { tenantName } = await seed({ owes: ['update-password'], holdsTotp: true });
    const run = await walk(tenantName);
    expect(run.pages).toEqual(['password', 'otp', 'update-password']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(1);
    expect(await redeemed(tenantName, run.final)).toEqual({ amr: ['otp', 'pwd'], acr: '2' });
  });

  it('[OIDC-CORE-3.1.2.4-01] asks for consent after the action when the client requires it', async () => {
    const { tenantName } = await seed({ owes: ['configure-totp'] });
    const run = await walk(tenantName, { clientId: CONSENT_CLIENT_ID });
    expect(run.pages).toEqual(['password', 'configure-totp', 'generate-recovery-codes', 'consent']);
    expect(run.passwordForms).toBe(1);
    expect(run.codes).toBe(1);
    expect(await redeemed(tenantName, run.final, CONSENT_CLIENT_ID)).toEqual({
      amr: ['otp', 'pwd'],
      acr: '2',
    });
  });

  it('keeps remember_me across the detour', async () => {
    const { tenantName } = await seed({ owes: ['update-password'], rememberMe: true });
    const run = await walk(tenantName, { rememberMe: true });
    expect(run.final.statusCode).toBe(302);
    const raw = run.final.headers['set-cookie'];
    const cookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    const persistent = cookies.find((cookie) => cookie.includes('-session-persistent='));
    expect(persistent).toMatch(/-session-persistent=[^;]+;/u);
  });

  it('refuses the recovery codes to a password-only session of a subject who holds TOTP', async () => {
    const { tenantName } = await seed({ owes: ['generate-recovery-codes'], holdsTotp: true });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
    });
    const form = await http.inject({
      url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
    });
    const authSessionId = hidden(form.body, 'auth_session_id');
    const otp = await post(`/tenants/${tenantName}/login-actions/authenticate`, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(otp.body).toContain('name="code"');

    const refused = await post(
      `/tenants/${tenantName}/login-actions/required-action?action=generate-recovery-codes`,
      { auth_session_id: authSessionId },
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.body).not.toContain('Save your recovery codes');
  });
});

describe('a login that passes through consent', () => {
  it('[OIDC-CORE-2-10] issues the amr and acr of the factors that ran', async () => {
    const { tenantName } = await seed();
    const run = await walk(tenantName, { clientId: CONSENT_CLIENT_ID });
    expect(run.pages).toEqual(['password', 'consent']);
    expect(await redeemed(tenantName, run.final, CONSENT_CLIENT_ID)).toEqual({
      amr: ['pwd'],
      acr: '1',
    });
  });

  it('carries otp into the token when the second factor ran before consent', async () => {
    const { tenantName } = await seed({ holdsTotp: true });
    const run = await walk(tenantName, { clientId: CONSENT_CLIENT_ID });
    expect(run.pages).toEqual(['password', 'otp', 'consent']);
    expect(await redeemed(tenantName, run.final, CONSENT_CLIENT_ID)).toEqual({
      amr: ['otp', 'pwd'],
      acr: '2',
    });
  });
});

// Chromium holds the redirect a form submission follows to the page's
// form-action, so every page whose form can end in the 302 to the client
// names that client's origin, and a page that cannot does not.
describe('the pages of a login license the redirect to their client', () => {
  it('names the redirect_uri origin on every page of the walk', async () => {
    const { tenantName } = await seed({ owes: ['update-password', 'configure-passkey'] });
    const run = await walk(tenantName, { clientId: CONSENT_CLIENT_ID });
    expect(run.pages).toEqual([
      'password',
      'update-password',
      'configure-passkey',
      'generate-recovery-codes',
      'consent',
    ]);
    expect(run.formActions).toEqual(run.pages.map(() => "form-action 'self' https://app.example"));
  });

  it("keeps 'self' alone on a page that continues no request", async () => {
    const { tenantName } = await seed();
    const refused = await post(`/tenants/${tenantName}/login-actions/authenticate`, {
      auth_session_id: newId(),
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.statusCode).toBe(400);
    expect(String(refused.headers['content-security-policy'])).toContain("form-action 'self';");
  });
});
