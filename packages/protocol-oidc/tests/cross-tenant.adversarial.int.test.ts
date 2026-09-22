import { generateSigningKey, signingKeyRepository, signingKeys, verifyJwt } from '@odudu/crypto';
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

const KEK = Buffer.alloc(32, 9);
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'alice';
const PASSWORD = 'correct horse battery staple';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Client {
  clientId: string;
  dbId: string;
  secret: string;
  // What /authorize would store on a code's `resource` when a request
  // names none — the same default `issueTokens` below mints codes with,
  // now that /token derives `aud` from the code rather than from
  // `config.audiences` directly.
  audiences: string[];
}

interface TenantSetup {
  tenantName: string;
  tenantId: string;
  issuer: string;
  subjectId: string;
}

let tenantA: TenantSetup;
let tenantB: TenantSetup;
let sharedApp: { a: Client; b: Client };
let audienceA: Client;
let audienceB: Client;

async function insertClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  secret: string,
  audiences: string[] = [],
): Promise<Client> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    tenantId,
    clientId,
    name: clientId,
    type: 'confidential',
    secretHash: await hashPassword(secret),
  });
  await provisionClientDefaults(tx, dbId);
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    tenantId,
    redirectUris: [REDIRECT_URI],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences,
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
  return { clientId, dbId, secret, audiences };
}

async function setupTenant(label: string): Promise<TenantSetup> {
  const tenantName = `cross-tenant-${label}-${newId()}`;
  const tenantId = newId();

  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenantName });
    await provisionTenant(tx, tenantId);

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
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

  // light-my-request sends `Host: localhost:80`; the scheme's default port
  // is insignificant and never appears in an issuer
  // (packages/protocol-oidc/src/view/issuer.ts).
  return { tenantName, tenantId, issuer: `http://localhost/tenants/${tenantName}`, subjectId };
}

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

function authorizeUrl(tenantName: string, client: Client): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

// Issues an authorization code directly against the repository (as the
// other adversarial suites do, bypassing /authorize's login UI) and
// redeems it through the real /token endpoint.
async function issueTokens(
  tenant: TenantSetup,
  client: Client,
  scope: string,
): Promise<{ accessToken: string; idToken: string | undefined; refreshToken: string | undefined }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withTenant(app.db, tenant.tenantId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      tenantId: tenant.tenantId,
      clientId: client.dbId,
      subjectId: tenant.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: client.audiences,
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
      authorization: basicAuth(client),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string; refresh_token?: string }>();
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
  };
}

async function tenantSigningKeys(tenantId: string) {
  return withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).listPublishable());
}

// Stands in for a protected API validating a bearer token it received:
// the only thing it should trust is `verifyJwt`'s own audience check.
async function verifyAsResourceServer(
  tenant: TenantSetup,
  token: string,
  audience: string,
): Promise<boolean> {
  const keys = await tenantSigningKeys(tenant.tenantId);
  try {
    await verifyJwt(token, { keys, issuer: tenant.issuer, audience, typ: 'at+jwt' });
    return true;
  } catch {
    return false;
  }
}

function redeemForm(
  code: string,
  client: Client,
): { payload: string; headers: Record<string, string> } {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);
  return {
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
  };
}

async function redeemAt(
  tenantName: string,
  code: string,
  client: Client,
): Promise<LightMyRequestResponse> {
  const { payload, headers } = redeemForm(code, client);
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload,
    headers,
  });
}

