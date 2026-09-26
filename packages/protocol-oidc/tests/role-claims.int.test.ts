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
import { clientScopeRepository, clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { roleRepository, type RoleRecord } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

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
  const tenantName = `role-claims-${label}-${newId()}`;
  const tenantId = newId();
  const clientDbId = newId();

  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenantName });
    await provisionTenant(tx, tenantId);

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: `alice-${label}` });

    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
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

// A tenant role held by the tenant's subject, with no scope mapping unless
// mapRoleToScope adds one — the "held but not reachable" fixture every
// negative assertion below depends on.
async function giveSubjectRole(tenant: Tenant, name: string): Promise<RoleRecord> {
  return withTenant(app.db, tenant.tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId: tenant.tenantId, name });
    await roleRepository(tx).assignToSubject(tenant.subjectId, role.id);
    return role;
  });
}

async function mapRoleToScope(tenant: Tenant, role: RoleRecord, scopeName: string): Promise<void> {
  await withTenant(app.db, tenant.tenantId, async (tx) => {
    const scope = await clientScopeRepository(tx).byName(scopeName);
    if (scope === null) throw new Error(`no client scope named ${scopeName}`);
    await roleRepository(tx).mapToClientScope(scope.id, role.id);
  });
}

async function setFullScopeAllowed(tenant: Tenant): Promise<void> {
  await withTenant(app.db, tenant.tenantId, (tx) =>
    tx.execute(sql`update clients set full_scope_allowed = true where id = ${tenant.clientDbId}`),
  );
}

async function disableClient(tenant: Tenant): Promise<void> {
  await withTenant(app.db, tenant.tenantId, (tx) =>
    tx.execute(sql`update clients set enabled = false where id = ${tenant.clientDbId}`),
  );
}

async function setIncludeInAccessToken(
  tenant: Tenant,
  scopeName: string,
  value: boolean,
): Promise<void> {
  await withTenant(app.db, tenant.tenantId, (tx) =>
    tx.execute(
      sql`update client_scopes set include_in_access_token = ${value} where tenant_id = ${tenant.tenantId} and name = ${scopeName}`,
    ),
  );
}

interface TokenSet {
  accessToken: string;
  idToken: string | undefined;
}

async function completeCodeFlow(tenant: Tenant, scope: string): Promise<TokenSet> {
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
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('web-app:supersecret').toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

async function userinfo(tenant: Tenant, accessToken: string): Promise<Record<string, unknown>> {
  const res = await http.inject({
    method: 'GET',
    url: `/tenants/${tenant.tenantName}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

// Decodes without verifying: used only to read what issuance minted, never
// to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
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
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
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

describe('roles in an issued token', () => {
  it('withholds a held role that the client scopes do not reach', async () => {
    const tenant = await seedTenant('unmapped');
    await giveSubjectRole(tenant, 'admin'); // held, but mapped to no scope

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect(decode(accessToken)).not.toHaveProperty('roles');
  });

  it('withholds the roles claim entirely when nothing is mapped', async () => {
    const tenant = await seedTenant('nothing-mapped');
    // Two held roles, neither mapped to anything — not just the one role
    // the previous test leaves unmapped, so an implementation that only
    // drops a single excess role rather than intersecting the whole set
    // still fails this one.
    await giveSubjectRole(tenant, 'admin');
    await giveSubjectRole(tenant, 'member');

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect(decode(accessToken)).not.toHaveProperty('roles');
  });

  it('emits a role once its scope is mapped', async () => {
    const tenant = await seedTenant('mapped');
    const admin = await giveSubjectRole(tenant, 'admin');
    await mapRoleToScope(tenant, admin, 'roles');

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect(decode(accessToken).roles).toEqual(['admin']);
  });

  it('passes every held role through when the client has full scope', async () => {
    const tenant = await seedTenant('full-scope');
    await setFullScopeAllowed(tenant);
    await giveSubjectRole(tenant, 'admin'); // held, mapped to no scope, but full_scope_allowed

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect(decode(accessToken).roles).toEqual(['admin']);
  });

  it('keeps roles out of the ID token, which the browser sees', async () => {
    const tenant = await seedTenant('id-token');
    const admin = await giveSubjectRole(tenant, 'admin');
    await mapRoleToScope(tenant, admin, 'roles');

    const { idToken } = await completeCodeFlow(tenant, 'openid roles');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(decode(idToken)).not.toHaveProperty('roles');
  });

  it('returns them from userinfo on the same gate', async () => {
    const tenant = await seedTenant('userinfo');
    const admin = await giveSubjectRole(tenant, 'admin');
    await mapRoleToScope(tenant, admin, 'roles');

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect((await userinfo(tenant, accessToken)).roles).toEqual(['admin']);
  });

  it('withholds an unmapped role from userinfo too', async () => {
    const tenant = await seedTenant('userinfo-unmapped');
    await giveSubjectRole(tenant, 'admin'); // held, mapped to no scope

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    expect(await userinfo(tenant, accessToken)).not.toHaveProperty('roles');
  });

  // Before the client-enabled check landed (packages/protocol-oidc/src/
  // service/client-enabled.ts), a disabled full-scope client's token still
  // reached userinfo and only lost the `fullScopeAllowed` bypass; now the
  // token is refused outright, the same as any other disabled client's.
  it('refuses a disabled full-scope client’s live token at userinfo outright', async () => {
    const tenant = await seedTenant('userinfo-disabled-full-scope');
    await setFullScopeAllowed(tenant);
    await giveSubjectRole(tenant, 'admin'); // held, mapped to no scope, but full_scope_allowed

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    await disableClient(tenant);

    const res = await http.inject({
      method: 'GET',
      url: `/tenants/${tenant.tenantName}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets a mapper claim overwrite no registered claim', async () => {
    const tenant = await seedTenant('claim-order');
    const admin = await giveSubjectRole(tenant, 'admin');
    await mapRoleToScope(tenant, admin, 'roles');

    const { accessToken } = await completeCodeFlow(tenant, 'openid roles');
    const payload = decode(accessToken);
    expect(payload.sub).toBe(tenant.subjectId);
    expect(payload.iss).toContain(tenant.tenantName);
  });

  it('reaches the ID token when the scope says so, not just when it is withheld', async () => {
    const tenant = await seedTenant('id-token-positive');

    // `profile`'s `include_in_id_token` default is true (unlike `roles`),
    // so its claim must actually land — the `roles`/`groups` tests above
    // only prove the gate can withhold, never that it lets a claim through.
    const { idToken } = await completeCodeFlow(tenant, 'openid profile');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(decode(idToken).name).toBe(`alice-id-token-positive`);
  });

  it('withholds profile and email from the access token by default', async () => {
    const tenant = await seedTenant('access-token-pii-default');

    const { accessToken } = await completeCodeFlow(tenant, 'openid profile email');
    const payload = decode(accessToken);
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('email_verified');
  });

  it('carries sub on the access token regardless of the openid scope’s access-token flag', async () => {
    const tenant = await seedTenant('access-token-sub-always');

    const { accessToken } = await completeCodeFlow(tenant, 'openid');
    expect(decode(accessToken).sub).toBe(tenant.subjectId);
  });

  it('lets profile reach the access token once a tenant opts it in', async () => {
    const tenant = await seedTenant('access-token-pii-opt-in');
    await setIncludeInAccessToken(tenant, 'profile', true);

    const { accessToken } = await completeCodeFlow(tenant, 'openid profile');
    expect(decode(accessToken).name).toBe('alice-access-token-pii-opt-in');
  });
});
