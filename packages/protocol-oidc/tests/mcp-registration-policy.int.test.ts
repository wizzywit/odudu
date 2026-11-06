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
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clientRepository,
  clientScopeRepository,
} from '@odudu/domain-tenant';
import { buildClientSigningKey, jwksDocumentFor } from '#/testing/private-key-jwt-fixture';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { oidcRoutes, type CimdResponse } from '#/index';
import { tenantRegistrationPolicyRepository } from '#/repository/tenant-registration-policy';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { createFetchLimiter } from '#/service/cimd-fetch-limiter';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 5);
const PASSWORD = 'correct horse battery staple';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CALLBACK = 'https://rp.example/cb';
const CLIENT_URL = 'https://app.example.com/oauth/client.json';
const PUBLIC_ADDRESS = '93.184.216.34';

let tenant: string;
let tenantId: string;
let mcpUrl: string;

const throttled = new Set<string>();
const documents = new Map<string, CimdResponse>();
const request = vi.fn((url: URL) => {
  const found = documents.get(url.href);
  return found === undefined
    ? Promise.reject(new Error('connection refused'))
    : Promise.resolve(found);
});

async function setupTenant(): Promise<{ name: string; id: string }> {
  const name = `mcp-${newId()}`;
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
  await owner.db.execute(
    sql`update tenants set client_registration_policy = 'mcp' where id = ${id}`,
  );
  return { name, id };
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
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      mcpRegistrationLimiter: {
        check: (tenantId) =>
          throttled.has(tenantId)
            ? { allowed: false, retryAfterSeconds: 42 }
            : { allowed: true, retryAfterSeconds: 0 },
      },
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
  throttled.clear();
  documents.clear();
  ({ name: tenant, id: tenantId } = await setupTenant());
  mcpUrl = `http://localhost/tenants/${tenant}/mcp`;
});

const PUBLIC = {
  redirect_uris: [CALLBACK],
  token_endpoint_auth_method: 'none',
  client_name: 'Notes',
};

function register(body: Record<string, unknown>, name = tenant): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${name}/clients-registrations/openid-connect`,
    payload: body,
  });
}

async function registered(body: Record<string, unknown> = PUBLIC): Promise<string> {
  const res = await register(body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ client_id: string }>().client_id;
}

function rowsOf(clientId: string, id = tenantId) {
  return withTenant(app.db, id, async (tx) => {
    const client = await clientRepository(tx).byClientId(clientId);
    const config =
      client === null ? null : await clientOidcConfigRepository(tx).byClientId(client.id);
    const scopes =
      client === null ? [] : await clientScopeRepository(tx).forClientByAssignment(client.id);
    return { client, config, scopes };
  });
}

async function clientCount(): Promise<number> {
  const rows = await owner.db.execute<{ count: number }>(
    sql`select count(*)::int as count from clients where tenant_id = ${tenantId}`,
  );
  return rows[0]?.count ?? 0;
}

function manyRedirects(): string[] {
  return Array.from({ length: 5000 }, (_, i) => `https://agent.example/cb/${String(i)}`);
}

