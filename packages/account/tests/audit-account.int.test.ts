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
  evaluatePassword,
  hashPassword,
  REUSED_PASSWORD,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actionTokenRepository } from '#/repository/action-tokens';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type NewAccountInput } from '#/usecase/register';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { registerRegistrationRoute } from '#/view/routes/registration';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const PASSWORD = 'correct horse battery';

async function createAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: NewAccountInput,
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

async function seedTenant(settings: { verifyEmail?: boolean } = {}): Promise<{
  id: string;
  name: string;
}> {
  const id = newId();
  const name = `audit-account-${id}`;
  await owner.db.insert(tenants).values({
    id,
    name,
    registrationAllowed: true,
    resetPasswordAllowed: true,
    verifyEmail: settings.verifyEmail ?? false,
  });
  return { id, name };
}

async function seedAda(tenantId: string): Promise<string> {
  const { subjectId } = await withTenant(app.db, tenantId, (tx) =>
    createAccount(tx, tenantId, { username: 'ada', email: 'ada@example.test', password: PASSWORD }),
  );
  return subjectId;
}

async function issueResetToken(
  tenantId: string,
  subjectId: string,
  ttlSeconds = 300,
): Promise<string> {
  const { token } = await withTenant(app.db, tenantId, (tx) =>
    actionTokenRepository(tx).issue({
      tenantId,
      subjectId,
      type: 'reset_password',
      email: 'ada@example.test',
      ttlSeconds,
    }),
  );
  return token;
}

async function subjectIdFor(tenantId: string, username: string): Promise<string> {
  const found = await withTenant(app.db, tenantId, (tx) => userRepository(tx).byUsername(username));
  if (found === null) throw new Error(`no user named ${username}`);
  return found.subject.id;
}

function postForm(
  url: string,
  fields: Record<string, string>,
  requestId: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-request-id': requestId },
  });
}

function register(tenantName: string, requestId: string, username = 'ada') {
  return postForm(
    `/tenants/${tenantName}/login-actions/registration`,
    { username, email: `${username}@example.test`, password: PASSWORD },
    requestId,
  );
}

function submitReset(tenantName: string, key: string, password: string, requestId: string) {
  return postForm(
    `/tenants/${tenantName}/login-actions/action-token`,
    { key, password },
    requestId,
  );
}

async function credentialRows(tenantId: string): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
  );
}

async function rowsFor(tenantId: string, requestId: string): Promise<AuditEventRecord[]> {
  return (await credentialRows(tenantId)).filter((row) => row.requestId === requestId);
}

function expectSubjectRow(
  rows: readonly AuditEventRecord[],
  action: string,
  subjectId: string,
  requestId: string,
): void {
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    eventType: 'credential',
    action,
    outcome: 'allowed',
    actorSubjectId: subjectId,
    resourceType: 'subject',
    resourceId: subjectId,
    requestId,
    ip: '127.0.0.1',
  });
  expect(rows[0]?.detail).toEqual({});
}

