import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  clientScopeRepository,
  MCP_CLIENT_ID,
} from '@odudu/domain-tenant';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { provisionMcpClient } from '#/usecase/provision-mcp-client';
import { noBreachedLookup } from '#/testing/breached-check';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SECRET_NAME = 'confidential-loopback';

let TENANT: string;
let TENANT_ID: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  TENANT = `mcp-client-${newId()}`;
  TENANT_ID = newId();
  await withTenant(app.db, TENANT_ID, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT });
    await provisionTenant(tx, TENANT_ID);
    await provisionMcpClient(tx, TENANT_ID);
    const subject = await subjectRepository(tx).create({ tenantId: TENANT_ID, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: TENANT_ID, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: TENANT_ID,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword('pw') },
    });
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
    // A confidential client registered with the same loopback literal.
    const confidential = await clientRepository(tx).create({
      tenantId: TENANT_ID,
      clientId: SECRET_NAME,
      name: 'Confidential',
      type: 'confidential',
      secretHash: await hashPassword('s'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: confidential.id,
      tenantId: TENANT_ID,
      redirectUris: ['http://127.0.0.1'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

async function authorize(
  clientId: string,
  redirectUri: string,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: 'xyz',
    scope: 'mcp:read',
    resource: ADMIN_API_AUDIENCE,
    ...extra,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return http.inject({
    url: `/tenants/${TENANT}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

describe('provisionMcpClient, the whole client', () => {
  it('registers the loopback literals, the code and refresh grants, no secret, the admin audience', async () => {
    await withTenant(app.db, TENANT_ID, async (tx) => {
      const client = await clientRepository(tx).byClientId(MCP_CLIENT_ID);
      expect(client).toMatchObject({ type: 'public', secretHash: null, builtinMcp: true });
      const config = await clientOidcConfigRepository(tx).byClientId(client?.id ?? '');
      expect(config).toMatchObject({
        redirectUris: ['http://127.0.0.1', 'http://[::1]'],
        grantTypes: ['authorization_code', 'refresh_token'],
        tokenEndpointAuthMethod: 'none',
        audiences: [ADMIN_API_AUDIENCE],
        consentRequired: true,
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        webOrigins: [],
        clientCredentialsScopes: [],
      });
      const held = await clientScopeRepository(tx).forClientByAssignment(client?.id ?? '');
      const byName = Object.fromEntries(held.map((h) => [h.scope.name, h.assignment]));
      expect(byName['mcp:read']).toBe('default');
      expect(byName['mcp:write']).toBe('optional');
    });
  });

  it('a second pass changes nothing, and adds a missing configuration', async () => {
    const versions = async () =>
      owner.sql<{ t: string; v: string }[]>`
        select 'c' as t, xmin::text as v from clients where tenant_id = ${TENANT_ID} and client_id = ${MCP_CLIENT_ID}
        union all
        select 'o', o.xmin::text from client_oidc_config o join clients c on c.id = o.client_id
         where c.tenant_id = ${TENANT_ID} and c.client_id = ${MCP_CLIENT_ID}
        order by 1`;
    const before = await versions();
    await withTenant(app.db, TENANT_ID, (tx) => provisionMcpClient(tx, TENANT_ID));
    expect(await versions()).toEqual(before);

    await owner.sql`delete from client_oidc_config where client_id in (
      select id from clients where tenant_id = ${TENANT_ID} and client_id = ${MCP_CLIENT_ID})`;
    await withTenant(app.db, TENANT_ID, (tx) => provisionMcpClient(tx, TENANT_ID));
    await withTenant(app.db, TENANT_ID, async (tx) => {
      const client = await clientRepository(tx).byClientId(MCP_CLIENT_ID);
      const config = await clientOidcConfigRepository(tx).byClientId(client?.id ?? '');
      expect(config?.redirectUris).toEqual(['http://127.0.0.1', 'http://[::1]']);
    });
  });
});

describe('/authorize and the loopback redirect (RFC 8252 section 7.3)', () => {
  it.each(['http://127.0.0.1:53211/', 'http://127.0.0.1:1/', 'http://[::1]:40000/'])(
    'serves a public client presenting %s at any port',
    async (redirect) => {
      const res = await authorize(MCP_CLIENT_ID, redirect);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('auth_session_id');
    },
  );

  it('still serves the registered string itself', async () => {
    const res = await authorize(MCP_CLIENT_ID, 'http://127.0.0.1');
    expect(res.body).toContain('auth_session_id');
  });

  it.each([
    'http://127.0.0.1:53211/callback',
    'http://localhost:53211/',
    'http://127.0.0.2:53211/',
    'https://127.0.0.1:53211/',
    'http://127.0.0.1.evil.test:53211/',
    'https://app.example/cb',
  ])('refuses %s, to the page and never by redirect', async (redirect) => {
    const res = await authorize(MCP_CLIENT_ID, redirect);
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('Unregistered redirect URI');
  });

  it('does not extend the rule to a confidential client registered with the same literal', async () => {
    const plain = { scope: 'openid', resource: '' };
    const same = await authorize(SECRET_NAME, 'http://127.0.0.1', plain);
    // The registered string is trusted, so what the client is not allowed
    // comes back to it as an error instead of rendering a page.
    expect(same.statusCode).toBe(302);
    expect(String(same.headers.location)).toMatch(/^http:\/\/127\.0\.0\.1\/\?error=invalid_scope/u);
    const ported = await authorize(SECRET_NAME, 'http://127.0.0.1:53211/', plain);
    expect(ported.statusCode).toBe(400);
    expect(ported.body).toContain('Unregistered redirect URI');
  });
});

describe('a full sign-in through the built-in client on an ephemeral port', () => {
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const PORTED = 'http://127.0.0.1:53211/';

  async function code(): Promise<string> {
    const first = await authorize(MCP_CLIENT_ID, PORTED);
    const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(first.body)?.[1] ?? '';
    const login = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: sessionId,
        username: 'ada',
        password: 'pw',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    // The built-in client asks for consent, as an agent acting for a person
    // should; a person who already granted it is not asked again.
    if (login.statusCode === 302) {
      return new URL(String(login.headers.location)).searchParams.get('code') ?? '';
    }
    expect(login.body).toContain('login-actions/consent');
    const consentSession = /name="auth_session_id" value="([^"]*)"/.exec(login.body)?.[1] ?? '';
    const approved = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/consent`,
      payload: new URLSearchParams({
        auth_session_id: consentSession,
        decision: 'allow',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(approved.statusCode).toBe(302);
    const target = new URL(String(approved.headers.location));
    expect(target.origin + target.pathname).toBe(PORTED);
    return target.searchParams.get('code') ?? '';
  }

  function redeem(authorizationCode: string, redirectUri: string) {
    return http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: MCP_CLIENT_ID,
        code: authorizationCode,
        redirect_uri: redirectUri,
        code_verifier: VERIFIER,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  it('redeems the code at the port it was sent to, for the admin API', async () => {
    const res = await redeem(await code(), PORTED);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ access_token: string; scope: string }>();
    expect(body.scope).toContain('mcp:read');
    const claims = JSON.parse(
      Buffer.from(body.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { aud: string[] };
    expect(claims.aud).toContain(ADMIN_API_AUDIENCE);
  });

  it('refuses the code at any other port: the redirect is bound to the request', async () => {
    const res = await redeem(await code(), 'http://127.0.0.1:53212/');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });
});
