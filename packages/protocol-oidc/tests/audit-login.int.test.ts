import { generateTotpSecret, totpCode, totpCounter } from '@odudu/crypto';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { beginRecoveryCodes, provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
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

let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'audit-login-client';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'a password nobody here holds';

interface SeededTenant {
  name: string;
  id: string;
  clientDbId: string;
  subjects: Map<string, string>;
}

let passwordTenant: SeededTenant;
let otpTenant: SeededTenant;

async function seedTenant(
  prefix: string,
  usernames: readonly string[],
  otpRequired: boolean,
): Promise<SeededTenant> {
  const name = `${prefix}-${newId()}`;
  const id = newId();
  const clientDbId = newId();
  const subjects = new Map<string, string>();
  await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name, otpRequired });
    await provisionTenant(tx, id);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId: id,
      clientId: CLIENT_ID,
      name: 'Audit login test client',
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
    const hash = await hashPassword(PASSWORD);
    for (const username of usernames) {
      const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
      subjects.set(username, subject.id);
      await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId: id,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash },
      });
    }
  });
  return { name, id, clientDbId, subjects };
}

function subjectOf(tenant: SeededTenant, username: string): string {
  const id = tenant.subjects.get(username);
  if (id === undefined) throw new Error(`no seeded subject '${username}'`);
  return id;
}

