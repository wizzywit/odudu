import { generateSigningKey, signingKeys } from '@odudu/crypto';
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

const CLIENT_ID = 'audit-tokens-client';
const CLIENT_SECRET = 'audit-tokens-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const SERVICE_SCOPE = 'reports:read';
const KEK = Buffer.alloc(32, 23);
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const REFRESH_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:refresh_token';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';

interface SeededTenant {
  name: string;
  id: string;
  clientDbId: string;
  subjectId: string;
}

type TokenBody = Record<string, string | undefined>;

async function seedTenant(): Promise<SeededTenant> {
  const name = `audit-tokens-${newId()}`;
  const id = newId();
  const clientDbId = newId();
  let subjectId = '';
  await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name });
    await provisionTenant(tx, id);
    const service = await subjectRepository(tx).create({ tenantId: id, type: 'service' });
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId: id,
      clientId: CLIENT_ID,
      name: 'Audit tokens test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
      serviceSubjectId: service.id,
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId: id,
      redirectUris: [REDIRECT_URI],
      grantTypes: [
        'authorization_code',
        'refresh_token',
        'client_credentials',
        TOKEN_EXCHANGE_GRANT,
      ],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [SERVICE_SCOPE],
      tokenExchangeImpersonationAllowed: true,
    });
    const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
    subjectId = subject.id;
    await tx.insert(users).values({ subjectId, tenantId: id, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: id,
      subjectId,
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
  });
  return { name, id, clientDbId, subjectId };
}

function codeFrom(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the redirect');
  return code;
}

async function loginForCode(tenant: SeededTenant, scope = 'openid'): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
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
  return codeFrom(res);
}

