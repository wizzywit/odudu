import { generateSigningKey, signJwt, signingKeyRepository, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { provisionRealm } from '@odudu/authn-flows';
import { subjectRepository } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);

let REALM: string;
let REALM_ID: string;

async function seedClient(input: {
  clientId: string;
  webOrigins: string[];
  enabled?: boolean;
}): Promise<string> {
  const dbId = newId();
  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(clients).values({
      id: dbId,
      realmId: REALM_ID,
      clientId: input.clientId,
      name: input.clientId,
      type: 'public',
      enabled: input.enabled ?? true,
    });
    await provisionClientDefaults(tx, dbId);
    await clientOidcConfigRepository(tx).create({
      clientId: dbId,
      realmId: REALM_ID,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      webOrigins: input.webOrigins,
    });
  });
  return dbId;
}

function tokenRequestFor(clientId: string): string {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', clientId);
  return form.toString();
}

// Mints an access token directly, bypassing the full authorization_code
// flow: /userinfo's CORS decision reads `client_id` from the token's own
// claims, which is all this needs to exercise it. Still has to carry a
// `grant_id` naming a real `token_grants` row — /userinfo now consults it
// (loadGrant/isSessionLive, the C1 fix) the same way /introspect always
// has, and a token with no such row is exactly what that check exists to
// refuse. `sessionId: null` here is the same shape a `client_credentials`
// token's grant has — no End-User, so no session to carry.
async function mintAccessToken(
  clientId: string,
  clientDbId: string,
): Promise<{ token: string; grantId: string }> {
  const key = await withRealm(app.db, REALM_ID, (tx) => signingKeyRepository(tx).active());
  const issuer = `http://localhost/realms/${REALM}`;
  const now = Math.floor(Date.now() / 1000);
  const grantId = newId();
  const subjectId = await withRealm(app.db, REALM_ID, async (tx) => {
    const subject = await subjectRepository(tx).create({ realmId: REALM_ID, type: 'user' });
    await tokenGrantRepository(tx).create({
      id: grantId,
      realmId: REALM_ID,
      clientId: clientDbId,
      subjectId: subject.id,
      scope: 'openid',
      audience: [issuer],
      sessionId: null,
    });
    return subject.id;
  });
  const token = await signJwt(
    {
      iss: issuer,
      sub: subjectId,
      aud: [issuer],
      client_id: clientId,
      scope: 'openid',
      iat: now,
      exp: now + 300,
      jti: newId(),
      grant_id: grantId,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
  return { token, grantId };
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

  REALM = `cors-${newId()}`;
  REALM_ID = newId();
  await withRealm(app.db, REALM_ID, async (tx) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);
    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId: REALM_ID,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });

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
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('preflight is answered from the realm, the request from the client', () => {
  it('allows at preflight an origin that belongs to another client, then withholds it on the real request', async () => {
    const clientA = `app-a-${newId()}`;
    await seedClient({ clientId: clientA, webOrigins: ['https://a.example'] });
    await seedClient({ clientId: `app-b-${newId()}`, webOrigins: ['https://b.example'] });

    const preflight = await http.inject({
      method: 'OPTIONS',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      headers: { origin: 'https://b.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('https://b.example');

    const actual = await http.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      headers: {
        origin: 'https://b.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: tokenRequestFor(clientA),
    });
    expect(actual.headers['access-control-allow-origin']).toBeUndefined();
    expect(actual.headers.vary).toBe('Origin');
  });

  it("echoes the origin back on the real /token request when it is the resolved client's own", async () => {
    const clientC = `app-c-${newId()}`;
    await seedClient({ clientId: clientC, webOrigins: ['https://c.example'] });

    const actual = await http.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      headers: {
        origin: 'https://c.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: tokenRequestFor(clientC),
    });
    expect(actual.headers['access-control-allow-origin']).toBe('https://c.example');
    expect(actual.headers.vary).toBe('Origin');
  });

  it("echoes the origin back on the real /userinfo request when it is the resolved client's own", async () => {
    const clientD = `app-d-${newId()}`;
    const clientDbId = await seedClient({ clientId: clientD, webOrigins: ['https://d.example'] });
    const { token: accessToken } = await mintAccessToken(clientD, clientDbId);

    const own = await http.inject({
      method: 'GET',
      url: `/realms/${REALM}/protocol/openid-connect/userinfo`,
      headers: { origin: 'https://d.example', authorization: `Bearer ${accessToken}` },
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['access-control-allow-origin']).toBe('https://d.example');
    expect(own.headers.vary).toBe('Origin');

    const foreign = await http.inject({
      method: 'GET',
      url: `/realms/${REALM}/protocol/openid-connect/userinfo`,
      headers: { origin: 'https://not-d.example', authorization: `Bearer ${accessToken}` },
    });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    expect(foreign.headers.vary).toBe('Origin');
  });

  // N1: a revoked grant's invalid_token refusal is still reached with a
  // verified client_id, so a single-page app whose user has just logged out
  // gets a readable 401 in the browser rather than an opaque CORS failure —
  // the origin is echoed exactly as it is on a 200.
  it("still echoes the origin on a revoked grant's 401 invalid_token refusal", async () => {
    const clientE = `app-e-${newId()}`;
    const clientDbId = await seedClient({ clientId: clientE, webOrigins: ['https://e.example'] });
    const { token: accessToken, grantId } = await mintAccessToken(clientE, clientDbId);
    await withRealm(app.db, REALM_ID, (tx) => tokenGrantRepository(tx).revoke(grantId, new Date()));

    const res = await http.inject({
      method: 'GET',
      url: `/realms/${REALM}/protocol/openid-connect/userinfo`,
      headers: { origin: 'https://e.example', authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
    expect(res.headers['access-control-allow-origin']).toBe('https://e.example');
    expect(res.headers.vary).toBe('Origin');
  });

  it('excludes a disabled client from the preflight union', async () => {
    const disabled = `app-disabled-${newId()}`;
    await seedClient({
      clientId: disabled,
      webOrigins: ['https://disabled.example'],
      enabled: false,
    });

    const preflight = await http.inject({
      method: 'OPTIONS',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      headers: { origin: 'https://disabled.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("withholds the header on a disabled client's own real request", async () => {
    const disabled = `app-disabled-real-${newId()}`;
    await seedClient({
      clientId: disabled,
      webOrigins: ['https://disabled-real.example'],
      enabled: false,
    });

    const actual = await http.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      headers: {
        origin: 'https://disabled-real.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: tokenRequestFor(disabled),
    });
    expect(actual.headers['access-control-allow-origin']).toBeUndefined();
    expect(actual.headers.vary).toBe('Origin');
  });

  it('never sets allow-credentials on any endpoint', async () => {
    for (const url of [
      `/realms/${REALM}/protocol/openid-connect/token`,
      `/realms/${REALM}/protocol/openid-connect/userinfo`,
      `/realms/${REALM}/protocol/openid-connect/certs`,
      `/realms/${REALM}/.well-known/openid-configuration`,
    ]) {
      const res = await http.inject({
        method: 'OPTIONS',
        url,
        headers: { origin: 'https://a.example', 'access-control-request-method': 'GET' },
      });
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  it('sets no CORS header on the authorization endpoint', async () => {
    const res = await http.inject({
      method: 'OPTIONS',
      url: `/realms/${REALM}/protocol/openid-connect/auth`,
      headers: { origin: 'https://a.example', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the certs and discovery documents with a bare wildcard and no Vary', async () => {
    const certs = await http.inject({
      method: 'GET',
      url: `/realms/${REALM}/protocol/openid-connect/certs`,
      headers: { origin: 'https://anything.example' },
    });
    expect(certs.headers['access-control-allow-origin']).toBe('*');
    expect(certs.headers.vary).toBeUndefined();

    const discovery = await http.inject({
      method: 'GET',
      url: `/realms/${REALM}/.well-known/openid-configuration`,
      headers: { origin: 'https://anything.example' },
    });
    expect(discovery.headers['access-control-allow-origin']).toBe('*');
    expect(discovery.headers.vary).toBeUndefined();
  });
});
