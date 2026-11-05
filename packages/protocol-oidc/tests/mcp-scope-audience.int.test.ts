import { generateSigningKey, signingKeys } from '@odudu/crypto';
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
import {
  ADMIN_API_AUDIENCE,
  clientScopeRepository,
  clients,
  provisionClientDefaults,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import { tokenGrants } from '#/schema/token-grants';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

// mcp:read and mcp:write are asked for at a tenant's MCP endpoint (and the
// admin API it calls) and nowhere else: refused at /authorize, and at /token
// for every grant that mints an access token.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let app: DatabaseHandle;
let http: FastifyInstance;

let TENANT: string;
let TENANT_ID: string;
let MCP_URL: string;
let subjectId: string;

const OTHER = 'https://api.example';
const REDIRECT_URI = 'https://app.example/callback';
const KEK = Buffer.alloc(32, 9);
const PASSWORD = 'correct horse battery staple';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const WEB_ID = 'mcp-scope-web';
const WEB_SECRET = 'mcp-scope-web-secret';
const MACHINE_ID = 'mcp-scope-machine';
const MACHINE_SECRET = 'mcp-scope-machine-secret';
const EXCHANGE_ID = 'mcp-scope-exchange';
const EXCHANGE_SECRET = 'mcp-scope-exchange-secret';
const PLAIN_ID = 'mcp-scope-plain';
const PLAIN_SECRET = 'mcp-scope-plain-secret';

async function addClient(
  tx: TenantScopedDatabase,
  input: {
    clientId: string;
    secret: string;
    grantTypes: string[];
    audiences: string[];
    assign: string[];
    serviceSubjectId?: string;
    impersonation?: boolean;
    accessTtl?: number;
  },
): Promise<void> {
  const id = newId();
  await tx.insert(clients).values({
    id,
    tenantId: TENANT_ID,
    clientId: input.clientId,
    name: input.clientId,
    type: 'confidential',
    secretHash: await hashPassword(input.secret),
    ...(input.serviceSubjectId === undefined ? {} : { serviceSubjectId: input.serviceSubjectId }),
  });
  await provisionClientDefaults(tx, id);
  const scopes = clientScopeRepository(tx);
  for (const name of input.assign) {
    const scope = await scopes.byName(name);
    if (scope === null) throw new Error(`${name} is not defined`);
    await scopes.assign(id, scope.id, 'default');
  }
  await clientOidcConfigRepository(tx).create({
    clientId: id,
    tenantId: TENANT_ID,
    redirectUris: input.grantTypes.includes('authorization_code') ? [REDIRECT_URI] : [],
    grantTypes: input.grantTypes,
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences: input.audiences,
    ...(input.impersonation === true ? { tokenExchangeImpersonationAllowed: true } : {}),
    accessTokenTtlSeconds: input.accessTtl ?? 300,
    refreshTokenTtlSeconds: 1_209_600,
    ...(input.grantTypes.includes('client_credentials')
      ? { clientCredentialsScopes: ['mcp:read', 'mcp:write'] }
      : {}),
  });
}

function nameTenant(): void {
  TENANT = `mcp-scope-${newId()}`;
  TENANT_ID = newId();
  // What the tenant's issuer is for a request that reaches it as `localhost`.
  MCP_URL = `http://localhost/tenants/${TENANT}/mcp`;
}

async function populate(): Promise<void> {
  await withTenant(app.db, TENANT_ID, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT });
    await provisionTenant(tx, TENANT_ID);

    await addClient(tx, {
      clientId: WEB_ID,
      secret: WEB_SECRET,
      grantTypes: ['authorization_code', 'refresh_token'],
      audiences: [MCP_URL, OTHER],
      assign: ['mcp:read', 'mcp:write'],
      accessTtl: 3600,
    });
    await addClient(tx, {
      clientId: EXCHANGE_ID,
      secret: EXCHANGE_SECRET,
      grantTypes: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE_GRANT],
      audiences: [MCP_URL, OTHER],
      assign: ['mcp:read', 'mcp:write'],
      impersonation: true,
      accessTtl: 3600,
    });
    await addClient(tx, {
      clientId: PLAIN_ID,
      secret: PLAIN_SECRET,
      grantTypes: ['authorization_code'],
      audiences: [OTHER],
      assign: [],
    });
    const service = await subjectRepository(tx).create({ tenantId: TENANT_ID, type: 'service' });
    await addClient(tx, {
      clientId: MACHINE_ID,
      secret: MACHINE_SECRET,
      grantTypes: ['client_credentials'],
      audiences: [MCP_URL, OTHER, ADMIN_API_AUDIENCE],
      assign: ['mcp:read', 'mcp:write'],
      serviceSubjectId: service.id,
      accessTtl: 3600,
    });

    const subject = await subjectRepository(tx).create({ tenantId: TENANT_ID, type: 'user' });
    subjectId = subject.id;
    await tx.insert(users).values({ subjectId: subject.id, tenantId: TENANT_ID, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: TENANT_ID,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
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
  });
}

