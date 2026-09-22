import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { subjectRepository, userRepository, users } from '@odudu/domain-identity';
import { provisionRealm } from '@odudu/authn-flows';
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
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { standardClaimMappers } from '#/service/claims';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Realm {
  realmName: string;
  realmId: string;
  clientDbId: string;
  subjectId: string;
}

async function seedRealm(label: string): Promise<Realm> {
  const realmName = `claims-supported-${label}-${newId()}`;
  const realmId = newId();
  const clientDbId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });
    await provisionRealm(tx, realmId);

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: `ada-${label}` });
    await userRepository(tx).updateProfile(subject.id, {
      addressLocality: 'London',
      addressCountry: 'GB',
      phoneNumber: '+12015550123',
      phoneNumberVerified: true,
    });

    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'public',
      secretHash: null,
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

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    return subject.id;
  });

  return { realmName, realmId, clientDbId, subjectId };
}

interface TokenSet {
  accessToken: string;
  idToken: string | undefined;
}

async function completeCodeFlow(realm: Realm, scope: string): Promise<TokenSet> {
  const code = generateAuthorizationCode();

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      realmId: realm.realmId,
      clientId: realm.clientDbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: [],
      claims: { idToken: {}, userinfo: {} },
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('client_id', 'web-app');
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realm.realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

async function userinfo(realm: Realm, accessToken: string): Promise<Record<string, unknown>> {
  const res = await http.inject({
    method: 'GET',
    url: `/realms/${realm.realmName}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

// Decodes without verifying: used only to read what issuance minted, never
// to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
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
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('address and phone reach the ID token and /userinfo, once granted', () => {
  it('carries address and phone on the ID token', async () => {
    const realm = await seedRealm('id-token');

    const { idToken } = await completeCodeFlow(realm, 'openid address phone');
    if (idToken === undefined) throw new Error('expected an id_token');

    expect(decode(idToken)).toMatchObject({
      address: { locality: 'London', country: 'GB' },
      phone_number: '+12015550123',
      phone_number_verified: true,
    });
  });

  it('carries address and phone from /userinfo the same way', async () => {
    const realm = await seedRealm('userinfo');

    const { accessToken } = await completeCodeFlow(realm, 'openid address phone');

    expect(await userinfo(realm, accessToken)).toMatchObject({
      address: { locality: 'London', country: 'GB' },
      phone_number: '+12015550123',
      phone_number_verified: true,
    });
  });

  it('stays off the access token by default, like every other identity claim', async () => {
    const realm = await seedRealm('access-token');

    const { accessToken } = await completeCodeFlow(realm, 'openid address phone');
    const payload = decode(accessToken);

    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('phone_number');
    expect(payload).not.toHaveProperty('phone_number_verified');
  });
});

describe('[OIDC-DISCOVERY-4-01] claims_supported matches what the registry produces', () => {
  it('advertises exactly the claim names standardClaimMappers can produce', async () => {
    const realm = await seedRealm('discovery');

    const res = await http.inject({
      url: `/realms/${realm.realmName}/.well-known/openid-configuration`,
    });
    const advertised = res.json<{ claims_supported: string[] }>().claims_supported;

    expect([...advertised].sort()).toEqual([...standardClaimMappers().claimNames()].sort());
  });

  it('never advertises entitlements', async () => {
    const realm = await seedRealm('discovery-entitlements');

    const res = await http.inject({
      url: `/realms/${realm.realmName}/.well-known/openid-configuration`,
    });
    const advertised = res.json<{ claims_supported: string[] }>().claims_supported;

    expect(advertised).not.toContain('entitlements');
  });
});