async function refreshAt(
  tenantName: string,
  refreshToken: string,
  client: Client,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', refreshToken);
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
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
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;

  tenantA = await setupTenant('a');
  tenantB = await setupTenant('b');

  // Same client_id and secret registered in both tenants, so that a
  // cross-tenant redemption attempt authenticates as the client (stage 2)
  // and fails only because the code or refresh token itself is invisible
  // under tenant B's RLS context (stage 3) — proving tenant isolation, not
  // merely a client lookup failure.
  const clientA = await withTenant(app.db, tenantA.tenantId, (tx) =>
    insertClient(tx, tenantA.tenantId, 'shared-app', 'sharedsecret'),
  );
  const clientB = await withTenant(app.db, tenantB.tenantId, (tx) =>
    insertClient(tx, tenantB.tenantId, 'shared-app', 'sharedsecret'),
  );
  sharedApp = { a: clientA, b: clientB };

  audienceA = await withTenant(app.db, tenantA.tenantId, (tx) =>
    insertClient(tx, tenantA.tenantId, 'app-a', 'app-a-secret', ['https://api-a.example']),
  );
  audienceB = await withTenant(app.db, tenantA.tenantId, (tx) =>
    insertClient(tx, tenantA.tenantId, 'app-b', 'app-b-secret', ['https://api-b.example']),
  );
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('audience confusion between clients', () => {
  it('[RFC9068-5-01] refuses an access token minted for another client’s audience', async () => {
    const { accessToken: tokenForA } = await issueTokens(tenantA, audienceA, 'openid');
    expect(await verifyAsResourceServer(tenantA, tokenForA, 'https://api-a.example')).toBe(true);
    expect(await verifyAsResourceServer(tenantA, tokenForA, 'https://api-b.example')).toBe(false);

    const { accessToken: tokenForB } = await issueTokens(tenantA, audienceB, 'openid');
    expect(await verifyAsResourceServer(tenantA, tokenForB, 'https://api-b.example')).toBe(true);
    expect(await verifyAsResourceServer(tenantA, tokenForB, 'https://api-a.example')).toBe(false);
  });

  it('refuses a token whose audience is the client rather than an API', async () => {
    const { idToken } = await issueTokens(tenantA, audienceA, 'openid');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(await verifyAsResourceServer(tenantA, idToken, 'https://api-a.example')).toBe(false);
  });
});

describe('[ODUDU-CROSS-TENANT-LEAKAGE-01] cross-tenant leakage', () => {
  it('cannot redeem tenant A code at tenant B token endpoint', async () => {
    const code = generateAuthorizationCode();
    const codeHash = hashAuthorizationCode(code);
    await withTenant(app.db, tenantA.tenantId, async (tx) => {
      await authorizationCodeRepository(tx).create({
        codeHash,
        tenantId: tenantA.tenantId,
        clientId: sharedApp.a.dbId,
        subjectId: tenantA.subjectId,
        redirectUri: REDIRECT_URI,
        scope: 'openid',
        nonce: null,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        authTime: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        resource: [],
        claims: { idToken: {}, userinfo: {} },
      });
    });

    const atB = await redeemAt(tenantB.tenantName, code, sharedApp.b);
    expect(atB.statusCode).toBe(400);
    expect(atB.json<{ error: string }>().error).toBe('invalid_grant');

    const atA = await redeemAt(tenantA.tenantName, code, sharedApp.a);
    expect(atA.statusCode).toBe(200);
  });

  it('cannot use a tenant A session to authorize in tenant B', async () => {
    // /authorize always renders a fresh challenge regardless of any cookie
    // presented, but that is true today only because no code path reads a
    // session cookie at all — there is no single-sign-on flow yet. Unlike
    // its siblings above, this assertion does not prove cross-tenant
    // isolation of anything; it is a regression guard that will start
    // meaning something once a cookie-read path exists at /authorize.
    const res = await http.inject({
      url: authorizeUrl(tenantB.tenantName, sharedApp.b),
      cookies: { [`${tenantA.tenantName}-session`]: newId() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('password');
  });

  it('cannot refresh a tenant A token at tenant B', async () => {
    const { refreshToken } = await issueTokens(tenantA, sharedApp.a, 'openid');
    if (refreshToken === undefined) throw new Error('expected a refresh_token');

    const atB = await refreshAt(tenantB.tenantName, refreshToken, sharedApp.b);
    expect(atB.statusCode).toBe(400);
    expect(atB.json<{ error: string }>().error).toBe('invalid_grant');

    const atA = await refreshAt(tenantA.tenantName, refreshToken, sharedApp.a);
    expect(atA.statusCode).toBe(200);
  });
});
