import {
  generateSigningKey,
  signingKeyRepository,
  signingKeys,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq, sql } from 'drizzle-orm';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type LightMyRequestResponse,
} from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrants } from '#/schema/token-grants';
import {
  UNLIMITED_AUDIT_REFUSAL_BUDGET,
  type AuditRefusalBudget,
} from '#/service/audit-refusal-budget';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import {
  UNLIMITED_CLIENT_SECRET_LIMITER,
  type ClientSecretLimiter,
} from '#/service/client-secret-throttle';
import {
  buildClientSigningKey,
  jwksDocumentFor,
  signClientAssertion,
} from '#/testing/private-key-jwt-fixture';
import { recordRefusal } from '#/usecase/record-refusal';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
const extraApps: FastifyInstance[] = [];

let app: DatabaseHandle;
let owner: DatabaseHandle;
let http: FastifyInstance;
let logLines: unknown[] = [];

const CLIENT_ID = 'refusals-client';
const OTHER_CLIENT_ID = 'refusals-other';
const PKJ_CLIENT_ID = 'refusals-pkj';
const PKJ_URI_CLIENT_ID = 'refusals-pkj-uri';
const PUBLIC_CLIENT_ID = 'refusals-public';
const TLS_CLIENT_ID = 'refusals-tls';
const TLS_SUBJECT_DN = 'CN=refusals-tls,O=Example';
const CLIENT_SECRET = 'refusals-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const SERVICE_SCOPE = 'reports:read';
const KEK = Buffer.alloc(32, 29);
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const FAILING_AUDIT_PREFIX = 'audit-insert-fails-';
const DISABLE_ON_ROTATE_PREFIX = 'disable-subject-on-rotate-';
const NARROW_ON_ROTATE_PREFIX = 'narrow-audience-on-rotate-';
const API_AUDIENCE = 'https://api.example/';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

let clientKey: SigningKeyRecord;
let strangerKey: SigningKeyRecord;

interface SeededTenant {
  name: string;
  id: string;
  clientDbId: string;
  otherClientDbId: string;
  pkjClientDbId: string;
  pkjUriClientDbId: string;
  publicClientDbId: string;
  tlsClientDbId: string;
  subjectId: string;
}

async function seedClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: {
    clientId: string;
    method: 'client_secret_basic' | 'private_key_jwt' | 'tls_client_auth' | 'none';
    grantTypes: string[];
    jwksUri?: string;
  },
): Promise<string> {
  const dbId = newId();
  const confidential = input.method !== 'none';
  const service = confidential
    ? await subjectRepository(tx).create({ tenantId, type: 'service' })
    : null;
  await tx.insert(clients).values({
    id: dbId,
    tenantId,
    clientId: input.clientId,
    name: input.clientId,
    type: confidential ? 'confidential' : 'public',
    secretHash: confidential ? await hashPassword(CLIENT_SECRET) : null,
    serviceSubjectId: service?.id ?? null,
  });
  await provisionClientDefaults(tx, dbId);
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    tenantId,
    redirectUris: [REDIRECT_URI],
    grantTypes: input.grantTypes,
    tokenEndpointAuthMethod: input.method,
    audiences: input.clientId === CLIENT_ID ? [API_AUDIENCE] : [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    clientCredentialsScopes: [SERVICE_SCOPE],
    jwks:
      input.method === 'private_key_jwt' && input.jwksUri === undefined
        ? jwksDocumentFor(clientKey)
        : null,
    jwksUri: input.jwksUri ?? null,
    tlsClientAuthSubjectDn: input.method === 'tls_client_auth' ? TLS_SUBJECT_DN : null,
  });
  return dbId;
}

async function seedTenant(): Promise<SeededTenant> {
  const name = `audit-refusals-${newId()}`;
  const id = newId();
  let seeded: SeededTenant | undefined;
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name });
    await provisionTenant(tx, id);
    const clientDbId = await seedClient(tx, id, {
      clientId: CLIENT_ID,
      method: 'client_secret_basic',
      grantTypes: [
        'authorization_code',
        'refresh_token',
        'client_credentials',
        TOKEN_EXCHANGE_GRANT,
      ],
    });
    const otherClientDbId = await seedClient(tx, id, {
      clientId: OTHER_CLIENT_ID,
      method: 'client_secret_basic',
      grantTypes: ['authorization_code', 'refresh_token'],
    });
    const pkjClientDbId = await seedClient(tx, id, {
      clientId: PKJ_CLIENT_ID,
      method: 'private_key_jwt',
      grantTypes: ['client_credentials'],
    });
    const pkjUriClientDbId = await seedClient(tx, id, {
      clientId: PKJ_URI_CLIENT_ID,
      method: 'private_key_jwt',
      grantTypes: ['client_credentials'],
      jwksUri: 'https://keys.example/jwks.json',
    });
    const publicClientDbId = await seedClient(tx, id, {
      clientId: PUBLIC_CLIENT_ID,
      method: 'none',
      grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
    });
    const tlsClientDbId = await seedClient(tx, id, {
      clientId: TLS_CLIENT_ID,
      method: 'tls_client_auth',
      grantTypes: ['client_credentials'],
    });
    const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: id,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: id,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
    seeded = {
      name,
      id,
      clientDbId,
      otherClientDbId,
      pkjClientDbId,
      pkjUriClientDbId,
      publicClientDbId,
      tlsClientDbId,
      subjectId: subject.id,
    };
  });
  if (seeded === undefined) throw new Error('tenant was not seeded');
  return seeded;
}

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

