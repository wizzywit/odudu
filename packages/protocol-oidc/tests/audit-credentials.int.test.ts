import { provisionTenant, requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
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

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'audit-credentials-client';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const PUBLIC_BASE_URL = 'https://id.example.com';
const RP_ID = 'id.example.com';

const clock = new FakeClock(new Date('2031-01-01T00:00:00.000Z'));

interface SeededTenant {
  name: string;
  id: string;
  subjectId: string;
}

async function seedTenant(
  prefix: string,
  settings: { otpRequired?: boolean; owes?: RequiredAction } = {},
): Promise<SeededTenant> {
  const name = `${prefix}-${newId()}`;
  const id = newId();
  const clientDbId = newId();
  const subjectId = await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name, otpRequired: settings.otpRequired ?? false });
    await provisionTenant(tx, id);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId: id,
      clientId: CLIENT_ID,
      name: 'Audit credentials test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId: id,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username: USERNAME });
    await credentialRepository(tx).insert({
      tenantId: id,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });
    if (settings.owes !== undefined) {
      await requiredActionRepository(tx).add(id, subject.id, settings.owes);
    }
    return subject.id;
  });
  return { name, id, subjectId };
}

async function startAuthSession(tenant: SeededTenant): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const res = await http.inject({
    url: `/tenants/${tenant.name}/protocol/openid-connect/auth?${query.toString()}`,
  });
  expect(res.statusCode).toBe(200);
  const id = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the rendered login form');
  return id;
}

interface Posted {
  requestId: string;
  res: LightMyRequestResponse;
}

async function post(url: string, fields: Record<string, string>, label: string): Promise<Posted> {
  const requestId = `${label}-${newId()}`;
  const res = await http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-request-id': requestId },
  });
  return { requestId, res };
}

function login(tenant: SeededTenant, fields: Record<string, string>): Promise<Posted> {
  return post(`/tenants/${tenant.name}/login-actions/authenticate`, fields, 'login');
}

function action(
  tenant: SeededTenant,
  name: RequiredAction,
  fields: Record<string, string>,
): Promise<Posted> {
  return post(`/tenants/${tenant.name}/login-actions/required-action?action=${name}`, fields, name);
}

function passwordStep(tenant: SeededTenant, authSessionId: string): Promise<Posted> {
  return login(tenant, { auth_session_id: authSessionId, username: USERNAME, password: PASSWORD });
}

async function credentialRows(tenant: SeededTenant): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenant.id, (tx) =>
    auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
  );
}

async function rowsFor(tenant: SeededTenant, posted: Posted): Promise<AuditEventRecord[]> {
  return (await credentialRows(tenant)).filter((row) => row.requestId === posted.requestId);
}

async function expectOneRow(tenant: SeededTenant, posted: Posted, name: string): Promise<void> {
  const rows = await rowsFor(tenant, posted);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    eventType: 'credential',
    action: name,
    outcome: 'allowed',
    actorSubjectId: tenant.subjectId,
    resourceType: 'subject',
    resourceId: tenant.subjectId,
    requestId: posted.requestId,
    ip: '127.0.0.1',
  });
  expect(rows[0]?.detail).toEqual({});
}

function offeredSecret(body: string): string {
  const secret = /name="secret" value="([^"]*)"/.exec(body)?.[1];
  if (secret === undefined) throw new Error('no secret offered on the enrolment page');
  return secret;
}

function offeredCodes(body: string): string[] {
  return [...body.matchAll(/<code>([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})<\/code>/gu)].map(
    (match) => match[1] ?? '',
  );
}

function offeredChallenge(body: string): string {
  const challenge = /"challenge":"([^"]*)"/.exec(body)?.[1];
  if (challenge === undefined) throw new Error('no creation options on the enrolment page');
  return challenge;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify({ requestIdHeader: 'x-request-id' });
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: ownerHandle,
      kek: Buffer.alloc(32, 17),
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

