import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { oidcRoutes, type CimdResponse } from '#/index';
import {
  buildClientSigningKey,
  jwksDocumentFor,
  signClientAssertion,
} from '#/testing/private-key-jwt-fixture';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { type ClientKeySet } from '#/repository/client-keys';
import { createFetchLimiter } from '#/service/cimd-fetch-limiter';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { noBreachedLookup } from '#/testing/breached-check';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 9);
const PASSWORD = 'correct horse battery staple';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CLIENT_URL = 'https://app.example.com:8443/oauth/client.json';
const CALLBACK = 'https://app.example.com:8443/callback';
const PUBLIC_ADDRESS = '93.184.216.34';

let tenant: string;
let tenantId: string;
let other: string;
let otherId: string;
const documents = new Map<string, CimdResponse>();
const keySetFetch = vi.fn<ClientKeySet['fetch']>().mockRejectedValue(new Error('no keys'));
const request = vi.fn((url: URL) => {
  const found = documents.get(url.href);
  return found === undefined
    ? Promise.reject(new Error('connection refused'))
    : Promise.resolve(found);
});

function serve(overrides: Record<string, unknown> = {}, url = CLIENT_URL): void {
  documents.set(url, {
    status: 200,
    contentType: 'application/json',
    cacheControl: 'no-store',
    body: JSON.stringify({
      client_id: url,
      client_name: 'Example Notes',
      redirect_uris: [CALLBACK, 'http://localhost/callback'],
      ...overrides,
    }),
  });
}

async function setupTenant(): Promise<{ name: string; id: string }> {
  const name = `cimd-${newId()}`;
  const id = newId();
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name });
    await provisionTenant(tx, id);
    const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: id,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: id,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
  return { name, id };
}

function setCimd(id: string, enabled: boolean): Promise<unknown> {
  return owner.db.execute(sql`update tenants set cimd_enabled = ${enabled} where id = ${id}`);
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
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
      clientKeySet: { fetch: keySetFetch },
      cimd: {
        lookup: () => Promise.resolve([PUBLIC_ADDRESS]),
        request,
        limiter: createFetchLimiter({
          now: () => new Date(),
          perHost: 1000,
          perTenant: 1000,
          windowMs: 60_000,
          maxHosts: 100,
          maxTenants: 100,
        }),
        warn: () => undefined,
      },
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

beforeEach(async () => {
  documents.clear();
  request.mockClear();
  ({ name: tenant, id: tenantId } = await setupTenant());
  ({ name: other, id: otherId } = await setupTenant());
});

function authorize(
  clientId: string,
  extra: Record<string, string> = {},
  name = tenant,
): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    state: 'xyz',
    scope: 'openid',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return http.inject({ url: `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}` });
}