function requestIdFor(label: string): string {
  return `refusals-${label}-${newId()}`;
}

function post(
  target: FastifyInstance,
  tenant: SeededTenant,
  endpoint: 'token' | 'revoke' | 'token/introspect',
  fields: Record<string, string>,
  options: { requestId: string; authorization?: string; headers?: Record<string, string> },
): Promise<LightMyRequestResponse> {
  return target.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/protocol/openid-connect/${endpoint}`,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-request-id': options.requestId,
      ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      ...options.headers,
    },
  });
}

function token(
  tenant: SeededTenant,
  fields: Record<string, string>,
  requestId: string,
  authorization: string = basicAuth(CLIENT_ID, CLIENT_SECRET),
  target: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  return post(target, tenant, 'token', fields, { requestId, authorization });
}

function wrongSecret(
  tenant: SeededTenant,
  requestId: string,
  target: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  return token(
    tenant,
    { grant_type: 'client_credentials', scope: SERVICE_SCOPE },
    requestId,
    basicAuth(CLIENT_ID, 'not-the-secret'),
    target,
  );
}

async function loginForCode(tenant: SeededTenant): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const started = await http.inject({
    url: `/tenants/${tenant.name}/protocol/openid-connect/auth?${params.toString()}`,
  });
  expect(started.statusCode).toBe(200);
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(302);
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the redirect');
  return code;
}

function redeem(
  tenant: SeededTenant,
  code: string,
  requestId: string,
  verifier = VERIFIER,
): Promise<LightMyRequestResponse> {
  return token(
    tenant,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
    requestId,
  );
}

async function issuedRefreshToken(tenant: SeededTenant): Promise<string> {
  const res = await redeem(tenant, await loginForCode(tenant), requestIdFor('redeem'));
  expect(res.statusCode).toBe(200);
  const refreshToken = res.json<{ refresh_token?: string }>().refresh_token;
  if (refreshToken === undefined) throw new Error('expected a refresh token');
  return refreshToken;
}

function refresh(
  tenant: SeededTenant,
  refreshToken: string,
  requestId: string,
): Promise<LightMyRequestResponse> {
  return token(tenant, { grant_type: 'refresh_token', refresh_token: refreshToken }, requestId);
}

async function rowsIn(tenant: SeededTenant): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenant.id, (tx) => auditRepository(tx).list({ limit: 100 }));
}

async function rowsFor(tenant: SeededTenant, requestId: string): Promise<AuditEventRecord[]> {
  return (await rowsIn(tenant)).filter((row) => row.requestId === requestId);
}

async function onlyRowFor(tenant: SeededTenant, requestId: string): Promise<AuditEventRecord> {
  const rows = await rowsFor(tenant, requestId);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('expected one row');
  return row;
}

async function grantRevokedAt(grantId: string): Promise<Date | null> {
  const [row] = await owner.db
    .select({ revokedAt: tokenGrants.revokedAt })
    .from(tokenGrants)
    .where(eq(tokenGrants.id, grantId));
  if (row === undefined) throw new Error(`no grant ${grantId}`);
  return row.revokedAt;
}

function reasonOf(row: AuditEventRecord): unknown {
  const detail: unknown = row.detail;
  return typeof detail === 'object' && detail !== null && 'reason' in detail
    ? detail.reason
    : undefined;
}

function comparable(res: LightMyRequestResponse): unknown {
  const headers = Object.fromEntries(
    Object.entries(res.headers).filter(
      ([name]) => !['date', 'x-request-id'].includes(name.toLowerCase()),
    ),
  );
  return { statusCode: res.statusCode, headers, body: res.body };
}

function loggedWith(message: string): Record<string, unknown>[] {
  return logLines.filter(
    (line): line is Record<string, unknown> =>
      typeof line === 'object' && line !== null && 'msg' in line && line.msg === message,
  );
}

function scriptedBudget(answers: ('row' | 'last_row' | 'log')[]): AuditRefusalBudget {
  const remaining = [...answers];
  return { take: () => remaining.shift() ?? 'log' };
}

async function buildHttp(options: {
  budget: AuditRefusalBudget;
  limiter?: ClientSecretLimiter;
  trustProxy?: boolean;
}): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = pino(
    { level: 'info' },
    { write: (line: string) => logLines.push(JSON.parse(line)) },
  );
  const instance = Fastify({ loggerInstance: logger, requestIdHeader: 'x-request-id' });
  await instance.register(formbody);
  await instance.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: options.limiter ?? UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      auditRefusalBudget: options.budget,
      trustProxy: options.trustProxy ?? false,
    }),
  );
  await instance.ready();
  return instance;
}

// Stands in for an audit table that cannot be written: any row bound to a
// request id with this prefix is refused by the database.
async function refuseAuditInsertsForMarkedRequests(): Promise<void> {
  await owner.db.execute(sql`
    create function refuse_marked_audit_insert() returns trigger
      language plpgsql as $$
      begin
        if new.request_id like 'audit-insert-fails-%' then
          raise exception 'audit_events refused this row';
        end if;
        return new;
      end $$`);
  await owner.db.execute(sql`
    create trigger refuse_marked_audit_insert before insert on audit_events
      for each row execute function refuse_marked_audit_insert()`);
}

// Disables the grant's subject in the same transaction that consumes its
// refresh token, so the check after rotation sees a subject the check
// before it did not — the window a concurrent admin action would open.
async function disableSubjectOnMarkedRotation(): Promise<void> {
  await owner.db.execute(sql`
    create function disable_subject_on_rotate() returns trigger
      language plpgsql security definer as $$
      begin
        if old.used_at is null and new.used_at is not null
           and current_setting('app.request_id', true) like 'disable-subject-on-rotate-%' then
          update subjects set disabled_at = now()
            where id = (select subject_id from token_grants where id = new.grant_id);
        end if;
        return new;
      end $$`);
  await owner.db.execute(sql`
    create trigger disable_subject_on_rotate after update on refresh_tokens
      for each row execute function disable_subject_on_rotate()`);
}

// Empties the grant's audience as its refresh token is consumed, so the
// audience check after rotation refuses a `resource` the check before it
// admitted — ADR 0019's revocation race, driven deterministically.
async function narrowAudienceOnMarkedRotation(): Promise<void> {
  await owner.db.execute(sql`
    create function narrow_audience_on_rotate() returns trigger
      language plpgsql security definer as $$
      begin
        if old.used_at is null and new.used_at is not null
           and current_setting('app.request_id', true) like 'narrow-audience-on-rotate-%' then
          update token_grants set audience = '{}' where id = new.grant_id;
        end if;
        return new;
      end $$`);
  await owner.db.execute(sql`
    create trigger narrow_audience_on_rotate after update on refresh_tokens
      for each row execute function narrow_audience_on_rotate()`);
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  await refuseAuditInsertsForMarkedRequests();
  await disableSubjectOnMarkedRotation();
  await narrowAudienceOnMarkedRotation();

  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  clientKey = await buildClientSigningKey(KEK);
  strangerKey = await buildClientSigningKey(KEK);

  http = await buildHttp({ budget: UNLIMITED_AUDIT_REFUSAL_BUDGET });
}, 120_000);

afterAll(async () => {
  await http.close();
  for (const extra of extraApps) await extra.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('client authentication refusals', () => {
  it('records a wrong secret for a registered client without changing the 401', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('wrong-secret');

    const audited = await wrongSecret(tenant, requestId);
    const unaudited = await wrongSecret(tenant, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(audited.statusCode).toBe(401);
    expect(audited.json()).toEqual({ error: 'invalid_client' });
    expect(comparable(audited)).toEqual(comparable(unaudited));
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      eventType: 'authentication',
      action: 'client.authenticate',
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      actorSubjectId: null,
      detail: { method: 'client_secret_basic', reason: 'bad_credential' },
    });
    expect(await rowsIn(tenant)).toHaveLength(1);
  });

  it('writes nothing for an unregistered client_id, and names it in a warn line', async () => {
    const tenant = await seedTenant();
    logLines = [];

    const res = await token(
      tenant,
      { grant_type: 'client_credentials' },
      requestIdFor('unknown-client'),
      basicAuth('no-such-client', CLIENT_SECRET),
    );

    expect(res.statusCode).toBe(401);
    expect(await rowsIn(tenant)).toEqual([]);
    expect(loggedWith('client authentication refused for an unregistered client_id')).toEqual([
      expect.objectContaining({ tenantId: tenant.id, claimedClientId: 'no-such-client' }),
    ]);
  });

  it('writes one rate_limited row when the budget trips, then only logs', async () => {
    const tenant = await seedTenant();
    const budgeted = await buildHttp({
      budget: scriptedBudget(['row', 'row', 'last_row', 'log', 'log']),
    });
    extraApps.push(budgeted);
    logLines = [];

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await wrongSecret(tenant, requestIdFor('budget'), budgeted)).statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    const reasons = (await rowsIn(tenant)).map((row) => reasonOf(row)).sort();
    expect(reasons).toEqual(['bad_credential', 'bad_credential', 'rate_limited']);
    expect(loggedWith('refusal not recorded: audit budget for this client is spent')).toHaveLength(
      2,
    );
  });

  it('records the rate_limited refusal the client secret limiter answers with 429', async () => {
    const tenant = await seedTenant();
    const limited = await buildHttp({
      budget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      limiter: { check: () => ({ allowed: false, retryAfterSeconds: 7 }) },
    });
    extraApps.push(limited);
    const requestId = requestIdFor('limited');

    const res = await wrongSecret(tenant, requestId, limited);

    expect(res.statusCode).toBe(429);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'client.authenticate',
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      detail: { method: 'client_secret_basic', reason: 'rate_limited' },
    });
  });

  it('records a bad private_key_jwt assertion and still answers 401, not 429', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('pkj');
    const assertion = await signClientAssertion({
      key: strangerKey,
      clientId: PKJ_CLIENT_ID,
      audience: `http://localhost/tenants/${tenant.name}/protocol/openid-connect/token`,
      kek: KEK,
    });

    const res = await post(
      http,
      tenant,
      'token',
      {
        grant_type: 'client_credentials',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      },
      { requestId },
    );

    expect(res.statusCode).toBe(401);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'client.authenticate',
      outcome: 'refused',
      actorClientId: tenant.pkjClientDbId,
      detail: { method: 'private_key_jwt', reason: 'bad_credential' },
    });
  });
});