describe('enrolling a TOTP app, then being shown recovery codes', () => {
  it('writes otp.enrolled for the code that proves the app, and nothing for a wrong one', async () => {
    const tenant = await seedTenant('audit-totp', { otpRequired: true });
    const authSessionId = await startAuthSession(tenant);
    const owed = await passwordStep(tenant, authSessionId);
    const secret = offeredSecret(owed.res.body);

    const wrong = await action(tenant, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code: '000000',
    });
    expect(wrong.res.statusCode).toBe(200);
    expect(await credentialRows(tenant)).toEqual([]);

    const code = totpCode(secret, totpCounter(clock.now()));
    const enrolled = await action(tenant, 'configure-totp', {
      auth_session_id: authSessionId,
      secret,
      code,
    });
    expect(enrolled.res.body).toContain('name="password"');
    await expectOneRow(tenant, enrolled, 'otp.enrolled');
    expect(await credentialRows(tenant)).toHaveLength(1);

    clock.advance(31_000);
    await passwordStep(tenant, authSessionId);
    const shown = await login(tenant, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(clock.now())),
    });
    expect(shown.res.body).toContain('Save your recovery codes');
    await expectOneRow(tenant, shown, 'recovery_codes.issued');

    const everything = JSON.stringify(await credentialRows(tenant));
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(code);
    const recoveryCodes = offeredCodes(shown.res.body);
    expect(recoveryCodes).toHaveLength(10);
    for (const recoveryCode of recoveryCodes) {
      expect(everything).not.toContain(recoveryCode);
    }
  });
});

describe('recovery codes', () => {
  it('writes recovery_codes.issued for every set shown, the forced first one included', async () => {
    const tenant = await seedTenant('audit-codes', { owes: 'generate-recovery-codes' });
    const authSessionId = await startAuthSession(tenant);

    const first = await passwordStep(tenant, authSessionId);
    expect(first.res.body).toContain('Save your recovery codes');
    await expectOneRow(tenant, first, 'recovery_codes.issued');

    const again = await passwordStep(tenant, await startAuthSession(tenant));
    expect(again.res.body).toContain('Save your recovery codes');
    await expectOneRow(tenant, again, 'recovery_codes.issued');

    const acknowledged = await action(tenant, 'generate-recovery-codes', {
      auth_session_id: authSessionId,
    });
    expect(acknowledged.res.statusCode).toBe(200);
    expect(await rowsFor(tenant, acknowledged)).toEqual([]);
    expect(await credentialRows(tenant)).toHaveLength(2);
  });
});

describe('enrolling a passkey', () => {
  it('writes passkey.enrolled once the ceremony verifies, and nothing for a refused one', async () => {
    const tenant = await seedTenant('audit-passkey', { owes: 'configure-passkey' });
    const authSessionId = await startAuthSession(tenant);
    await passwordStep(tenant, authSessionId);

    const refused = await action(tenant, 'configure-passkey', {
      auth_session_id: authSessionId,
      credential: '{"id":"nope"}',
    });
    expect(refused.res.body).toContain('Add a passkey');
    expect(await credentialRows(tenant)).toEqual([]);

    const credential = JSON.stringify(
      softwareRegistrationResponse({
        challenge: offeredChallenge(refused.res.body),
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
      }),
    );
    const enrolled = await action(tenant, 'configure-passkey', {
      auth_session_id: authSessionId,
      credential,
      label: 'Work laptop',
    });
    expect(enrolled.res.body).toContain('name="password"');
    await expectOneRow(tenant, enrolled, 'passkey.enrolled');
    expect(await credentialRows(tenant)).toHaveLength(1);
  });
});

describe('changing a password the login owes', () => {
  it('writes password.changed for the accepted candidate only, and never the candidate', async () => {
    const tenant = await seedTenant('audit-password', { owes: 'update-password' });
    const authSessionId = await startAuthSession(tenant);
    const owed = await passwordStep(tenant, authSessionId);
    expect(owed.res.body).toContain('Change your password');

    const weak = await action(tenant, 'update-password', {
      auth_session_id: authSessionId,
      password: 'short',
    });
    expect(weak.res.statusCode).toBe(400);
    expect(await credentialRows(tenant)).toEqual([]);

    const candidate = 'a considerably better passphrase than the old one';
    const changed = await action(tenant, 'update-password', {
      auth_session_id: authSessionId,
      password: candidate,
    });
    expect(changed.res.statusCode).toBe(200);
    await expectOneRow(tenant, changed, 'password.changed');

    const everything = JSON.stringify(await credentialRows(tenant));
    expect(everything).not.toContain(candidate);
    expect(everything).not.toContain(PASSWORD);
  });
});