function authorizeUrl(clientId: string, extra: Record<string, string>): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${TENANT}/protocol/openid-connect/auth?${query.toString()}`;
}

function location(res: LightMyRequestResponse): URL {
  const header = res.headers.location;
  if (typeof header !== 'string') throw new Error('expected a location header');
  return new URL(header);
}

// Signs the seeded subject in and returns what the authorization endpoint
// redirected to, a code or an error.
async function authorizeAndSignIn(clientId: string, extra: Record<string, string>): Promise<URL> {
  const first = await http.inject({ url: authorizeUrl(clientId, extra) });
  if (first.statusCode === 302) return location(first);
  const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(first.body)?.[1];
  if (sessionId === undefined) throw new Error('no login form and no redirect');
  const login = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: sessionId,
      username: 'ada',
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(login.statusCode).toBe(302);
  return location(login);
}

interface TokenResult {
  status: number;
  body: { access_token?: string; error?: string; scope?: string };
}

async function token(form: Record<string, string>, id: string, secret: string) {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: new URLSearchParams(form).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
  });
  return { status: res.statusCode, body: res.json<TokenResult['body']>() } satisfies TokenResult;
}

async function mintCode(clientId: string, scope: string, resource: string[]): Promise<string> {
  const code = generateAuthorizationCode();
  await withTenant(app.db, TENANT_ID, async (tx) => {
    const client = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.clientId, clientId));
    const id = client[0]?.id;
    if (id === undefined) throw new Error('no such client');
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      tenantId: TENANT_ID,
      clientId: id,
      subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource,
      claims: { idToken: {}, userinfo: {} },
    });
  });
  return code;
}

function claimsOf(accessToken: string | undefined): Record<string, unknown> {
  const segment = accessToken?.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: ownerHandle,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;
  nameTenant();
  await populate();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('mcp:read through /authorize and /token', () => {
  it('issues a token for the MCP resource to a client allowed the scope', async () => {
    const redirect = await authorizeAndSignIn(WEB_ID, {
      scope: 'openid mcp:read',
      resource: MCP_URL,
    });
    const code = redirect.searchParams.get('code');
    if (code === null) throw new Error(`no code: ${redirect.searchParams.get('error') ?? ''}`);
    const result = await token(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
      },
      WEB_ID,
      WEB_SECRET,
    );
    expect(result.status).toBe(200);
    expect(result.body.scope).toContain('mcp:read');
    const claims = claimsOf(result.body.access_token);
    expect(claims.aud).toEqual([MCP_URL, claims.iss]);
    expect(String(claims.scope)).toContain('mcp:read');
  });

  it('refuses it for another audience the client is registered for', async () => {
    const redirect = await authorizeAndSignIn(WEB_ID, {
      scope: 'openid mcp:read',
      resource: OTHER,
    });
    expect(redirect.searchParams.get('error')).toBe('invalid_scope');
    expect(redirect.searchParams.get('code')).toBeNull();
  });

  it('refuses mcp:write the same way', async () => {
    const redirect = await authorizeAndSignIn(WEB_ID, {
      scope: 'openid mcp:write',
      resource: OTHER,
    });
    expect(redirect.searchParams.get('error')).toBe('invalid_scope');
  });

  it('refuses it when no resource narrows the registered audiences to the MCP one', async () => {
    const redirect = await authorizeAndSignIn(WEB_ID, { scope: 'openid mcp:read' });
    expect(redirect.searchParams.get('error')).toBe('invalid_scope');
  });

  it('refuses a client that was never given the scope, whatever the audience', async () => {
    const redirect = await authorizeAndSignIn(PLAIN_ID, {
      scope: 'openid mcp:read',
      resource: OTHER,
    });
    expect(redirect.searchParams.get('error')).toBe('invalid_scope');
  });

  it('still serves an ordinary scope at the other audience', async () => {
    const redirect = await authorizeAndSignIn(WEB_ID, { scope: 'openid', resource: OTHER });
    expect(redirect.searchParams.get('code')).not.toBeNull();
  });
});

describe('the /token endpoint, for a request that did not pass /authorize', () => {
  it('refuses a code whose scope and audience disagree', async () => {
    const code = await mintCode(WEB_ID, 'openid mcp:read', [OTHER]);
    const result = await token(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
      },
      WEB_ID,
      WEB_SECRET,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_scope');
  });

  it('issues client_credentials at the MCP URL and the admin audience, not elsewhere', async () => {
    const base = { grant_type: 'client_credentials', scope: 'mcp:read' };
    for (const resource of [MCP_URL, ADMIN_API_AUDIENCE]) {
      const ok = await token({ ...base, resource }, MACHINE_ID, MACHINE_SECRET);
      expect(ok.status, resource).toBe(200);
    }
    const foreign = await token({ ...base, resource: OTHER }, MACHINE_ID, MACHINE_SECRET);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('invalid_scope');
    const unnarrowed = await token(base, MACHINE_ID, MACHINE_SECRET);
    expect(unnarrowed.body.error).toBe('invalid_scope');
  });
});

async function redeem(clientId: string, secret: string, scope: string) {
  const redirect = await authorizeAndSignIn(clientId, { scope, resource: MCP_URL });
  const code = redirect.searchParams.get('code');
  if (code === null) throw new Error(`no code: ${redirect.searchParams.get('error') ?? ''}`);
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string; refresh_token: string }>();
}

describe('the refresh grant', () => {
  it('refuses a refresh whose stored scope and audience disagree', async () => {
    const issued = await redeem(WEB_ID, WEB_SECRET, 'openid mcp:read');
    const grantId = claimsOf(issued.access_token).grant_id;
    if (typeof grantId !== 'string') throw new Error('no grant_id');
    await withTenant(app.db, TENANT_ID, (tx) =>
      tx
        .update(tokenGrants)
        .set({ audience: [OTHER] })
        .where(eq(tokenGrants.id, grantId)),
    );
    const refreshed = await token(
      { grant_type: 'refresh_token', refresh_token: issued.refresh_token },
      WEB_ID,
      WEB_SECRET,
    );
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe('invalid_scope');
  });
});

describe('the token-exchange grant', () => {
  it('refuses an mcp scope at a foreign audience', async () => {
    const subject = await redeem(EXCHANGE_ID, EXCHANGE_SECRET, 'openid mcp:read');
    const exchange = (resource: string) =>
      token(
        {
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: subject.access_token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: 'mcp:read',
          resource,
        },
        EXCHANGE_ID,
        EXCHANGE_SECRET,
      );
    const ok = await exchange(MCP_URL);
    expect(ok.status).toBe(200);
    const foreign = await exchange(OTHER);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('invalid_scope');
  });
});

describe('a write token is short-lived and unrefreshable', () => {
  const codeRequest = (code: string) => ({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });

  async function issue(scope: string) {
    const code = await mintCode(WEB_ID, scope, [MCP_URL]);
    return token(codeRequest(code), WEB_ID, WEB_SECRET);
  }

  type Full = TokenResult['body'] & { refresh_token?: string; expires_in?: number };

  it('caps expires_in and exp at ten minutes and issues no refresh token', async () => {
    const result = await issue('openid mcp:write');
    expect(result.status).toBe(200);
    const body = result.body as Full;
    expect(body.expires_in).toBe(600);
    expect(body.refresh_token).toBeUndefined();
    const claims = claimsOf(body.access_token);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(600);
  });

  it('ignores offline_access beside mcp:write: no refresh token, no error', async () => {
    const result = await issue('openid offline_access mcp:write');
    expect(result.status).toBe(200);
    const body = result.body as Full;
    expect(body.refresh_token).toBeUndefined();
    expect(body.expires_in).toBe(600);
  });

  it('lets mcp:read follow the client lifetime and keeps its refresh token', async () => {
    const result = await issue('openid mcp:read');
    const body = result.body as Full;
    expect(body.expires_in).toBe(3600);
    expect(body.refresh_token).toBeTypeOf('string');
  });

  it('refuses a refresh that would widen an mcp:read grant to mcp:write', async () => {
    const read = (await issue('openid mcp:read')).body as Full;
    const widened = await token(
      {
        grant_type: 'refresh_token',
        refresh_token: read.refresh_token ?? '',
        scope: 'mcp:read mcp:write',
      },
      WEB_ID,
      WEB_SECRET,
    );
    expect(widened.status).toBe(400);
    expect(widened.body.error).toBe('invalid_scope');
  });

  async function setGrantScope(accessToken: string | undefined, scope: string): Promise<void> {
    const grantId = claimsOf(accessToken).grant_id;
    if (typeof grantId !== 'string') throw new Error('no grant_id');
    await withTenant(app.db, TENANT_ID, (tx) =>
      tx.update(tokenGrants).set({ scope }).where(eq(tokenGrants.id, grantId)),
    );
  }

  const refreshWith = (refresh: string, scope?: string) =>
    token(
      { grant_type: 'refresh_token', refresh_token: refresh, ...(scope ? { scope } : {}) },
      WEB_ID,
      WEB_SECRET,
    );

  it('refuses to refresh a stored grant holding mcp:write, without rotating', async () => {
    const read = (await issue('openid mcp:read')).body as Full;
    await setGrantScope(read.access_token, 'openid mcp:write');
    const refused = await refreshWith(read.refresh_token ?? '', 'openid');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');
    await setGrantScope(read.access_token, 'openid mcp:read');
    const still = await refreshWith(read.refresh_token ?? '');
    expect(still.status).toBe(200);
  });

  it('still refreshes a stored mcp:read grant, narrowed', async () => {
    const read = (await issue('openid mcp:read')).body as Full;
    const narrowed = await refreshWith(read.refresh_token ?? '', 'mcp:read');
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.scope).toBe('mcp:read');
  });

  it('caps client_credentials at the same ten minutes', async () => {
    const res = await token(
      { grant_type: 'client_credentials', scope: 'mcp:write', resource: MCP_URL },
      MACHINE_ID,
      MACHINE_SECRET,
    );
    expect(res.status).toBe(200);
    expect((res.body as Full).expires_in).toBe(600);
  });

  it.each([
    ['another resource and the issuer', (iss: string) => [OTHER, iss]],
    ['the issuer alone', (iss: string) => [iss]],
  ])('refuses a stored mcp:read grant whose audience is %s', async (_name, audienceOf) => {
    const read = (await issue('openid mcp:read')).body as Full;
    const claims = claimsOf(read.access_token);
    const grantId = claims.grant_id;
    if (typeof grantId !== 'string' || typeof claims.iss !== 'string') throw new Error('no claims');
    const audience = audienceOf(claims.iss);
    await withTenant(app.db, TENANT_ID, (tx) =>
      tx.update(tokenGrants).set({ audience }).where(eq(tokenGrants.id, grantId)),
    );
    const refused = await refreshWith(read.refresh_token ?? '');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_scope');
  });

  it('refuses to exchange a write token into a refresh token', async () => {
    const code = await mintCode(EXCHANGE_ID, 'openid mcp:write', [MCP_URL]);
    const held = await token(codeRequest(code), EXCHANGE_ID, EXCHANGE_SECRET);
    expect(held.status).toBe(200);
    const exchange = (extra: Record<string, string>) =>
      token(
        {
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: held.body.access_token ?? '',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: 'mcp:write',
          resource: MCP_URL,
          ...extra,
        },
        EXCHANGE_ID,
        EXCHANGE_SECRET,
      );
    const refresh = await exchange({
      requested_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    expect(refresh.status).toBe(400);
    expect(refresh.body.error).toBe('invalid_scope');
  });
});