describe('refusals after the client authenticated', () => {
  it('records a refused code redemption and no token.issue row', async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    const requestId = requestIdFor('bad-verifier');

    const res = await redeem(tenant, code, requestId, 'x'.repeat(43));

    expect(res.statusCode).toBe(400);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      eventType: 'token',
      action: 'token.issue',
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      detail: { reason: 'invalid_grant' },
    });
  });

  it('answers a refused redemption identically whether or not its row is written', async () => {
    const tenant = await seedTenant();
    const audited = await redeem(
      tenant,
      await loginForCode(tenant),
      requestIdFor('audited'),
      'x'.repeat(43),
    );
    const unaudited = await redeem(
      tenant,
      await loginForCode(tenant),
      `${FAILING_AUDIT_PREFIX}${newId()}`,
      'x'.repeat(43),
    );

    expect(comparable(audited)).toEqual(comparable(unaudited));
  });

  it('records the grant a replayed code revoked beside the replay refusal', async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    const first = await redeem(tenant, code, requestIdFor('first'));
    expect(first.statusCode).toBe(200);
    const requestId = requestIdFor('replay');

    const res = await redeem(tenant, code, requestId);

    expect(res.statusCode).toBe(400);
    const rows = await rowsFor(tenant, requestId);
    const revoked = rows.find((row) => row.action === 'grant.revoked_on_code_replay');
    const refused = rows.find((row) => row.action === 'token.issue');
    expect(rows).toHaveLength(2);
    expect(revoked).toMatchObject({
      outcome: 'allowed',
      actorClientId: tenant.clientDbId,
      actorSubjectId: tenant.subjectId,
      resourceType: 'grant',
      detail: { reason: 'replayed' },
    });
    expect(refused).toMatchObject({
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      resourceId: revoked?.resourceId,
      detail: { reason: 'replayed' },
    });
  });

  it('records a code replayed three times as one revocation, not three', async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    expect((await redeem(tenant, code, requestIdFor('first'))).statusCode).toBe(200);

    const replays: LightMyRequestResponse[] = [];
    for (const label of ['replay-1', 'replay-2', 'replay-3']) {
      replays.push(await redeem(tenant, code, requestIdFor(label)));
    }

    expect(replays.map((res) => res.statusCode)).toEqual([400, 400, 400]);
    expect(new Set(replays.map((res) => JSON.stringify(comparable(res)))).size).toBe(1);
    const rows = await rowsIn(tenant);
    expect(rows.filter((row) => row.action === 'grant.revoked_on_code_replay')).toHaveLength(1);
    expect(
      rows.filter((row) => row.action === 'token.issue' && row.outcome === 'refused'),
    ).toHaveLength(3);
  });

  it("names the code's own client on the revocation, and the replaying one on the refusal", async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    expect((await redeem(tenant, code, requestIdFor('first'))).statusCode).toBe(200);
    const requestId = requestIdFor('foreign-replay');

    const res = await token(
      tenant,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
      },
      requestId,
      basicAuth(OTHER_CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.statusCode).toBe(400);
    const rows = await rowsFor(tenant, requestId);
    expect(rows.find((row) => row.action === 'grant.revoked_on_code_replay')).toMatchObject({
      actorClientId: tenant.clientDbId,
    });
    expect(rows.find((row) => row.action === 'token.issue')).toMatchObject({
      outcome: 'refused',
      actorClientId: tenant.otherClientDbId,
    });
  });

  it('records refresh-token reuse repeated three times as one revoked family', async () => {
    const tenant = await seedTenant();
    const original = await issuedRefreshToken(tenant);
    expect((await refresh(tenant, original, requestIdFor('rotate'))).statusCode).toBe(200);

    for (const label of ['reuse-1', 'reuse-2', 'reuse-3']) {
      expect((await refresh(tenant, original, requestIdFor(label))).statusCode).toBe(400);
    }

    const rows = await rowsIn(tenant);
    expect(rows.filter((row) => row.action === 'grant.revoked_on_reuse')).toHaveLength(1);
  });

  it('keeps a replay revocation whose audit row cannot be written', async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    const first = await redeem(tenant, code, requestIdFor('first'));
    const grantId = (await rowsIn(tenant)).find((row) => row.action === 'token.issue')?.resourceId;
    if (grantId === null || grantId === undefined) throw new Error('expected an issued grant');
    expect(first.statusCode).toBe(200);

    const res = await redeem(tenant, code, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(res.statusCode).toBe(400);
    expect(await grantRevokedAt(grantId)).not.toBeNull();
  });

  it('records reuse of a refresh token as a revoked family and a replayed refusal', async () => {
    const tenant = await seedTenant();
    const original = await issuedRefreshToken(tenant);
    expect((await refresh(tenant, original, requestIdFor('rotate'))).statusCode).toBe(200);
    const requestId = requestIdFor('reuse');

    const res = await refresh(tenant, original, requestId);

    expect(res.statusCode).toBe(400);
    const rows = await rowsFor(tenant, requestId);
    expect(rows).toHaveLength(2);
    const revoked = rows.find((row) => row.action === 'grant.revoked_on_reuse');
    expect(revoked).toMatchObject({
      outcome: 'allowed',
      actorClientId: tenant.clientDbId,
      actorSubjectId: tenant.subjectId,
      resourceType: 'grant',
      detail: { reason: 'replayed' },
    });
    expect(rows.find((row) => row.action === 'token.refresh')).toMatchObject({
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      resourceId: revoked?.resourceId,
      detail: { reason: 'replayed' },
    });
  });

  it('keeps a reuse revocation whose audit row cannot be written', async () => {
    const tenant = await seedTenant();
    const original = await issuedRefreshToken(tenant);
    const rotated = await refresh(tenant, original, requestIdFor('rotate'));
    expect(rotated.statusCode).toBe(200);
    const grantId = (await rowsIn(tenant)).find(
      (row) => row.action === 'token.refresh',
    )?.resourceId;
    if (grantId === null || grantId === undefined) throw new Error('expected a rotated grant');

    const res = await refresh(tenant, original, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(res.statusCode).toBe(400);
    expect(await grantRevokedAt(grantId)).not.toBeNull();
  });

  it('records both the committed rotation and the refusal that follows it', async () => {
    const tenant = await seedTenant();
    const original = await issuedRefreshToken(tenant);
    const requestId = `${DISABLE_ON_ROTATE_PREFIX}${newId()}`;

    const res = await refresh(tenant, original, requestId);

    expect(res.statusCode).toBe(400);
    const rows = await rowsFor(tenant, requestId);
    expect(rows.map((row) => `${row.action}:${row.outcome}`).sort()).toEqual([
      'token.refresh:allowed',
      'token.refresh:refused',
    ]);
    expect(rows.find((row) => row.outcome === 'refused')?.detail).toEqual({
      reason: 'invalid_grant',
    });
  });

  it('refuses a resource the grant lost during rotation, after rotating', async () => {
    const tenant = await seedTenant();
    const original = await issuedRefreshToken(tenant);
    const requestId = `${NARROW_ON_ROTATE_PREFIX}${newId()}`;

    const res = await token(
      tenant,
      { grant_type: 'refresh_token', refresh_token: original, resource: API_AUDIENCE },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_target' });
    const rows = await rowsFor(tenant, requestId);
    expect(rows.map((row) => `${row.action}:${row.outcome}`).sort()).toEqual([
      'token.refresh:allowed',
      'token.refresh:refused',
    ]);
    expect(rows.find((row) => row.outcome === 'refused')?.detail).toEqual({
      reason: 'invalid_target',
    });
  });

  it('records a grant type the client is not registered for', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('unauthorized');

    const res = await token(
      tenant,
      { grant_type: 'client_credentials' },
      requestId,
      basicAuth(OTHER_CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.statusCode).toBe(400);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.issue',
      outcome: 'refused',
      actorClientId: tenant.otherClientDbId,
      detail: { reason: 'unauthorized_client' },
    });
  });

  it('records a scope the client may not have', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('scope');

    const res = await token(tenant, { grant_type: 'client_credentials', scope: 'nope' }, requestId);

    expect(res.statusCode).toBe(400);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.issue',
      outcome: 'refused',
      detail: { reason: 'invalid_scope' },
    });
  });
});

