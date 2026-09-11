import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance } from 'fastify';
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

const REALM = 'acme';
const CLIENT_ID = 'authorize-adversarial-client';
const REDIRECT_URI = 'https://app.example/callback';

function authorizeUrl(overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${REALM}/protocol/openid-connect/auth?${query.toString()}`;
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
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner }));
  await http.ready();

  const realmId = newId();
  const clientId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: REALM });
    await tx.insert(clients).values({
      id: clientId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Adversarial test client',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    await clientOidcConfigRepository(tx).create({
      clientId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
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

describe('[RFC6749-4.1.2.1-03] emits no location header for an unregistered redirect_uri', () => {
  it('returns 400 with no location header at all', async () => {
    const res = await http.inject({
      url: authorizeUrl({ redirect_uri: 'https://evil.example/cb' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('[RFC6749-4.1.2.1-04] returns state unchanged on a redirected error', () => {
  it('echoes state back exactly, including spaces, on the redirect', async () => {
    const res = await http.inject({
      url: authorizeUrl({ response_type: 'token', state: 'xyz 123' }),
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('state')).toBe('xyz 123');
    expect(new URL(location).searchParams.get('error')).toBe('unsupported_response_type');
  });
});

describe('the success path starts an authentication session and renders the login form', () => {
  it('returns 200 with an HTML form posting to the login-actions handler', async () => {
    const res = await http.inject({ url: authorizeUrl() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`/realms/${REALM}/login-actions/authenticate`);
    expect(res.body).toContain('name="auth_session_id"');
  });
});
