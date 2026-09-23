import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { authenticationSessions } from '@odudu/authn-flows';
import { clients, provisionClientDefaults, provisionTenantDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

async function issuerFor(instance: FastifyInstance, tenantName: string): Promise<string> {
  const res = await instance.inject({
    url: `/tenants/${tenantName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'unreachable-flow-client';
const REDIRECT_URI = 'https://app.example/callback';

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
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 3),
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

// A tenant given a scope vocabulary but never a flow (provisionTenantDefaults,
// not provisionTenant) — the state a tenant-creation site should never
// actually produce, but the only honest way to reach "reauthentication
// cannot be performed" without a flow tree deep enough to make every row
// inapplicable some other way.
async function setupTenantWithNoFlow(name: string): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenantDefaults(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Unreachable flow test client',
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
  return tenantId;
}

function authorizeUrl(tenantName: string, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'abc123',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    prompt: 'login',
    ...overrides,
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

// OIDC Core §3.1.2.1: "with prompt=login ... an error (typically
// login_required) is returned if reauthentication cannot be performed". A
// tenant whose flow has no applicable execution at all is that state —
// nextStep (authn-flows) returns 'fail' for it, before any credential is
// asked for. The check answers login_required for any request that would
// otherwise start authentication, not only `prompt=login`: a flow with no
// applicable execution can never authenticate anyone regardless of prompt.
describe('[OIDC-CORE-3.1.2.1-11] prompt=login answers login_required for a flow with no applicable execution', () => {
  it('redirects to the redirect_uri with login_required, rendering nothing and parking nothing', async () => {
    const tenantName = `unreachable-flow-${newId()}`;
    const tenantId = await setupTenantWithNoFlow(tenantName);

    const res = await http.inject({ url: authorizeUrl(tenantName) });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('state')).toBe('abc123');
    expect(location.searchParams.get('iss')).toBe(await issuerFor(http, tenantName));
    expect(location.searchParams.get('code')).toBeNull();
    expect(res.headers['set-cookie']).toBeUndefined();

    const parked = await owner.db
      .select()
      .from(authenticationSessions)
      .where(eq(authenticationSessions.tenantId, tenantId));
    expect(parked).toHaveLength(0);
  });
});