function accessTokenFrom(res: LightMyRequestResponse): string {
  expect(res.statusCode).toBe(200);
  const accessToken = res.json<{ access_token?: string }>().access_token;
  if (accessToken === undefined) throw new Error('expected an access token');
  return accessToken;
}

async function signInAccessToken(tenant: SeededTenant): Promise<string> {
  return accessTokenFrom(await redeem(tenant, await loginForCode(tenant), requestIdFor('redeem')));
}

async function serviceAccessToken(tenant: SeededTenant): Promise<string> {
  return accessTokenFrom(
    await token(
      tenant,
      { grant_type: 'client_credentials', scope: SERVICE_SCOPE },
      requestIdFor('service'),
    ),
  );
}

function claimsOf(jwt: string): Record<string, unknown> {
  const claims: unknown = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString());
  if (typeof claims !== 'object' || claims === null) throw new Error('malformed token');
  return Object.fromEntries(Object.entries(claims));
}

// Nothing mints `may_act`, so a real grant-backed access token is re-signed
// with the claim added, the way token-exchange.int.test.ts exercises it.
async function withMayAct(tenant: SeededTenant, accessToken: string, sub: string): Promise<string> {
  const key = await withTenant(app.db, tenant.id, (tx) => signingKeyRepository(tx).active());
  return signJwt({ ...claimsOf(accessToken), may_act: { sub } }, { key, kek: KEK, typ: 'at+jwt' });
}

