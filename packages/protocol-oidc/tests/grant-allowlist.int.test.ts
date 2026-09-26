import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
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
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';
import {
  buildClientSigningKey,
  jwksDocumentFor,
  signClientAssertion,
} from '#/testing/private-key-jwt-fixture';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

let TENANT: string;
let TENANT_ID: string;

const KEK = Buffer.alloc(32, 17);

const CODE_ONLY_CLIENT = 'grant-allowlist-code-only';
const CODE_ONLY_SECRET = 'grant-allowlist-code-only-secret';
const BOTH_CLIENT = 'grant-allowlist-both';
const BOTH_SECRET = 'grant-allowlist-both-secret';
const PKJWT_CODE_ONLY_CLIENT = 'grant-allowlist-pkjwt-code-only';

// The Host `http.inject` sends when a request names none — `view/issuer.ts`
// derives an assertion's expected audience from exactly this.
const TENANT_ISSUER_BASE = 'http://localhost';

let PKJWT_AUDIENCE: string;
let PKJWT_CLIENT_KEY: Awaited<ReturnType<typeof buildClientSigningKey>>;

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

async function setupTenant(): Promise<void> {
  TENANT = `grant-allowlist-${newId()}`;
  TENANT_ID = newId();

  await withTenant(app.db, TENANT_ID, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT });
    await provisionTenant(tx, TENANT_ID);

    const codeOnlyServiceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    const codeOnlyClientDbId = newId();
    await tx.insert(clients).values({
      id: codeOnlyClientDbId,
      tenantId: TENANT_ID,
      clientId: CODE_ONLY_CLIENT,
      name: 'Client registered for authorization_code only',
      type: 'confidential',
      secretHash: await hashPassword(CODE_ONLY_SECRET),
      serviceSubjectId: codeOnlyServiceSubject.id,
    });
    await provisionClientDefaults(tx, codeOnlyClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: codeOnlyClientDbId,
      tenantId: TENANT_ID,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const bothServiceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    const bothClientDbId = newId();
    await tx.insert(clients).values({
      id: bothClientDbId,
      tenantId: TENANT_ID,
      clientId: BOTH_CLIENT,
      name: 'Client registered for authorization_code and client_credentials',
      type: 'confidential',
      secretHash: await hashPassword(BOTH_SECRET),
      serviceSubjectId: bothServiceSubject.id,
    });
    await provisionClientDefaults(tx, bothClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: bothClientDbId,
      tenantId: TENANT_ID,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [],
    });

    PKJWT_AUDIENCE = `${TENANT_ISSUER_BASE}/tenants/${TENANT}/protocol/openid-connect/token`;
    PKJWT_CLIENT_KEY = await buildClientSigningKey(KEK, TENANT_ID);
    const pkjwtServiceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    const pkjwtClientDbId = newId();
    await tx.insert(clients).values({
      id: pkjwtClientDbId,
      tenantId: TENANT_ID,
      clientId: PKJWT_CODE_ONLY_CLIENT,
      name: 'private_key_jwt client registered for authorization_code only',
      type: 'confidential',
      secretHash: await hashPassword('unused'),
      serviceSubjectId: pkjwtServiceSubject.id,
    });
    await provisionClientDefaults(tx, pkjwtClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: pkjwtClientDbId,
      tenantId: TENANT_ID,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: jwksDocumentFor(PKJWT_CLIENT_KEY),
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const subject = await subjectRepository(tx).create({ tenantId: TENANT_ID, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: TENANT_ID, username: 'ada' });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: TENANT_ID,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
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
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;

  await setupTenant();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// RFC 6749 §5.2: a client authenticated but not authorized for this grant.
// Before this, `config.grantTypes` gated only whether a refresh token was
// issued, so a client registered for authorization_code alone could still
// obtain a client_credentials token.
describe('[ODUDU-GRANT-ALLOWLIST-01] /token enforces the registered grant list', () => {
  it('refuses client_credentials from a client registered for authorization_code only', async () => {
    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: {
        authorization: basicAuth(CODE_ONLY_CLIENT, CODE_ONLY_SECRET),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('still issues client_credentials to a client registered for it', async () => {
    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: {
        authorization: basicAuth(BOTH_CLIENT, BOTH_SECRET),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('access_token');
  });

  // The check sits after authentication and before dispatch, so it must
  // hold on every client-authentication path, not only client_secret_basic.
  it('refuses an unregistered grant on the private_key_jwt path', async () => {
    const assertion = await signClientAssertion({
      clientId: PKJWT_CODE_ONLY_CLIENT,
      audience: PKJWT_AUDIENCE,
      key: PKJWT_CLIENT_KEY,
      kek: KEK,
    });

    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'unauthorized_client' });
  });
});
