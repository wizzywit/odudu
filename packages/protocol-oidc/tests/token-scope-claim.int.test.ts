import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import {
  clients,
  clientScopes,
  provisionClientDefaults,
  provisionRealmDefaults,
} from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 9);
const REDIRECT_URI = 'https://app.example/callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface RealmSetup {
  realmName: string;
  realmId: string;
  clientDbId: string;
  subjectId: string;
}

async function seedRealm(label: string): Promise<RealmSetup> {
  const realmName = `token-scope-claim-${label}-${newId()}`;
  const realmId = newId();
  const clientDbId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });
    await provisionRealmDefaults(tx, realmId);

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: `alice-${label}` });

    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await provisionClientDefaults(tx, clientDbId);

    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
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

// Direct SQL, not a repository method: this suite exists precisely because
// no issuance path read this column before, so no higher-level API to flip
// it was ever built. Reaching for one now would test a method invented for
// the test rather than the column the seed CLI already exposes.
async function setIncludeInTokenScope(
  realm: RealmSetup,
  scopeName: string,
  value: boolean,
): Promise<void> {
  await withRealm(app.db, realm.realmId, (tx) =>
    tx
      .update(clientScopes)
      .set({ includeInTokenScope: value })
      .where(eq(clientScopes.name, scopeName)),
  );
}

interface Issued {
  accessToken: string;
  idToken: string;
}

async function issueTokens(realm: RealmSetup, scope: string): Promise<Issued> {
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
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realm.realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('web-app:supersecret').toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

function decodePayload(token: string): Record<string, unknown> {
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
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('client_scopes.include_in_token_scope', () => {
  it('leaves a scope in the emitted scope claim when the flag is on (the default)', async () => {
    const realm = await seedRealm('on');
    const { accessToken } = await issueTokens(realm, 'openid profile');
    const payload = decodePayload(accessToken);
    expect(String(payload.scope)).toBe('openid profile');
  });

  it('drops the scope name from the emitted scope claim when the flag is off, without touching openid', async () => {
    const realm = await seedRealm('off');
    await setIncludeInTokenScope(realm, 'profile', false);

    const { accessToken } = await issueTokens(realm, 'openid profile');
    const payload = decodePayload(accessToken);
    expect(String(payload.scope)).toBe('openid');
  });

  it('still emits the excluded scope’s own claims even though its name is gone from scope', async () => {
    const realm = await seedRealm('claims-survive');
    await setIncludeInTokenScope(realm, 'profile', false);

    const { idToken } = await issueTokens(realm, 'openid profile');
    const payload = decodePayload(idToken);
    // profile's mapper falls back to username, so `name` is always present
    // once the profile scope was granted, flag or no flag.
    expect(payload.name).toBe(`alice-claims-survive`);
  });

  it('keeps openid in the scope claim even when its own flag is turned off', async () => {
    const realm = await seedRealm('openid-off');
    await setIncludeInTokenScope(realm, 'openid', false);

    const { accessToken } = await issueTokens(realm, 'openid profile');
    const payload = decodePayload(accessToken);
    expect(String(payload.scope).split(' ')).toContain('openid');
  });
});