function exchange(
  tenant: SeededTenant,
  fields: Record<string, string>,
  requestId: string,
): Promise<LightMyRequestResponse> {
  return token(tenant, { grant_type: TOKEN_EXCHANGE_GRANT, ...fields }, requestId);
}

describe('refused token exchanges', () => {
  it('records a subject token that is not a token this server issued', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('exchange-bad-subject');

    const res = await exchange(
      tenant,
      {
        subject_token: 'not-a-token',
        subject_token_type: ACCESS_TOKEN_TYPE,
        actor_token: await serviceAccessToken(tenant),
        actor_token_type: ACCESS_TOKEN_TYPE,
      },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      eventType: 'token',
      action: 'token.exchange',
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      detail: { reason: 'invalid_grant' },
    });
  });

  it('records an actor token whose grant was revoked', async () => {
    const tenant = await seedTenant();
    const actor = await serviceAccessToken(tenant);
    const actorGrant = claimsOf(actor).grant_id;
    if (typeof actorGrant !== 'string') throw new Error('expected a grant_id');
    await owner.db
      .update(tokenGrants)
      .set({ revokedAt: new Date() })
      .where(eq(tokenGrants.id, actorGrant));
    const requestId = requestIdFor('exchange-revoked-actor');

    const res = await exchange(
      tenant,
      {
        subject_token: await signInAccessToken(tenant),
        subject_token_type: ACCESS_TOKEN_TYPE,
        actor_token: actor,
        actor_token_type: ACCESS_TOKEN_TYPE,
      },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.exchange',
      outcome: 'refused',
      actorSubjectId: tenant.subjectId,
      detail: { reason: 'invalid_grant' },
    });
  });

  it('records an actor token whose act chain cannot be extended', async () => {
    const tenant = await seedTenant();
    const service = await serviceAccessToken(tenant);
    const key = await withTenant(app.db, tenant.id, (tx) => signingKeyRepository(tx).active());
    const actor = await signJwt(
      { ...claimsOf(service), act: 'not-an-act-claim' },
      { key, kek: KEK, typ: 'at+jwt' },
    );
    const requestId = requestIdFor('exchange-act-chain');

    const res = await exchange(
      tenant,
      {
        subject_token: await signInAccessToken(tenant),
        subject_token_type: ACCESS_TOKEN_TYPE,
        actor_token: actor,
        actor_token_type: ACCESS_TOKEN_TYPE,
      },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.exchange',
      outcome: 'refused',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      detail: { reason: 'invalid_grant' },
    });
  });

  it('records an actor the subject token does not name in may_act', async () => {
    const tenant = await seedTenant();
    const subjectToken = await withMayAct(tenant, await signInAccessToken(tenant), newId());
    const requestId = requestIdFor('exchange-may-act');

    const res = await exchange(
      tenant,
      {
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        actor_token: await serviceAccessToken(tenant),
        actor_token_type: ACCESS_TOKEN_TYPE,
      },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.exchange',
      outcome: 'refused',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      detail: { reason: 'subject_mismatch' },
    });
  });

  it('records a token type this server does not exchange', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('exchange-token-type');

    const res = await exchange(
      tenant,
      {
        subject_token: await signInAccessToken(tenant),
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        actor_token: await serviceAccessToken(tenant),
        actor_token_type: ACCESS_TOKEN_TYPE,
      },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.exchange',
      outcome: 'refused',
      detail: { reason: 'unsupported_token_type' },
    });
  });

  it('records impersonation by a client not permitted it as unauthorized_client', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('exchange-impersonation');

    const res = await exchange(
      tenant,
      { subject_token: await signInAccessToken(tenant), subject_token_type: ACCESS_TOKEN_TYPE },
      requestId,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unauthorized_client' });
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.exchange',
      outcome: 'refused',
      detail: { reason: 'unauthorized_client' },
    });
  });

  it('writes nothing for an exchange missing its subject_token, which is malformed', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('exchange-malformed');

    const res = await exchange(tenant, { subject_token_type: ACCESS_TOKEN_TYPE }, requestId);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(await rowsFor(tenant, requestId)).toEqual([]);
  });

  it('answers a refused exchange identically whether or not its row is written', async () => {
    const tenant = await seedTenant();
    const fields = {
      subject_token: 'not-a-token',
      subject_token_type: ACCESS_TOKEN_TYPE,
      actor_token: await serviceAccessToken(tenant),
      actor_token_type: ACCESS_TOKEN_TYPE,
    };

    const audited = await exchange(tenant, fields, requestIdFor('exchange-audited'));
    const unaudited = await exchange(tenant, fields, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(comparable(audited)).toEqual(comparable(unaudited));
  });
});