async function mailedVerificationKey(tenantId: string): Promise<string> {
  const [message] = await withTenant(app.db, tenantId, (tx) => tx.select().from(emailOutbox));
  const link = /visiting this link:\n\n(\S+)/.exec(message?.bodyText ?? '')?.[1];
  const key = link === undefined ? null : new URL(link).searchParams.get('key');
  if (key === null) throw new Error('no verification link was queued');
  return key;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify({ requestIdHeader: 'x-request-id' });
  httpApp = http;
  await http.register(formbody);
  const findTenant = (name: string) => tenantSettingsRepository(owner.db).byName(name);
  registerRegistrationRoute(http, {
    database: app,
    findTenant,
    publicBaseUrl: 'https://idp.example.test',
    createAccount,
    evaluatePassword,
  });
  registerActionTokenRoute(http, {
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
  });
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('registration writes one account.registered row', () => {
  it('names the new subject, bound to the request that created it', async () => {
    const tenant = await seedTenant();
    const requestId = `register-${newId()}`;

    const res = await register(tenant.name, requestId);

    expect(res.statusCode).toBe(201);
    const subjectId = await subjectIdFor(tenant.id, 'ada');
    expectSubjectRow(
      await rowsFor(tenant.id, requestId),
      'account.registered',
      subjectId,
      requestId,
    );
    expect(await credentialRows(tenant.id)).toHaveLength(1);
  });

  it('writes the row where verification is required too, and never the password', async () => {
    const tenant = await seedTenant({ verifyEmail: true });
    const requestId = `register-verify-${newId()}`;

    expect((await register(tenant.name, requestId)).statusCode).toBe(201);

    const rows = await rowsFor(tenant.id, requestId);
    expectSubjectRow(rows, 'account.registered', await subjectIdFor(tenant.id, 'ada'), requestId);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });

  it('writes nothing for a refused registration', async () => {
    const tenant = await seedTenant();
    expect((await register(tenant.name, `first-${newId()}`)).statusCode).toBe(201);

    const duplicate = `duplicate-${newId()}`;
    expect((await register(tenant.name, duplicate)).statusCode).toBe(400);
    const weak = `weak-${newId()}`;
    const refused = await postForm(
      `/tenants/${tenant.name}/login-actions/registration`,
      { username: 'bea', email: 'bea@example.test', password: 'short' },
      weak,
    );
    expect(refused.statusCode).toBe(400);

    expect(await rowsFor(tenant.id, duplicate)).toEqual([]);
    expect(await rowsFor(tenant.id, weak)).toEqual([]);
    expect(await credentialRows(tenant.id)).toHaveLength(1);
  });
});

describe('verifying an address writes one email.verified row', () => {
  it('names the subject the link was minted for', async () => {
    const tenant = await seedTenant({ verifyEmail: true });
    expect((await register(tenant.name, `register-${newId()}`)).statusCode).toBe(201);
    const key = await mailedVerificationKey(tenant.id);
    const requestId = `verify-${newId()}`;

    const res = await http.inject({
      url: `/tenants/${tenant.name}/login-actions/action-token?key=${encodeURIComponent(key)}`,
      headers: { 'x-request-id': requestId },
    });

    expect(res.statusCode).toBe(200);
    const rows = await rowsFor(tenant.id, requestId);
    expectSubjectRow(rows, 'email.verified', await subjectIdFor(tenant.id, 'ada'), requestId);
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('writes nothing for a link that has already been spent', async () => {
    const tenant = await seedTenant({ verifyEmail: true });
    expect((await register(tenant.name, `register-${newId()}`)).statusCode).toBe(201);
    const url = `/tenants/${tenant.name}/login-actions/action-token?key=${encodeURIComponent(
      await mailedVerificationKey(tenant.id),
    )}`;
    expect((await http.inject({ url })).statusCode).toBe(200);
    const replay = `verify-replay-${newId()}`;

    const res = await http.inject({ url, headers: { 'x-request-id': replay } });

    expect(res.statusCode).toBe(400);
    expect(await rowsFor(tenant.id, replay)).toEqual([]);
  });
});

describe('redeeming a reset link writes one password.reset row', () => {
  it('names the subject, and carries neither the new password nor the key', async () => {
    const tenant = await seedTenant();
    const subjectId = await seedAda(tenant.id);
    const key = await issueResetToken(tenant.id, subjectId);
    const newPassword = 'a fresh passphrase nobody has seen';
    const requestId = `reset-${newId()}`;

    const res = await submitReset(tenant.name, key, newPassword, requestId);

    expect(res.statusCode).toBe(200);
    const rows = await rowsFor(tenant.id, requestId);
    expectSubjectRow(rows, 'password.reset', subjectId, requestId);
    const everything = JSON.stringify(await credentialRows(tenant.id));
    expect(everything).not.toContain(newPassword);
    expect(everything).not.toContain(key);
  });

  it('writes nothing for an expired link', async () => {
    const tenant = await seedTenant();
    const subjectId = await seedAda(tenant.id);
    const key = await issueResetToken(tenant.id, subjectId, -60);
    const requestId = `reset-expired-${newId()}`;

    const res = await submitReset(
      tenant.name,
      key,
      'a fresh passphrase nobody has seen',
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(await credentialRows(tenant.id)).toEqual([]);
  });

  it('writes nothing for a password the policy refuses', async () => {
    const tenant = await seedTenant();
    const subjectId = await seedAda(tenant.id);
    const key = await issueResetToken(tenant.id, subjectId);

    const weak = await submitReset(tenant.name, key, 'short', `reset-weak-${newId()}`);
    const unchanged = await submitReset(tenant.name, key, PASSWORD, `reset-same-${newId()}`);

    expect(weak.statusCode).toBe(400);
    expect(unchanged.statusCode).toBe(400);
    expect(await credentialRows(tenant.id)).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('shows a tenant no credential row written for another', async () => {
    const tenant = await seedTenant();
    const other = await seedTenant();
    const requestId = `register-${newId()}`;

    expect((await register(tenant.name, requestId)).statusCode).toBe(201);

    expect(await rowsFor(tenant.id, requestId)).toHaveLength(1);
    expect(await credentialRows(other.id)).toEqual([]);
  });
});
