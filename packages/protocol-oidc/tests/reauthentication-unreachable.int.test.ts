import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { authenticationSessions } from '@odudu/authn-flows';
import { clients, provisionClientDefaults, provisionRealmDefaults } from '@odudu/domain-realm';
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

async function issuerFor(instance: FastifyInstance, realmName: string): Promise<string> {
  const res = await instance.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
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

// A realm given a scope vocabulary but never a flow (provisionRealmDefaults,
// not provisionRealm) — the state a realm-creation site should never
// actually produce, but the only honest way to reach "reauthentication
// cannot be performed" without a flow tree deep enough to make every row
// inapplicable some other way.
async function setupRealmWithNoFlow(name: string): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealmDefaults(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Unreachable flow test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
  return realmId;
}

function authorizeUrl(realmName: string, overrides: Record<string, string> = {}): string {
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
  return `/realms/${realmName}/protocol/openid-connect/auth?${params.toString()}`;
}

// OIDC Core §3.1.2.1: "with prompt=login ... an error (typically
// login_required) is returned if reauthentication cannot be performed". A
// realm whose flow has no applicable execution at all is that state —
// nextStep (authn-flows) returns 'fail' for it, before any credential is
// asked for. The check answers login_required for any request that would
// otherwise start authentication, not only `prompt=login`: a flow with no
// applicable execution can never authenticate anyone regardless of prompt.
describe('[OIDC-CORE-3.1.2.1-11] prompt=login answers login_required for a flow with no applicable execution', () => {
  it('redirects to the redirect_uri with login_required, rendering nothing and parking nothing', async () => {
    const realmName = `unreachable-flow-${newId()}`;
    const realmId = await setupRealmWithNoFlow(realmName);

    const res = await http.inject({ url: authorizeUrl(realmName) });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('state')).toBe('abc123');
    expect(location.searchParams.get('iss')).toBe(await issuerFor(http, realmName));
    expect(location.searchParams.get('code')).toBeNull();
    expect(res.headers['set-cookie']).toBeUndefined();

    const parked = await owner.db
      .select()
      .from(authenticationSessions)
      .where(eq(authenticationSessions.realmId, realmId));
    expect(parked).toHaveLength(0);
  });
});
