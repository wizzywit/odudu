import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { provisionRealm } from '@odudu/authn-flows';
import { clientScopeRepository, clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const REALM = 'demo';
const CLIENT_ID = 'app-a';
const REDIRECT_URI = 'https://app.example/callback';

let realmId: string;
let clientRowId: string;

async function createScope(name: string): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const scope = await clientScopeRepository(tx).create({ realmId, name });
    return scope.id;
  });
}

async function assignScope(scopeId: string): Promise<void> {
  await withRealm(app.db, realmId, (tx) =>
    clientScopeRepository(tx).assign(clientRowId, scopeId, 'optional'),
  );
}

function authorizeWith(scope: string): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  });
  return http.inject({
    url: `/realms/${REALM}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

function errorOf(res: LightMyRequestResponse): string | null {
  const location = res.headers.location;
  if (typeof location !== 'string') return null;
  return new URL(location).searchParams.get('error');
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
  httpApp = http;
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 7),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();

  realmId = newId();
  clientRowId = newId();
  await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({ id: realmId, name: REALM });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientRowId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Realm scopes test client',
      type: 'public',
      secretHash: null,
    });
    await provisionClientDefaults(tx, clientRowId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientRowId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function servedScopes(): Promise<string[]> {
  const res = await http.inject({ url: `/realms/${REALM}/.well-known/openid-configuration` });
  return res.json<{ scopes_supported: string[] }>().scopes_supported;
}

describe('[OIDC-DISCOVERY-3-01] the served discovery document', () => {
  // §3 requires the server to support the `openid` scope value, and a realm's
  // vocabulary is now the only thing that can make that true: if `openid`
  // left the set provisionTenantDefaults seeds, this is what would notice.
  it('lists openid for a realm provisioned with nothing but the defaults', async () => {
    expect(await servedScopes()).toContain('openid');
  });
});

// The list discovery advertises and the list /authorize validates against are
// one closure in packages/protocol-oidc/src/index.ts. Asserted here through
// the two routes rather than through a shared local value, because a shared
// local value would agree with itself however the routes were wired.
describe('what discovery advertises is what /authorize accepts', () => {
  it('accepts every served scope this client is assigned', async () => {
    const served = new Set(await servedScopes());
    const assigned = await withRealm(app.db, realmId, async (tx) =>
      (await clientScopeRepository(tx).forClient(clientRowId)).map((scope) => scope.name),
    );
    const grantable = assigned.filter((name) => served.has(name));
    expect(grantable.length).toBeGreaterThan(1);

    for (const name of grantable) {
      const res = await authorizeWith(name);
      expect(errorOf(res), `${name} is advertised and assigned but was refused`).toBeNull();
      expect(res.statusCode).toBe(200);
    }
  });

  it('refuses a name the served document does not carry', async () => {
    const served = new Set(await servedScopes());
    const absent = 'reports:never-advertised';
    expect(served).not.toContain(absent);

    expect(errorOf(await authorizeWith(`openid ${absent}`))).toBe('invalid_scope');
  });
});

describe('scopes come from the realm', () => {
  it('advertises exactly the scopes the realm defines', async () => {
    await createScope('reports:advertised');

    const res = await http.inject({
      url: `/realms/${REALM}/.well-known/openid-configuration`,
    });
    const advertised = res.json<{ scopes_supported: string[] }>().scopes_supported;
    const defined = await withRealm(app.db, realmId, async (tx) =>
      (await clientScopeRepository(tx).allForRealm()).map((scope) => scope.name),
    );

    expect(advertised).toContain('reports:advertised');
    expect([...advertised].sort()).toEqual([...defined].sort());
  });

  it('refuses a scope the realm has never heard of', async () => {
    const res = await authorizeWith('openid nonsense');
    expect(errorOf(res)).toBe('invalid_scope');
  });

  it('refuses a scope the realm defines but this client is not assigned', async () => {
    await createScope('reports:unassigned');

    const res = await authorizeWith('openid reports:unassigned');
    expect(errorOf(res)).toBe('invalid_scope');
  });

  it('grants a scope the client is assigned', async () => {
    const scopeId = await createScope('reports:assigned');
    await assignScope(scopeId);

    const res = await authorizeWith('openid reports:assigned');
    expect(errorOf(res)).toBeNull();
    expect(res.statusCode).toBe(200);
  });
});
