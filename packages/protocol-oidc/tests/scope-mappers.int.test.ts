import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { subjectRepository, userRepository, users } from '@odudu/domain-identity';
import { provisionTenant } from '@odudu/authn-flows';
import {
  clientScopeMapperRepository,
  clientScopeRepository,
  clients,
  provisionClientDefaults,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Tenant {
  tenantName: string;
  tenantId: string;
  clientDbId: string;
  subjectId: string;
}

async function seedTenant(label: string): Promise<Tenant> {
  const tenantName = `scope-mappers-${label}-${newId()}`;
  const tenantId = newId();
  const clientDbId = newId();

  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenantName });
    await provisionTenant(tx, tenantId);

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: `ada-${label}` });
    await userRepository(tx).updateProfile(subject.id, { name: 'Ada Lovelace' });
    await userRepository(tx).updateEmail(subject.id, `ada-${label}@example.test`);

    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'public',
      secretHash: null,
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
    });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    return subject.id;
  });

  return { tenantName, tenantId, clientDbId, subjectId };
}

// Replaces the whole binding set for `scopeName` in one tenant — what
// `PUT /admin/tenants/:tenant/scopes/:id/mappers` does over HTTP
// (packages/protocol-admin/tests/scope-mappers.int.test.ts), called
// directly against the repository here since this suite is about
// `assemble`'s and discovery's own read of the binding, not the route.
async function bindMappers(
  tenant: Tenant,
  scopeName: string,
  mapperNames: string[],
): Promise<void> {
  await withTenant(app.db, tenant.tenantId, async (tx) => {
    const scope = await clientScopeRepository(tx).byName(scopeName);
    if (scope === null) throw new Error(`no scope named ${scopeName} in ${tenant.tenantName}`);
    await clientScopeMapperRepository(tx).replaceForScope(tenant.tenantId, scope.id, mapperNames);
  });
}

async function issueIdTokenClaims(tenant: Tenant, scope: string): Promise<Record<string, unknown>> {
  const code = generateAuthorizationCode();

  await withTenant(app.db, tenant.tenantId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      tenantId: tenant.tenantId,
      clientId: tenant.clientDbId,
      subjectId: tenant.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: [],
      claims: { idToken: {}, userinfo: {} },
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('client_id', 'web-app');
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ id_token?: string }>();
  const idToken = body.id_token;
  if (idToken === undefined) throw new Error('expected an id_token');

  const segment = idToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
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
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('per-tenant claim mapper bindings', () => {
  it('leaves an unbound scope on its declared mappers after another is bound', async () => {
    const tenant = await seedTenant('other-unbound');
    await bindMappers(tenant, 'profile', ['sub']);

    const claims = await issueIdTokenClaims(tenant, 'openid email');

    expect(claims).toHaveProperty('email');
  });

  it('changes nothing for a tenant with no bindings', async () => {
    const tenant = await seedTenant('no-bindings');

    const claims = await issueIdTokenClaims(tenant, 'openid profile email');

    expect(claims).toMatchObject({ name: 'Ada Lovelace' });
    expect(claims).toHaveProperty('email');
  });

  it('honours a binding that removes a mapper from a scope', async () => {
    const tenant = await seedTenant('narrowed');
    await bindMappers(tenant, 'profile', ['sub']);

    const claims = await issueIdTokenClaims(tenant, 'openid profile');

    expect(claims).not.toHaveProperty('name');
  });

  it('derives claims_supported from the tenant own bindings', async () => {
    const tenant = await seedTenant('discovery-narrowed');
    await bindMappers(tenant, 'profile', ['sub']);

    const res = await http.inject({
      url: `/tenants/${tenant.tenantName}/.well-known/openid-configuration`,
    });

    const claimsSupported = res.json<{ claims_supported: string[] }>().claims_supported;
    expect(claimsSupported).not.toContain('name');
  });

  it('keeps one tenant own bindings out of another tenant own document', async () => {
    const narrowed = await seedTenant('cross-narrowed');
    const untouched = await seedTenant('cross-untouched');
    await bindMappers(narrowed, 'profile', ['sub']);

    const res = await http.inject({
      url: `/tenants/${untouched.tenantName}/.well-known/openid-configuration`,
    });

    const claimsSupported = res.json<{ claims_supported: string[] }>().claims_supported;
    expect(claimsSupported).toContain('name');
  });
});