describe('/revoke', () => {
  it("records a refusal to revoke another client's grant", async () => {
    const tenant = await seedTenant();
    const refreshToken = await issuedRefreshToken(tenant);
    const requestId = requestIdFor('revoke-other');

    const res = await post(
      http,
      tenant,
      'revoke',
      { token: refreshToken },
      { requestId, authorization: basicAuth(OTHER_CLIENT_ID, CLIENT_SECRET) },
    );

    expect(res.statusCode).toBe(400);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      eventType: 'token',
      action: 'token.revoke',
      outcome: 'refused',
      actorClientId: tenant.otherClientDbId,
      actorSubjectId: tenant.subjectId,
      resourceType: 'grant',
      detail: { reason: 'invalid_grant' },
    });
  });

  it('records a successful revocation', async () => {
    const tenant = await seedTenant();
    const refreshToken = await issuedRefreshToken(tenant);
    const requestId = requestIdFor('revoke');

    const res = await post(
      http,
      tenant,
      'revoke',
      { token: refreshToken },
      { requestId, authorization: basicAuth(CLIENT_ID, CLIENT_SECRET) },
    );

    expect(res.statusCode).toBe(200);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.revoke',
      outcome: 'allowed',
      actorClientId: tenant.clientDbId,
      actorSubjectId: tenant.subjectId,
      resourceType: 'grant',
    });
  });

  it('records a wrong secret at /revoke as a client authentication refusal', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('revoke-wrong-secret');

    const res = await post(
      http,
      tenant,
      'revoke',
      { token: 'anything' },
      { requestId, authorization: basicAuth(CLIENT_ID, 'not-the-secret') },
    );

    expect(res.statusCode).toBe(401);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'client.authenticate',
      detail: { method: 'client_secret_basic', reason: 'bad_credential' },
    });
  });
});

