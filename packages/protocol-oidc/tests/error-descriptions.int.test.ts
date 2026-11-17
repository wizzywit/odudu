import { provisionTenant } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { OAUTH_ERROR_DESCRIPTIONS } from '#/service/oauth-errors';
import { noBreachedLookup } from '#/testing/breached-check';

// An OAuth error says in a few plain words what went wrong, where RFC 6749
// allows it, and the sentence is never built from the request.

const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

async function tenantWithClient(): Promise<string> {
  const name = `desc-${newId()}`;
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: 'spa',
      name: 'Spa',
      type: 'public',
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
  });
  return name;
}

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
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 3),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      clock: new FakeClock(new Date()),
      tls: false,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

function authorize(tenant: string, extra: Record<string, string | undefined>) {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: 'spa',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  };
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return http.inject({
    url: `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

describe('the authorization endpoint redirects an error with an error_description', () => {
  it('names the missing PKCE challenge plainly', async () => {
    const tenant = await tenantWithClient();
    const res = await authorize(tenant, { code_challenge: undefined });
    expect(res.statusCode).toBe(302);
    const back = new URL(String(res.headers.location));
    expect(back.searchParams.get('error')).toBe('invalid_request');
    expect(back.searchParams.get('error_description')).toBe('code_challenge is required');
    expect(back.searchParams.get('state')).toBe('xyz');
  });

  it.each([
    [
      'code_challenge_method',
      { code_challenge_method: 'plain' },
      'code_challenge_method must be S256',
    ],
    [
      'response_type',
      { response_type: 'token' },
      OAUTH_ERROR_DESCRIPTIONS.unsupported_response_type,
    ],
    ['scope', { scope: 'openid nonsense' }, OAUTH_ERROR_DESCRIPTIONS.invalid_scope],
    ['request object', { request: 'x' }, OAUTH_ERROR_DESCRIPTIONS.request_not_supported],
    ['claims', { claims: '{' }, 'claims is not valid'],
    ['id_token_hint', { id_token_hint: 'not.a.jwt' }, 'id_token_hint is not valid'],
    ['prompt', { prompt: 'none login' }, 'prompt is not valid'],
  ])('says what is wrong with %s', async (_label, extra, description) => {
    const tenant = await tenantWithClient();
    const back = new URL(String((await authorize(tenant, extra)).headers.location));
    expect(back.searchParams.get('error_description')).toBe(description);
  });

  it('never carries what the request sent', async () => {
    const tenant = await tenantWithClient();
    const res = await authorize(tenant, { scope: 'openid SENTINEL<b>' });
    expect(String(res.headers.location)).not.toContain('SENTINEL');
  });

  it('describes an error in another tenant the same, and serves it under its own name only', async () => {
    const a = await tenantWithClient();
    const b = await tenantWithClient();
    const one = new URL(
      String((await authorize(a, { code_challenge: undefined })).headers.location),
    );
    const other = new URL(
      String((await authorize(b, { code_challenge: undefined })).headers.location),
    );
    expect(one.searchParams.get('error_description')).toBe(
      other.searchParams.get('error_description'),
    );
    // A client of tenant A is unknown to tenant B: refused as a page, not redirected.
    const crossed = await http.inject({
      url: `/tenants/${b}/protocol/openid-connect/auth?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(crossed.statusCode).toBe(400);
  });
});

describe('the token endpoint answers an error with an error_description', () => {
  it('gives invalid_grant a sentence that names no cause', async () => {
    const tenant = await tenantWithClient();
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant}/protocol/openid-connect/token`,
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'not-a-code',
        redirect_uri: REDIRECT_URI,
        client_id: 'spa',
        code_verifier: 'v'.repeat(43),
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid_grant',
      error_description: OAUTH_ERROR_DESCRIPTIONS.invalid_grant,
    });
  });

  it('gives an unsupported grant type its sentence', async () => {
    const tenant = await tenantWithClient();
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant}/protocol/openid-connect/token`,
      payload: new URLSearchParams({ grant_type: 'password', client_id: 'spa' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.json()).toMatchObject({
      error: 'unsupported_grant_type',
      error_description: OAUTH_ERROR_DESCRIPTIONS.unsupported_grant_type,
    });
  });
});