async function tokenRequest(
  tenant: SeededTenant,
  fields: Record<string, string>,
  requestId = `audit-tokens-${newId()}`,
): Promise<TokenBody> {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/protocol/openid-connect/token`,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-request-id': requestId,
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<TokenBody>();
}

function redeem(tenant: SeededTenant, code: string, requestId?: string): Promise<TokenBody> {
  return tokenRequest(
    tenant,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    },
    requestId,
  );
}

function clientCredentials(tenant: SeededTenant, requestId?: string): Promise<TokenBody> {
  return tokenRequest(
    tenant,
    { grant_type: 'client_credentials', scope: SERVICE_SCOPE },
    requestId,
  );
}

function exchange(
  tenant: SeededTenant,
  subjectToken: string,
  actorToken: string | undefined,
  requestId?: string,
  requestedTokenType?: string,
): Promise<TokenBody> {
  return tokenRequest(
    tenant,
    {
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      ...(requestedTokenType === undefined ? {} : { requested_token_type: requestedTokenType }),
      ...(actorToken === undefined
        ? {}
        : { actor_token: actorToken, actor_token_type: ACCESS_TOKEN_TYPE }),
    },
    requestId,
  );
}

function present(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`expected ${name} in the token response`);
  return value;
}

function grantIdOf(accessToken: string | undefined): unknown {
  const payload = present(accessToken, 'access_token').split('.')[1];
  if (payload === undefined) throw new Error('malformed access token');
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof claims !== 'object' || claims === null || !('grant_id' in claims)) return undefined;
  return claims.grant_id;
}

async function tokenRows(tenant: SeededTenant, action?: string): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenant.id, (tx) =>
    auditRepository(tx).list({ eventType: 'token', action, limit: 50 }),
  );
}

function onlyRow(rows: readonly AuditEventRecord[]): AuditEventRecord {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('expected one row');
  return row;
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
      kek: KEK,
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

describe('token.issue', () => {
  it('is written once by a code redemption, naming the grant it created', async () => {
    const tenant = await seedTenant();
    const requestId = `audit-tokens-code-${newId()}`;
    const issued = await redeem(tenant, await loginForCode(tenant), requestId);

    const row = onlyRow(await tokenRows(tenant));
    expect(row).toMatchObject({
      eventType: 'token',
      action: 'token.issue',
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      resourceType: 'grant',
      requestId,
      detail: { grant_type: 'authorization_code', scope: 'openid' },
    });
    expect(row.resourceId).toBe(grantIdOf(issued.access_token));
  });

  it('is written by a client_credentials grant with no subject', async () => {
    const tenant = await seedTenant();
    const requestId = `audit-tokens-cc-${newId()}`;
    const issued = await clientCredentials(tenant, requestId);

    const row = onlyRow(await tokenRows(tenant));
    expect(row).toMatchObject({
      action: 'token.issue',
      outcome: 'allowed',
      actorSubjectId: null,
      actorClientId: tenant.clientDbId,
      resourceType: 'grant',
      requestId,
      detail: { grant_type: 'client_credentials', scope: SERVICE_SCOPE },
    });
    expect(row.resourceId).toBe(grantIdOf(issued.access_token));
  });
});

describe('token.refresh', () => {
  it('is written once by a refresh, naming the rotated grant', async () => {
    const tenant = await seedTenant();
    const issued = await redeem(tenant, await loginForCode(tenant));
    const requestId = `audit-tokens-refresh-${newId()}`;

    const refreshed = await tokenRequest(
      tenant,
      { grant_type: 'refresh_token', refresh_token: present(issued.refresh_token, 'refresh') },
      requestId,
    );

    const row = onlyRow(await tokenRows(tenant, 'token.refresh'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      resourceType: 'grant',
      resourceId: grantIdOf(issued.access_token),
      requestId,
      detail: { scope: 'openid' },
    });
    expect(grantIdOf(refreshed.access_token)).toBe(row.resourceId);
  });

  it("records the narrower scope a refresh asked for, not the grant's", async () => {
    const tenant = await seedTenant();
    const issued = await redeem(tenant, await loginForCode(tenant, 'openid email'));
    expect(issued.scope).toBe('openid email');

    const refreshed = await tokenRequest(tenant, {
      grant_type: 'refresh_token',
      refresh_token: present(issued.refresh_token, 'refresh_token'),
      scope: 'openid',
    });
    expect(refreshed.scope).toBe('openid');

    const row = onlyRow(await tokenRows(tenant, 'token.refresh'));
    expect(row.detail).toEqual({ scope: 'openid' });
  });
});

describe('token.exchange', () => {
  it('is written with mode delegation when an actor token is presented', async () => {
    const tenant = await seedTenant();
    const subject = await redeem(tenant, await loginForCode(tenant));
    const actor = await clientCredentials(tenant);
    const requestId = `audit-tokens-delegation-${newId()}`;

    const exchanged = await exchange(
      tenant,
      present(subject.access_token, 'access_token'),
      present(actor.access_token, 'access_token'),
      requestId,
    );

    const row = onlyRow(await tokenRows(tenant, 'token.exchange'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      resourceType: 'grant',
      requestId,
      detail: { mode: 'delegation', scope: 'openid', requested_token_type: ACCESS_TOKEN_TYPE },
    });
    expect(row.resourceId).toBe(grantIdOf(exchanged.access_token));
  });

  it('is written with mode impersonation when no actor token is presented', async () => {
    const tenant = await seedTenant();
    const subject = await redeem(tenant, await loginForCode(tenant));
    const requestId = `audit-tokens-impersonation-${newId()}`;

    const exchanged = await exchange(
      tenant,
      present(subject.access_token, 'access_token'),
      undefined,
      requestId,
    );

    const row = onlyRow(await tokenRows(tenant, 'token.exchange'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      requestId,
      detail: { mode: 'impersonation', scope: 'openid', requested_token_type: ACCESS_TOKEN_TYPE },
    });
    expect(row.resourceId).toBe(grantIdOf(exchanged.access_token));
  });

  it('names the grant a refresh-token exchange creates', async () => {
    const tenant = await seedTenant();
    const subject = await redeem(tenant, await loginForCode(tenant));
    const subjectToken = present(subject.access_token, 'access_token');

    const exchanged = await exchange(
      tenant,
      subjectToken,
      undefined,
      undefined,
      REFRESH_TOKEN_TYPE,
    );

    const row = onlyRow(await tokenRows(tenant, 'token.exchange'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      resourceType: 'grant',
      detail: { mode: 'impersonation', scope: 'openid', requested_token_type: REFRESH_TOKEN_TYPE },
    });
    expect(row.resourceId).not.toBe(grantIdOf(subjectToken));
    const refreshed = await tokenRequest(tenant, {
      grant_type: 'refresh_token',
      refresh_token: present(exchanged.access_token, 'access_token'),
    });
    expect(grantIdOf(refreshed.access_token)).toBe(row.resourceId);
  });

  it('names no resource for an id_token exchange, which creates no grant', async () => {
    const tenant = await seedTenant();
    const subject = await redeem(tenant, await loginForCode(tenant));

    await exchange(
      tenant,
      present(subject.access_token, 'access_token'),
      undefined,
      undefined,
      ID_TOKEN_TYPE,
    );

    const row = onlyRow(await tokenRows(tenant, 'token.exchange'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      resourceType: null,
      resourceId: null,
      detail: { mode: 'impersonation', scope: 'openid', requested_token_type: ID_TOKEN_TYPE },
    });
  });
});

describe('tenant isolation', () => {
  it('shows a tenant no token row written for another', async () => {
    const tenant = await seedTenant();
    const other = await seedTenant();
    await redeem(tenant, await loginForCode(tenant));

    expect(await tokenRows(tenant)).toHaveLength(1);
    expect(await tokenRows(other)).toEqual([]);
  });
});

describe('what a token row carries', () => {
  it('never carries an issued token, the code or the client secret', async () => {
    const tenant = await seedTenant();
    const code = await loginForCode(tenant);
    const issued = await redeem(tenant, code);
    const refreshed = await tokenRequest(tenant, {
      grant_type: 'refresh_token',
      refresh_token: present(issued.refresh_token, 'refresh_token'),
    });
    const service = await clientCredentials(tenant);
    const delegated = await exchange(
      tenant,
      present(refreshed.access_token, 'access_token'),
      present(service.access_token, 'access_token'),
    );
    const impersonated = await exchange(
      tenant,
      present(refreshed.access_token, 'access_token'),
      undefined,
    );

    const rows = await tokenRows(tenant);
    expect(rows.map((row) => row.action).sort()).toEqual([
      'token.exchange',
      'token.exchange',
      'token.issue',
      'token.issue',
      'token.refresh',
    ]);
    const secrets = [
      code,
      CLIENT_SECRET,
      ...[issued, refreshed, service, delegated, impersonated].flatMap((body) =>
        [body.access_token, body.refresh_token, body.id_token].filter(
          (value): value is string => value !== undefined,
        ),
      ),
    ];
    const serialized = JSON.stringify(rows);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  });
});