describe('the budget after authentication', () => {
  it("bounds a public client's refusals, which prove nothing about who sent them", async () => {
    const tenant = await seedTenant();
    const budgeted = await buildHttp({
      budget: scriptedBudget(['row', 'row', 'last_row', 'log', 'log', 'log']),
    });
    extraApps.push(budgeted);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await post(
        budgeted,
        tenant,
        'token',
        {
          grant_type: 'refresh_token',
          refresh_token: `random-${newId()}`,
          client_id: PUBLIC_CLIENT_ID,
        },
        { requestId: requestIdFor('public-spray') },
      );
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    const rows = await rowsIn(tenant);
    expect(rows.map((row) => `${row.action}:${String(reasonOf(row))}`).sort()).toEqual([
      'token.refresh:invalid_grant',
      'token.refresh:invalid_grant',
      'token.refresh:rate_limited',
    ]);
    expect(rows.every((row) => row.actorClientId === tenant.publicClientDbId)).toBe(true);
  });

  it('records a public client asking for client_credentials as unauthorized_client', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('public-cc');

    const res = await post(
      http,
      tenant,
      'token',
      { grant_type: 'client_credentials', client_id: PUBLIC_CLIENT_ID },
      { requestId },
    );

    expect(res.statusCode).toBe(401);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'token.issue',
      outcome: 'refused',
      actorClientId: tenant.publicClientDbId,
      detail: { reason: 'unauthorized_client' },
    });
  });
});