describe('registration under the mcp policy', () => {
  it('refuses a __proto__ member and stores nothing', async () => {
    const before = await clientCount();
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant}/clients-registrations/openid-connect`,
      headers: { 'content-type': 'application/json' },
      payload:
        '{"__proto__":{"token_endpoint_auth_method":"client_secret_basic"},"redirect_uris":["https://rp.example/cb"],"token_endpoint_auth_method":"none"}',
    });
    expect(res.statusCode).toBe(400);
    expect(await clientCount()).toBe(before);
  });

  it('admits a public client bound to the tenant MCP URL, with mcp:read optional and consent required', async () => {
    const res = await register({ ...PUBLIC, scope: 'openid mcp:read', audience: mcpUrl });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ token_endpoint_auth_method: 'none', audience: [mcpUrl] });
    expect(body).not.toHaveProperty('client_secret');

    const { client, config, scopes } = await rowsOf(String(body.client_id));
    expect(client).toMatchObject({ type: 'public', registrationOrigin: 'anonymous' });
    expect(config).toMatchObject({ audiences: [mcpUrl], consentRequired: true });
    const mcp = scopes.filter((row) => row.scope.name.startsWith('mcp:'));
    expect(mcp.map((row) => [row.scope.name, row.assignment])).toEqual([['mcp:read', 'optional']]);
  });

  it('registers a client that asks for mcp:write without it, and says what it registered', async () => {
    const res = await register({ ...PUBLIC, scope: 'mcp:read mcp:write offline_access' });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.scope).toBe('mcp:read offline_access');
    const { scopes } = await rowsOf(String(body.client_id));
    expect(scopes.map((row) => row.scope.name)).not.toContain('mcp:write');
  });

  it('gives the MCP URL to a client that names no audience', async () => {
    const { config } = await rowsOf(await registered());
    expect(config?.audiences).toEqual([mcpUrl]);
  });

  const MEMBER = 'invalid_client_metadata';
  const REDIRECT = 'invalid_redirect_uri';
  it.each([
    ['a confidential client', { token_endpoint_auth_method: 'client_secret_basic' }, MEMBER],
    [
      'an http redirect that is not loopback',
      { redirect_uris: ['http://rp.example/cb'] },
      REDIRECT,
    ],
    ['a scope of which nothing may be held', { scope: 'mcp:write' }, MEMBER],
    ['another audience', { audience: ['https://api.example'] }, MEMBER],
    ['the admin API audience', { audience: 'urn:odudu:params:admin-api' }, MEMBER],
    ['the client_credentials grant', { grant_types: ['client_credentials'] }, MEMBER],
    [
      'the token-exchange grant',
      { grant_types: ['urn:ietf:params:oauth:grant-type:token-exchange'] },
      MEMBER,
    ],
    ['two audiences, one the MCP URL', { audience: [mcpUrl, 'https://api.example'] }, MEMBER],
    ['the same audience twice', { audience: [mcpUrl, mcpUrl] }, MEMBER],
    ['inline keys', { jwks: { keys: [] } }, MEMBER],
    ['a key set address', { jwks_uri: 'https://agent.example/jwks.json' }, MEMBER],
    [
      'a back-channel logout address',
      { backchannel_logout_uri: 'https://agent.example/bc' },
      MEMBER,
    ],
    [
      'a front-channel logout address',
      { frontchannel_logout_uri: 'https://agent.example/fc' },
      MEMBER,
    ],
    [
      'more redirect addresses than a client may hold',
      { redirect_uris: manyRedirects() },
      REDIRECT,
    ],
  ])(
    'refuses %s with the error its check names, and stores nothing',
    async (_label, change, code) => {
      const before = await clientCount();
      const res = await register({ ...PUBLIC, ...change });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json<{ error: string }>().error).toBe(code);
      expect(await clientCount()).toBe(before);
    },
  );

  it('admits a loopback http redirect on any port', async () => {
    await registered({ ...PUBLIC, redirect_uris: ['http://127.0.0.1:53124/cb'] });
  });

  it('does not read a registration token: the client stays anonymous and the token unspent', async () => {
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 }),
    );
    for (const attempt of [1, 2]) {
      const res = await http.inject({
        method: 'POST',
        url: `/tenants/${tenant}/clients-registrations/openid-connect`,
        headers: { authorization: `Bearer ${token}` },
        payload: { ...PUBLIC, client_name: `Notes ${String(attempt)}` },
      });
      expect(res.statusCode, res.body).toBe(201);
      const { client } = await rowsOf(res.json<{ client_id: string }>().client_id);
      expect(client?.registrationOrigin).toBe('anonymous');
    }
  });

  it('refuses the client past the tenant ceiling', async () => {
    await owner.db.execute(
      sql`update tenants set max_clients = ${(await clientCount()) + 1} where id = ${tenantId}`,
    );
    await registered();
    const res = await register(PUBLIC);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('refuses with 429 and a retry time once the origin has spent its budget', async () => {
    throttled.add(tenantId);
    const before = await clientCount();
    const res = await register(PUBLIC);
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(await clientCount()).toBe(before);
  });

  it('keeps one tenant’s budget from refusing another’s', async () => {
    throttled.add(tenantId);
    const { name } = await setupTenant();
    expect((await register(PUBLIC, name)).statusCode).toBe(201);
  });

  it('is advertised in discovery like any open policy', async () => {
    const res = await http.inject({ url: `/tenants/${tenant}/.well-known/openid-configuration` });
    expect(res.json<{ registration_endpoint?: string }>().registration_endpoint).toContain(
      'clients-registrations',
    );
  });
});

function authorize(
  clientId: string,
  extra: Record<string, string> = {},
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
  return http.inject({
    url: `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

function errorOf(res: LightMyRequestResponse): string | null {
  expect(res.statusCode).toBe(302);
  return new URL(String(res.headers.location)).searchParams.get('error');
}

function sessionOf(res: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

function form(
  path: string,
  fields: Record<string, string>,
  ticked: readonly string[] = [],
): Promise<LightMyRequestResponse> {
  const body = new URLSearchParams(fields);
  for (const scope of ticked) body.append('scope', scope);
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant}/${path}`,
    payload: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function signIn(res: LightMyRequestResponse): Promise<LightMyRequestResponse> {
  return form('login-actions/authenticate', {
    auth_session_id: sessionOf(res),
    username: 'ada',
    password: PASSWORD,
  });
}

async function allow(
  consent: LightMyRequestResponse,
  ticked: readonly string[] = [],
): Promise<URL> {
  const res = await form(
    'login-actions/consent',
    { auth_session_id: sessionOf(consent), decision: 'allow' },
    ticked,
  );
  expect(res.statusCode, res.body).toBe(302);
  return new URL(String(res.headers.location));
}

function asksConsent(res: LightMyRequestResponse): boolean {
  return res.statusCode === 200 && res.body.includes('login-actions/consent');
}

describe('/authorize for a client registered under the mcp policy', () => {
  it('admits mcp:read at the MCP URL', async () => {
    const client = await registered();
    const res = await authorize(client, { scope: 'openid mcp:read', resource: mcpUrl });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('requires PKCE', async () => {
    const client = await registered();
    const res = await authorize(client, { code_challenge: '', code_challenge_method: '' });
    expect(errorOf(res)).toBe('invalid_request');
  });

  it('refuses a request for mcp:write alone: nothing grantable is left', async () => {
    const client = await registered();
    const res = await authorize(client, { scope: 'mcp:write', resource: mcpUrl });
    expect(errorOf(res)).toBe('invalid_scope');
  });

  it('asks about mcp:read and grants read only when the request also names mcp:write', async () => {
    const client = await registered();
    const consent = await signIn(
      await authorize(client, { scope: 'openid mcp:read mcp:write', resource: mcpUrl }),
    );
    expect(asksConsent(consent)).toBe(true);
    expect(consent.body).toContain('mcp:read');
    expect(consent.body).not.toContain('mcp:write');
    const code = (await allow(consent, ['mcp:read'])).searchParams.get('code') ?? '';
    const redeemed = await form('protocol/openid-connect/token', {
      grant_type: 'authorization_code',
      client_id: client,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const { access_token: access, scope } = redeemed.json<{
      access_token: string;
      scope: string;
    }>();
    expect(scope.split(' ')).toContain('mcp:read');
    expect(scope.split(' ')).not.toContain('mcp:write');
    const claims = JSON.parse(
      Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { scope: string };
    expect(claims.scope).toBe(scope);
  });

  it('refuses a resource other than the MCP URL', async () => {
    const client = await registered();
    const res = await authorize(client, { resource: 'https://api.example' });
    expect(errorOf(res)).toBe('invalid_target');
  });
});

describe('consent for a client registered under the mcp policy', () => {
  it('is shown on every sign-in until this exact client id is approved', async () => {
    const client = await registered();
    const first = await signIn(await authorize(client));
    expect(asksConsent(first)).toBe(true);
    // Abandoned, not approved: the next sign-in asks again.
    const second = await signIn(await authorize(client));
    expect(asksConsent(second)).toBe(true);

    expect((await allow(second)).searchParams.get('code')).not.toBeNull();
    const approved = await signIn(await authorize(client));
    expect(asksConsent(approved)).toBe(false);
    expect(approved.statusCode).toBe(302);
  });

  it('does not let the approval of one client stand for another with the same name', async () => {
    const a = await registered();
    const b = await registered();
    expect(b).not.toBe(a);
    await allow(await signIn(await authorize(a)));

    expect(asksConsent(await signIn(await authorize(a)))).toBe(false);
    expect(asksConsent(await signIn(await authorize(b)))).toBe(true);
  });

  it('keeps asking about a client whose consent flag an administrator cleared, until it is approved', async () => {
    const client = await registered();
    await owner.db.execute(
      sql`update client_oidc_config set consent_required = false where tenant_id = ${tenantId}`,
    );
    expect(asksConsent(await signIn(await authorize(client)))).toBe(true);
  });
});

describe('a metadata document client under the mcp policy', () => {
  function serve(): void {
    documents.set(CLIENT_URL, {
      status: 200,
      contentType: 'application/json',
      cacheControl: 'no-store',
      body: JSON.stringify({
        client_id: CLIENT_URL,
        client_name: 'Example Notes',
        redirect_uris: [CALLBACK],
        audience: 'https://evil.example',
      }),
    });
  }

  function setPolicy(policy: string): Promise<unknown> {
    return owner.db.execute(
      sql`update tenants set client_registration_policy = ${policy}, cimd_enabled = true
        where id = ${tenantId}`,
    );
  }

  it('is given the MCP URL and mcp:read by the policy, never by its document', async () => {
    await setPolicy('mcp');
    serve();
    const consent = await signIn(
      await authorize(CLIENT_URL, { scope: 'openid mcp:read', resource: mcpUrl }),
    );
    expect(asksConsent(consent)).toBe(true);
    const code = (await allow(consent, ['mcp:read'])).searchParams.get('code') ?? '';

    const redeemed = await form('protocol/openid-connect/token', {
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const access = redeemed.json<{ access_token: string }>().access_token;
    const claims = JSON.parse(
      Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { aud: string | string[]; scope: string };
    expect([claims.aud].flat()).toContain(mcpUrl);
    expect(claims.aud).not.toContain('https://evil.example');
    expect(claims.scope.split(' ')).toContain('mcp:read');
  });

  it('is given neither when the policy is not mcp, and loses them when it stops being', async () => {
    await setPolicy('disabled');
    serve();
    const open = await authorize(CLIENT_URL, { resource: mcpUrl });
    expect(errorOf(open)).toBe('invalid_target');

    await setPolicy('mcp');
    expect((await authorize(CLIENT_URL, { resource: mcpUrl })).statusCode).toBe(200);

    await setPolicy('open');
    expect(errorOf(await authorize(CLIENT_URL, { resource: mcpUrl }))).toBe('invalid_target');
    expect((await rowsOf(CLIENT_URL)).config?.audiences).toEqual([]);
  });

  it('is refused a request for mcp:write alone, and asked about read only beside mcp:read', async () => {
    await setPolicy('mcp');
    serve();
    const alone = await authorize(CLIENT_URL, { scope: 'mcp:write', resource: mcpUrl });
    expect(errorOf(alone)).toBe('invalid_scope');

    const consent = await signIn(
      await authorize(CLIENT_URL, { scope: 'openid mcp:read mcp:write', resource: mcpUrl }),
    );
    expect(asksConsent(consent)).toBe(true);
    expect(consent.body).toContain('mcp:read');
    expect(consent.body).not.toContain('mcp:write');
    const code = (await allow(consent, ['mcp:read'])).searchParams.get('code') ?? '';
    const redeemed = await form('protocol/openid-connect/token', {
      grant_type: 'authorization_code',
      client_id: CLIENT_URL,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const granted = redeemed.json<{ scope: string }>().scope.split(' ');
    expect(granted).toContain('mcp:read');
    expect(granted).not.toContain('mcp:write');
  });
});

describe('after the policy is turned off', () => {
  function setPolicy(policy: string): Promise<unknown> {
    return owner.db.execute(
      sql`update tenants set client_registration_policy = ${policy}, cimd_enabled = true
        where id = ${tenantId}`,
    );
  }

  function claimsOf(response: LightMyRequestResponse): { aud: string | string[]; scope: string } {
    expect(response.statusCode, response.body).toBe(200);
    const access = response.json<{ access_token: string }>().access_token;
    return JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      aud: string | string[];
      scope: string;
    };
  }

  async function startChain(clientId: string) {
    const consent = await signIn(
      await authorize(clientId, {
        scope: 'openid mcp:read offline_access',
        resource: mcpUrl,
      }),
    );
    const code = (await allow(consent, ['mcp:read', 'offline_access'])).searchParams.get('code');
    const redeemed = await form('protocol/openid-connect/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code: code ?? '',
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    expect(claimsOf(redeemed).scope.split(' ')).toContain('mcp:read');
    return redeemed.json<{ refresh_token: string }>().refresh_token;
  }

  function refresh(clientId: string, token: string) {
    return form('protocol/openid-connect/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: token,
    });
  }

  it.each([
    ['a client registered under the policy', 'dcr'],
    ['a metadata document client', 'cimd'],
  ])('a refresh chain of %s stops carrying the MCP audience and mcp:read', async (_label, kind) => {
    let clientId = CLIENT_URL;
    if (kind === 'dcr') {
      clientId = await registered({
        ...PUBLIC,
        grant_types: ['authorization_code', 'refresh_token'],
      });
    } else {
      await setPolicy('mcp');
      documents.set(CLIENT_URL, {
        status: 200,
        contentType: 'application/json',
        cacheControl: 'no-store',
        body: JSON.stringify({
          client_id: CLIENT_URL,
          client_name: 'Example Notes',
          redirect_uris: [CALLBACK],
        }),
      });
    }
    const first = await startChain(clientId);

    const whileOn = await refresh(clientId, first);
    const stillOn = claimsOf(whileOn);
    expect([stillOn.aud].flat()).toContain(mcpUrl);
    expect(stillOn.scope.split(' ')).toContain('mcp:read');

    await setPolicy('disabled');
    const next = whileOn.json<{ refresh_token: string }>().refresh_token;
    const afterOff = claimsOf(await refresh(clientId, next));
    expect([afterOff.aud].flat()).not.toContain(mcpUrl);
    expect(afterOff.scope.split(' ')).not.toContain('mcp:read');
  });

  it('refuses to refresh a chain that would reach the admin API without its MCP scope', async () => {
    const clientId = await registered({
      ...PUBLIC,
      grant_types: ['authorization_code', 'refresh_token'],
    });
    const first = await startChain(clientId);
    await owner.db.execute(
      sql`update token_grants set audience = audience || ARRAY[${ADMIN_API_AUDIENCE}]::text[]
        where tenant_id = ${tenantId}`,
    );
    await setPolicy('disabled');

    const refused = await refresh(clientId, first);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toBe('invalid_scope');
    // Refused before the token was spent: the same refusal, not a replay.
    const again = await refresh(clientId, first);
    expect(again.json<{ error: string }>().error).toBe('invalid_scope');
  });

  it('refuses a refresh naming the MCP URL before the token is spent', async () => {
    const clientId = await registered({
      ...PUBLIC,
      grant_types: ['authorization_code', 'refresh_token'],
    });
    const first = await startChain(clientId);
    await setPolicy('disabled');

    const refused = await form('protocol/openid-connect/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: first,
      resource: mcpUrl,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toBe('invalid_target');

    // The token was not consumed: a retry without the resource succeeds
    // rather than tripping reuse detection.
    const retry = await refresh(clientId, first);
    expect(retry.statusCode, retry.body).toBe(200);
  });

  it('refuses a request for the MCP URL from a client registered under the policy', async () => {
    const client = await registered();
    await setPolicy('disabled');
    expect(errorOf(await authorize(client, { resource: mcpUrl }))).toBe('invalid_target');
    expect(errorOf(await authorize(client, { scope: 'openid mcp:read', resource: mcpUrl }))).toBe(
      'invalid_target',
    );
  });
});

describe('a client nobody at the tenant vetted is never given mcp:write', () => {
  it('does not grant it at /authorize even when an administrator assigned it', async () => {
    const client = await registered();
    await withTenant(app.db, tenantId, async (tx) => {
      const row = await clientRepository(tx).byClientId(client);
      const write = await clientScopeRepository(tx).byName('mcp:write');
      if (row === null || write === null) throw new Error('fixture missing');
      await clientScopeRepository(tx).assignOrUpdate(row.id, write.id, 'optional');
    });
    expect(errorOf(await authorize(client, { scope: 'mcp:write', resource: mcpUrl }))).toBe(
      'invalid_scope',
    );
    const consent = await signIn(
      await authorize(client, { scope: 'mcp:read mcp:write', resource: mcpUrl }),
    );
    expect(consent.body).not.toContain('mcp:write');
  });
});

describe('a confidential metadata document client under the mcp policy', () => {
  it('is not given the MCP audience or mcp:read: the policy is for public clients', async () => {
    await owner.db.execute(sql`update tenants set cimd_enabled = true where id = ${tenantId}`);
    const key = await buildClientSigningKey(KEK);
    documents.set(CLIENT_URL, {
      status: 200,
      contentType: 'application/json',
      cacheControl: 'no-store',
      body: JSON.stringify({
        client_id: CLIENT_URL,
        client_name: 'Server app',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: jwksDocumentFor(key),
      }),
    });
    const res = await authorize(CLIENT_URL, { resource: mcpUrl });
    expect(errorOf(res)).toBe('invalid_target');
    const { config, scopes } = await rowsOf(CLIENT_URL);
    expect(config?.audiences).toEqual([]);
    expect(scopes.map((row) => row.scope.name)).not.toContain('mcp:read');
  });
});

describe('tenantRegistrationPolicyRepository', () => {
  it('reads its own tenant’s policy and nothing of another’s', async () => {
    const { id: other } = await setupTenant();
    await owner.db.execute(
      sql`update tenants set client_registration_policy = 'open' where id = ${other}`,
    );
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = tenantRegistrationPolicyRepository(tx);
      expect(await repository.policy(tenantId)).toBe('mcp');
      expect(await repository.policy(other)).toBeNull();
    });
  });
});