function sessionOf(res: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

async function signIn(res: LightMyRequestResponse, name = tenant): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${name}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: sessionOf(res),
      username: 'ada',
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function allow(consent: LightMyRequestResponse, name = tenant): Promise<URL> {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${name}/login-actions/consent`,
    payload: new URLSearchParams({
      auth_session_id: sessionOf(consent),
      decision: 'allow',
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode, res.body).toBe(302);
  return new URL(String(res.headers.location));
}

function token(form: Record<string, string>, name = tenant): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${name}/protocol/openid-connect/token`,
    payload: new URLSearchParams(form).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('a URL client_id with metadata documents off', () => {
  it('is refused exactly as an unknown client is, and nothing is fetched', async () => {
    serve();
    const asUrl = await authorize(CLIENT_URL);
    const asUnknown = await authorize('no-such-client');

    expect(asUrl.statusCode).toBe(asUnknown.statusCode);
    expect(asUrl.statusCode).toBe(400);
    expect(asUrl.body).toBe(asUnknown.body);
    expect(asUrl.headers['content-type']).toBe(asUnknown.headers['content-type']);
    expect(asUrl.headers['content-security-policy']).toBe(
      asUnknown.headers['content-security-policy'],
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('is refused at /token the same way, for a client that was usable while it was on', async () => {
    await setCimd(tenantId, true);
    serve();
    const consent = await signIn(await authorize(CLIENT_URL));
    const code = (await allow(consent)).searchParams.get('code') ?? '';
    await setCimd(tenantId, false);

    const form = {
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    };
    const asCimd = await token(form);
    const asUnknown = await token({ ...form, client_id: 'no-such-client' });

    expect(asCimd.statusCode).toBe(401);
    expect(asCimd.body).toBe(asUnknown.body);
  });

  it('refuses at /authorize a client stored while it was on', async () => {
    await setCimd(tenantId, true);
    serve();
    expect((await authorize(CLIENT_URL)).statusCode).toBe(200);
    await setCimd(tenantId, false);
    const refused = await authorize(CLIENT_URL);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toBe((await authorize('no-such-client')).body);
  });
});

describe('a URL client_id with metadata documents on', () => {
  beforeEach(async () => {
    await setCimd(tenantId, true);
    serve();
  });

  it('[CIMD-6.4-01] reaches consent showing the name the document gives', async () => {
    const login = await signIn(await authorize(CLIENT_URL));

    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('login-actions/consent');
    expect(login.body).toContain('Example Notes');
    expect(login.body).toContain(CALLBACK);
    expect(login.body).toContain('http://localhost/callback');
  });

  it('[CIMD-6.4-03] shows the host of the client_id with its port on the consent page', async () => {
    const login = await signIn(await authorize(CLIENT_URL));
    expect(login.body).toContain('app.example.com:8443');
  });

  it('issues a code, and redeems it as a public client with PKCE alone', async () => {
    const consent = await signIn(await authorize(CLIENT_URL));
    const redirect = await allow(consent);
    expect(redirect.origin + redirect.pathname).toBe(CALLBACK);
    const code = redirect.searchParams.get('code') ?? '';

    const redeemed = await token({
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });

    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const body = redeemed.json<{ access_token: string; id_token: string }>();
    const claims = JSON.parse(
      Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { aud: string };
    expect(claims.aud).toBe(CLIENT_URL);
  });

  it('[CIMD-4.5-03] refuses a redirect address the document does not list, rendering rather than redirecting', async () => {
    const res = await authorize(CLIENT_URL, { redirect_uri: 'https://evil.example/cb' });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('Unregistered redirect URI');
  });

  it('matches a localhost entry at any port', async () => {
    const res = await authorize(CLIENT_URL, { redirect_uri: 'http://localhost:51234/callback' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('auth_session_id');
  });

  it('gives the client no audience: a resource the document cannot grant is refused', async () => {
    const res = await authorize(CLIENT_URL, { resource: `http://localhost/tenants/${tenant}/mcp` });
    expect(res.statusCode).toBe(302);
    expect(new URL(String(res.headers.location)).searchParams.get('error')).toBe('invalid_target');
  });

  it('gives the client no mcp scope: asking for one is refused', async () => {
    const res = await authorize(CLIENT_URL, { scope: 'openid mcp:read' });
    expect(res.statusCode).toBe(302);
    expect(new URL(String(res.headers.location)).searchParams.get('error')).toBe('invalid_scope');
  });

  it('follows the document: a changed redirect address replaces the old one', async () => {
    serve({ redirect_uris: ['https://app.example.com:8443/moved'] });
    const res = await authorize(CLIENT_URL);
    expect(res.statusCode).toBe(400);
    const moved = await authorize(CLIENT_URL, {
      redirect_uri: 'https://app.example.com:8443/moved',
    });
    expect(moved.statusCode).toBe(200);
  });

  it('[CIMD-4.3-01] refuses the client when its document stops being served, even though a row exists', async () => {
    expect((await authorize(CLIENT_URL)).statusCode).toBe(200);
    documents.delete(CLIENT_URL);
    const res = await authorize(CLIENT_URL);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe((await authorize('no-such-client')).body);
  });

  it('refuses a document whose client_id is not its own URL', async () => {
    serve({ client_id: 'https://elsewhere.example/c.json' });
    expect((await authorize(CLIENT_URL)).statusCode).toBe(400);
  });

  it('does not make the client known to another tenant that has the setting off', async () => {
    expect((await authorize(CLIENT_URL)).statusCode).toBe(200);
    const res = await authorize(CLIENT_URL, {}, other);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe((await authorize('no-such-client', {}, other)).body);
    expect(otherId).not.toBe(tenantId);
  });

  it('stores the client per tenant when another tenant turns the setting on too', async () => {
    await setCimd(otherId, true);
    expect((await authorize(CLIENT_URL)).statusCode).toBe(200);
    expect((await authorize(CLIENT_URL, {}, other)).statusCode).toBe(200);
    const rows = await owner.db.execute<{ count: number }>(
      sql`select count(*)::int as count from clients
        where client_id = ${CLIENT_URL} and tenant_id in (${tenantId}, ${otherId})`,
    );
    expect(rows[0]?.count).toBe(2);
  });

  it('keeps a client registered by hand under the same URL, whatever the document says', async () => {
    await withTenant(app.db, tenantId, async (tx) => {
      const created = await clientRepository(tx).create({
        tenantId,
        clientId: 'https://hand.example.com/c',
        name: 'By hand',
        type: 'public',
        secretHash: null,
      });
      await provisionClientDefaults(tx, created.id);
      await clientOidcConfigRepository(tx).create({
        clientId: created.id,
        tenantId,
        redirectUris: [CALLBACK],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'none',
        audiences: [],
        accessTokenTtlSeconds: null,
        refreshTokenTtlSeconds: null,
      });
    });
    serve({ client_name: 'Impostor' }, 'https://hand.example.com/c');
    const res = await authorize('https://hand.example.com/c');
    expect(res.statusCode).toBe(200);
    expect(request).not.toHaveBeenCalled();
  });

  it('[CIMD-6.2-01] authenticates a client that published a key, by its signed assertion alone', async () => {
    const key = await buildClientSigningKey(KEK);
    serve({ token_endpoint_auth_method: 'private_key_jwt', jwks: jwksDocumentFor(key) });
    const consent = await signIn(await authorize(CLIENT_URL));
    const code = (await allow(consent)).searchParams.get('code') ?? '';
    const form = {
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    };

    const bare = await token(form);
    expect(bare.statusCode).toBe(401);

    const assertion = await signClientAssertion({
      key,
      clientId: CLIENT_URL,
      audience: `http://localhost/tenants/${tenant}/protocol/openid-connect/token`,
      kek: KEK,
    });
    const signed = await token({
      ...form,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });
    expect(signed.statusCode, signed.body).toBe(200);
  });

  it('[ODUDU-CIMD-JWKS-02] fetches a published jwks_uri holding it to public addresses only', async () => {
    const key = await buildClientSigningKey(KEK);
    const jwksUri = 'https://app.example.com:8443/jwks.json';
    serve({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: jwksUri });
    const consent = await signIn(await authorize(CLIENT_URL));
    const code = (await allow(consent)).searchParams.get('code') ?? '';
    const assertion = await signClientAssertion({
      key,
      clientId: CLIENT_URL,
      audience: `http://localhost/tenants/${tenant}/protocol/openid-connect/token`,
      kek: KEK,
    });

    await token({
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });

    expect(keySetFetch).toHaveBeenCalledWith(jwksUri, tenantId, true);
  });

  it('[ODUDU-CIMD-JWKS-03] fetches a jwks_uri for userinfo encryption holding it to public addresses only', async () => {
    const jwksUri = 'https://app.example.com:8443/jwks.json';
    serve({ jwks_uri: jwksUri });
    const consent = await signIn(await authorize(CLIENT_URL));
    const code = (await allow(consent)).searchParams.get('code') ?? '';
    const redeemed = await token({
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    const accessToken = redeemed.json<{ access_token: string }>().access_token;
    await owner.db
      .execute(sql`update client_oidc_config set userinfo_encrypted_response_alg = 'RSA-OAEP-256'
      where client_id = (select id from clients where tenant_id = ${tenantId} and client_id = ${CLIENT_URL})`);
    keySetFetch.mockClear();

    await http.inject({
      url: `/tenants/${tenant}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(keySetFetch).toHaveBeenCalledWith(jwksUri, tenantId, true);
  });
});