describe('client authentication by other methods', () => {
  it('records a certificate subject that does not match a registered tls_client_auth client', async () => {
    const tenant = await seedTenant();
    const trusted = await buildHttp({ budget: UNLIMITED_AUDIT_REFUSAL_BUDGET, trustProxy: true });
    extraApps.push(trusted);
    const requestId = requestIdFor('tls');

    const res = await post(
      trusted,
      tenant,
      'token',
      { grant_type: 'client_credentials', client_id: TLS_CLIENT_ID },
      { requestId, headers: { 'x-ssl-client-s-dn': 'CN=someone-else' } },
    );

    expect(res.statusCode).toBe(401);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      action: 'client.authenticate',
      outcome: 'refused',
      actorClientId: tenant.tlsClientDbId,
      detail: { method: 'tls_client_auth', reason: 'bad_credential' },
    });
  });

  it('writes no row when a jwks_uri cannot be fetched, which is not the client failing', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('pkj-uri');
    logLines = [];
    const assertion = await signClientAssertion({
      key: clientKey,
      clientId: PKJ_URI_CLIENT_ID,
      audience: `http://localhost/tenants/${tenant.name}/protocol/openid-connect/token`,
      kek: KEK,
    });

    const res = await post(
      http,
      tenant,
      'token',
      {
        grant_type: 'client_credentials',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      },
      { requestId },
    );

    expect(res.statusCode).toBe(401);
    expect(await rowsIn(tenant)).toEqual([]);
    expect(loggedWith('private_key_jwt authentication refused')).toHaveLength(1);
  });
});

describe('/introspect', () => {
  it('records a wrong secret for a registered client', async () => {
    const tenant = await seedTenant();
    const requestId = requestIdFor('introspect-wrong-secret');

    const res = await post(
      http,
      tenant,
      'token/introspect',
      { token: 'anything' },
      { requestId, authorization: basicAuth(CLIENT_ID, 'not-the-secret') },
    );

    expect(res.statusCode).toBe(401);
    expect(await onlyRowFor(tenant, requestId)).toMatchObject({
      eventType: 'authentication',
      action: 'client.authenticate',
      outcome: 'refused',
      actorClientId: tenant.clientDbId,
      detail: { method: 'client_secret_basic', reason: 'bad_credential' },
    });
  });

  it('writes nothing for an unregistered client_id', async () => {
    const tenant = await seedTenant();

    const res = await post(
      http,
      tenant,
      'token/introspect',
      { token: 'anything' },
      {
        requestId: requestIdFor('introspect-unknown'),
        authorization: basicAuth('no-such-client', 'anything'),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(await rowsIn(tenant)).toEqual([]);
  });
});

describe('recordRefusal', () => {
  const context = { requestId: 'record-refusal', ip: '203.0.113.1' };
  const audit = {
    action: 'client.authenticate',
    reason: 'bad_credential',
    clientDbId: newId(),
    method: 'client_secret_basic',
  } as const;
  const unreachable: DatabaseHandle = {
    db: {
      transaction: () => Promise.reject(new Error('database unreachable')),
    } as unknown as DatabaseHandle['db'],
    sql: (() =>
      Promise.reject(new Error('database unreachable'))) as unknown as DatabaseHandle['sql'],
    close: () => Promise.resolve(),
  };

  it('logs a database failure at error and does not throw', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };

    await expect(
      recordRefusal(
        { database: unreachable, logger, budget: UNLIMITED_AUDIT_REFUSAL_BUDGET },
        newId(),
        context,
        audit,
      ),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('does nothing for a refusal that carries no audit', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const budget = { take: vi.fn(() => 'row' as const) };

    await recordRefusal({ database: unreachable, logger, budget }, newId(), context, undefined);

    expect(budget.take).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('spends the budget for a refusal after authentication too', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const budget = { take: vi.fn(() => 'log' as const) };

    await recordRefusal({ database: unreachable, logger, budget }, newId(), context, {
      action: 'token.refresh',
      reason: 'invalid_grant',
      clientDbId: newId(),
    });

    expect(budget.take).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs at warn, without touching the database, once the budget is spent', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };

    await recordRefusal(
      { database: unreachable, logger, budget: { take: () => 'log' } },
      newId(),
      context,
      audit,
    );

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('tenant isolation', () => {
  it('shows a tenant no refusal row written for another', async () => {
    const tenant = await seedTenant();
    const other = await seedTenant();
    const requestId = requestIdFor('isolated-wrong-secret');

    expect((await wrongSecret(tenant, requestId)).statusCode).toBe(401);

    await onlyRowFor(tenant, requestId);
    expect(await rowsIn(other)).toEqual([]);
  });
});
