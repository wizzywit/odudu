import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import {
  clientScopeRepository,
  clients,
  provisionClientDefaults,
  provisionRealmDefaults,
} from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
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
    oidcRoutes({ database: app, ownerDatabase: owner, kek: Buffer.alloc(32, 7) }),
  );
  await http.ready();

  realmId = newId();
  clientRowId = newId();
  await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({ id: realmId, name: REALM });
    await provisionRealmDefaults(tx, realmId);
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