async function enrolTotp(tenant: SeededTenant, username: string): Promise<string> {
  const secret = generateTotpSecret();
  await withTenant(app.db, tenant.id, (tx) =>
    credentialRepository(tx).insert({
      tenantId: tenant.id,
      subjectId: subjectOf(tenant, username),
      type: 'totp',
      secret: { kind: 'totp', secret, digits: 6, lastStep: 0 },
    }),
  );
  return secret;
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

interface Attempt {
  requestId: string;
  res: LightMyRequestResponse;
}

async function submit(tenant: SeededTenant, fields: Record<string, string>): Promise<Attempt> {
  const requestId = `audit-login-${newId()}`;
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/login-actions/authenticate`,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-request-id': requestId },
  });
  return { requestId, res };
}

async function authenticationRows(tenantId: string): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'authentication', limit: 50 }),
  );
}

async function rowsFor(tenant: SeededTenant, attempt: Attempt): Promise<AuditEventRecord[]> {
  return (await authenticationRows(tenant.id)).filter((row) => row.requestId === attempt.requestId);
}

async function onlyRowFor(tenant: SeededTenant, attempt: Attempt): Promise<AuditEventRecord> {
  const rows = await rowsFor(tenant, attempt);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('expected one authentication row');
  return row;
}

// A statement-level trigger fires once per INSERT however many rows it
// carries, so this counts the statements an attempt issued against the
// table, keyed on the request id the transaction was bound to.
async function countAuditInsertStatements(owner: DatabaseHandle): Promise<void> {
  await owner.db.execute(sql`create table audit_insert_statements (request_id text)`);
  await owner.db.execute(sql`
    create function count_audit_insert() returns trigger
      language plpgsql security definer as $$
      begin
        insert into audit_insert_statements values (current_setting('app.request_id', true));
        return null;
      end $$`);
  await owner.db.execute(sql`
    create trigger count_audit_insert after insert on audit_events
      for each statement execute function count_audit_insert()`);
}

async function auditStatementsFor(attempt: Attempt): Promise<number> {
  const rows = await ownerHandle?.db.execute<{ count: number }>(
    sql`select count(*)::int as count from audit_insert_statements
          where request_id = ${attempt.requestId}`,
  );
  return rows?.[0]?.count ?? -1;
}

function comparable(res: LightMyRequestResponse): unknown {
  const headers = Object.fromEntries(
    Object.entries(res.headers).filter(
      ([name]) => !['date', 'x-request-id'].includes(name.toLowerCase()),
    ),
  );
  return { statusCode: res.statusCode, headers, body: res.body };
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  passwordTenant = await seedTenant(
    'audit-login',
    ['alice', 'bob', 'carol', 'dave', 'erin', 'mallory', 'trent'],
    false,
  );
  otpTenant = await seedTenant('audit-login-otp', ['otto', 'rita'], true);
  await countAuditInsertStatements(ownerHandle);

  http = Fastify({ requestIdHeader: 'x-request-id' });
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: ownerHandle,
      kek: Buffer.alloc(32, 13),
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

describe('a password attempt writes one login.password row', () => {
  it('records a correct password as allowed, with the request that made it', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempt = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'alice',
      password: PASSWORD,
    });
    expect(attempt.res.statusCode).toBe(302);

    const row = await onlyRowFor(passwordTenant, attempt);
    expect(row).toMatchObject({
      eventType: 'authentication',
      action: 'login.password',
      outcome: 'allowed',
      actorSubjectId: subjectOf(passwordTenant, 'alice'),
      actorClientId: passwordTenant.clientDbId,
      resourceType: 'authentication_session',
      resourceId: authSessionId,
      requestId: attempt.requestId,
      ip: '127.0.0.1',
    });
    expect(row.detail).toEqual({ factor: 'password' });
  });

  it('records a wrong password as refused, bad_credential, against the account', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempt = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'bob',
      password: WRONG_PASSWORD,
    });
    expect(attempt.res.statusCode).toBe(200);

    const row = await onlyRowFor(passwordTenant, attempt);
    expect(row).toMatchObject({
      action: 'login.password',
      outcome: 'refused',
      actorSubjectId: subjectOf(passwordTenant, 'bob'),
      actorClientId: passwordTenant.clientDbId,
    });
    expect(row.detail).toEqual({ factor: 'password', reason: 'bad_credential' });
  });

  it('records an unknown username with no subject and nothing that was typed', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempt = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'nobody',
      password: WRONG_PASSWORD,
    });

    const row = await onlyRowFor(passwordTenant, attempt);
    expect(row).toMatchObject({
      action: 'login.password',
      outcome: 'refused',
      actorSubjectId: null,
    });
    expect(row.detail).toEqual({ factor: 'password', reason: 'unknown_subject' });
    expect(JSON.stringify(row)).not.toContain('nobody');
    expect(JSON.stringify(row)).not.toContain(WRONG_PASSWORD);
  });
});

describe('the lockout', () => {
  it('writes lockout.tripped once, on the attempt that crossed the threshold', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempts: Attempt[] = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(
        await submit(passwordTenant, {
          auth_session_id: authSessionId,
          username: 'carol',
          password: WRONG_PASSWORD,
        }),
      );
    }

    const tripped = (await authenticationRows(passwordTenant.id)).filter(
      (row) =>
        row.action === 'lockout.tripped' &&
        row.actorSubjectId === subjectOf(passwordTenant, 'carol'),
    );
    expect(tripped).toHaveLength(1);
    expect(tripped[0]).toMatchObject({
      outcome: 'refused',
      requestId: attempts[4]?.requestId,
      resourceType: 'authentication_session',
      resourceId: authSessionId,
    });
    expect(tripped[0]?.detail).toEqual({ reason: 'locked_out' });

    const fifth = attempts[4];
    const sixth = attempts[5];
    if (fifth === undefined || sixth === undefined) throw new Error('expected six attempts');
    expect((await rowsFor(passwordTenant, fifth)).map((row) => row.action).sort()).toEqual([
      'lockout.tripped',
      'login.password',
    ]);
    expect((await onlyRowFor(passwordTenant, sixth)).detail).toEqual({
      factor: 'password',
      reason: 'locked_out',
    });

    const correct = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'carol',
      password: PASSWORD,
    });
    expect(correct.res.statusCode).toBe(200);
    const row = await onlyRowFor(passwordTenant, correct);
    expect(row).toMatchObject({ action: 'login.password', outcome: 'refused' });
    expect(row.detail).toEqual({ factor: 'password', reason: 'locked_out' });
  });

  it('answers a wrong password, an unknown account and a locked one in the same bytes', async () => {
    const locking = await startAuthSession(passwordTenant);
    for (let i = 0; i < 5; i++) {
      await submit(passwordTenant, {
        auth_session_id: locking,
        username: 'mallory',
        password: WRONG_PASSWORD,
      });
    }

    const authSessionId = await startAuthSession(passwordTenant);
    const wrong = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'dave',
      password: WRONG_PASSWORD,
    });
    const unknown = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'nobody-at-all',
      password: WRONG_PASSWORD,
    });
    const locked = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'mallory',
      password: PASSWORD,
    });

    expect(wrong.res.statusCode).toBe(200);
    expect(comparable(unknown.res)).toEqual(comparable(wrong.res));
    expect(comparable(locked.res)).toEqual(comparable(wrong.res));

    const reasons = await Promise.all(
      [wrong, unknown, locked].map(async (attempt) => {
        const row = await onlyRowFor(passwordTenant, attempt);
        return row.detail;
      }),
    );
    expect(reasons).toEqual([
      { factor: 'password', reason: 'bad_credential' },
      { factor: 'password', reason: 'unknown_subject' },
      { factor: 'password', reason: 'locked_out' },
    ]);
  });
});

describe('the audit write costs every refusal the same', () => {
  it('issues one statement for the attempt that trips a lockout, as for an unknown name', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempts: Attempt[] = [];
    for (let i = 0; i < 5; i++) {
      attempts.push(
        await submit(passwordTenant, {
          auth_session_id: authSessionId,
          username: 'trent',
          password: WRONG_PASSWORD,
        }),
      );
    }
    const unknown = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'nobody-else',
      password: WRONG_PASSWORD,
    });
    const tripping = attempts[4];
    const ordinary = attempts[0];
    if (tripping === undefined || ordinary === undefined) throw new Error('expected attempts');

    expect((await rowsFor(passwordTenant, tripping)).map((row) => row.action).sort()).toEqual([
      'lockout.tripped',
      'login.password',
    ]);
    expect(await auditStatementsFor(tripping)).toBe(1);
    expect(await auditStatementsFor(ordinary)).toBe(1);
    expect(await auditStatementsFor(unknown)).toBe(1);
  });
});

describe('second factors', () => {
  it('records the code offered, a wrong code, the accepted one and its replay', async () => {
    const secret = await enrolTotp(otpTenant, 'otto');
    const otto = subjectOf(otpTenant, 'otto');

    const authSessionId = await startAuthSession(otpTenant);
    const password = await submit(otpTenant, {
      auth_session_id: authSessionId,
      username: 'otto',
      password: PASSWORD,
    });
    expect(password.res.statusCode).toBe(200);
    const passwordRows = await rowsFor(otpTenant, password);
    expect(passwordRows.map((row) => [row.action, row.outcome, row.detail]).sort()).toEqual([
      ['factor.offered', 'allowed', { factor: 'otp' }],
      ['login.password', 'allowed', { factor: 'password' }],
    ]);
    expect(passwordRows.every((row) => row.actorSubjectId === otto)).toBe(true);

    const wrongCode = await submit(otpTenant, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(new Date()) + 100),
    });
    expect(wrongCode.res.statusCode).toBe(200);
    const wrongRow = await onlyRowFor(otpTenant, wrongCode);
    expect(wrongRow).toMatchObject({
      action: 'login.otp',
      outcome: 'refused',
      actorSubjectId: otto,
    });
    expect(wrongRow.detail).toEqual({ factor: 'otp', reason: 'bad_credential' });

    const code = totpCode(secret, totpCounter(new Date()));
    const accepted = await submit(otpTenant, { auth_session_id: authSessionId, code });
    expect(accepted.res.statusCode).toBe(302);
    const acceptedRow = await onlyRowFor(otpTenant, accepted);
    expect(acceptedRow).toMatchObject({ action: 'login.otp', outcome: 'allowed' });
    expect(acceptedRow.detail).toEqual({ factor: 'otp' });

    const replaySession = await startAuthSession(otpTenant);
    await submit(otpTenant, {
      auth_session_id: replaySession,
      username: 'otto',
      password: PASSWORD,
    });
    const replay = await submit(otpTenant, { auth_session_id: replaySession, code });
    expect(replay.res.statusCode).toBe(200);
    expect(replay.res.headers.location).toBeUndefined();
    const replayRow = await onlyRowFor(otpTenant, replay);
    expect(replayRow).toMatchObject({
      action: 'login.otp',
      outcome: 'refused',
      actorSubjectId: otto,
    });
    expect(replayRow.detail).toEqual({ factor: 'otp', reason: 'replayed' });
  });

  it('records a recovery code spent twice as already_used the second time', async () => {
    await enrolTotp(otpTenant, 'rita');
    const rita = subjectOf(otpTenant, 'rita');
    const offer = await withTenant(app.db, otpTenant.id, (tx) =>
      beginRecoveryCodes(tx, { tenantId: otpTenant.id, subjectId: rita }),
    );
    const recoveryCode = offer.codes[0] ?? '';

    const first = await startAuthSession(otpTenant);
    await submit(otpTenant, { auth_session_id: first, username: 'rita', password: PASSWORD });
    const spent = await submit(otpTenant, { auth_session_id: first, recovery_code: recoveryCode });
    expect(spent.res.statusCode).toBe(302);
    const spentRow = await onlyRowFor(otpTenant, spent);
    expect(spentRow).toMatchObject({ action: 'login.recovery_code', outcome: 'allowed' });
    expect(spentRow.detail).toEqual({ factor: 'recovery-code' });

    const second = await startAuthSession(otpTenant);
    await submit(otpTenant, { auth_session_id: second, username: 'rita', password: PASSWORD });
    const again = await submit(otpTenant, { auth_session_id: second, recovery_code: recoveryCode });
    expect(again.res.statusCode).toBe(200);
    const againRow = await onlyRowFor(otpTenant, again);
    expect(againRow).toMatchObject({
      action: 'login.recovery_code',
      outcome: 'refused',
      actorSubjectId: rita,
    });
    expect(againRow.detail).toEqual({ factor: 'recovery-code', reason: 'already_used' });
    expect(JSON.stringify(againRow)).not.toContain(recoveryCode);
  });
});

describe('tenant isolation', () => {
  it('shows a tenant no login row written for another', async () => {
    const authSessionId = await startAuthSession(passwordTenant);
    const attempt = await submit(passwordTenant, {
      auth_session_id: authSessionId,
      username: 'erin',
      password: PASSWORD,
    });
    expect(await rowsFor(passwordTenant, attempt)).toHaveLength(1);
    expect(await rowsFor(otpTenant, attempt)).toEqual([]);
  });
});
