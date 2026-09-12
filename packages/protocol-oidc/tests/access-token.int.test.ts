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
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
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

const KEK = Buffer.alloc(32, 5);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// The ceiling client_oidc_config_access_token_ttl_ceiling imposes
// (packages/db/drizzle/0013_access_token_ttl_ceiling.sql), spelled here
// rather than read from the database so that relaxing the constraint fails
// these assertions instead of moving them.
const CEILING_SECONDS = 3600;

interface RealmSetup {
  realmName: string;
  realmId: string;
  clientDbId: string;
  subjectId: string;
}

async function seedRealm(label: string): Promise<RealmSetup> {
  const realmName = `access-token-${label}-${newId()}`;
  const realmId = newId();
  const clientDbId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });

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

async function provision(realm: RealmSetup, accessTokenTtlSeconds: number): Promise<void> {
  await withRealm(app.db, realm.realmId, async (tx) => {
    await clientOidcConfigRepository(tx).create({
      clientId: realm.clientDbId,
      realmId: realm.realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
}

// Every way a client can be brought into existence with a given TTL, so the
// assertions below are about what the server will hold rather than about the
// one writer this suite happens to call.
async function provisioningError(realm: RealmSetup, ttl: number): Promise<string> {
  try {
    await provision(realm, ttl);
  } catch (caught) {
    const cause = caught instanceof Error ? caught.cause : null;
    return cause instanceof Error ? cause.message : String(caught);
  }
  throw new Error(`expected provisioning at ${String(ttl)} seconds to be refused`);
}

interface IssuedToken {
  accessToken: string;
  expiresIn: number;
}

// Issues an authorization code directly (bypassing /authorize's login UI, as
// the other suites here do) and redeems it through the real /token endpoint.
async function issueAccessToken(realm: RealmSetup): Promise<IssuedToken> {
  const code = generateAuthorizationCode();

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      realmId: realm.realmId,
      clientId: realm.clientDbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope: 'openid',
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
  const body = res.json<{ access_token: string; expires_in: number }>();
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

// Decodes without verifying: used only to read what the issuance path minted,
// never to make a trust decision.
function decodePayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function numericClaim(payload: Record<string, unknown>, name: string): number {
  const value = payload[name];
  if (typeof value !== 'number')
    throw new Error(`expected a numeric ${name}, got ${String(value)}`);
  return value;
}

let longestLived: RealmSetup;

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

  longestLived = await seedRealm('ceiling');
  await provision(longestLived, CEILING_SECONDS);
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// `exp` is `iat` plus the client's own `access_token_ttl_seconds`, so the
// lifetime of an access token is bounded only where that column is: a client
// provisioned with a day-long TTL would otherwise get a day-long token, and
// an `at+jwt` carries no revocation check a resource server could fall back
// on. Asserting the fixture's TTL would prove nothing about the server, so
// the pair of assertions below is about what the server will hold at all —
// nothing above the ceiling exists to be issued, and the longest-lived client
// that does exist expires in an hour.
describe('[RFC6750-5.2-02] the lifetime of an access token is bounded by the server', () => {
  it('will not hold a client whose access token TTL exceeds one hour', async () => {
    const realm = await seedRealm('over-ceiling');
    const message = await provisioningError(realm, CEILING_SECONDS + 1);
    expect(message).toContain('client_oidc_config_access_token_ttl_ceiling');
  });

  it('will not hold a client whose access tokens expire on issue or before it', async () => {
    const realm = await seedRealm('zero-ttl');
    expect(await provisioningError(realm, 0)).toContain(
      'client_oidc_config_access_token_ttl_ceiling',
    );
    expect(await provisioningError(realm, -1)).toContain(
      'client_oidc_config_access_token_ttl_ceiling',
    );
  });

  it('issues a token lasting an hour for the longest-lived client that can exist', async () => {
    const { accessToken, expiresIn } = await issueAccessToken(longestLived);
    const payload = decodePayload(accessToken);

    expect(numericClaim(payload, 'exp') - numericClaim(payload, 'iat')).toBe(CEILING_SECONDS);
    expect(expiresIn).toBe(CEILING_SECONDS);
  });
});

// RFC 4122 §4.4 / RFC 9562 §5.7 layout: version nibble 7, variant bits 10.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// `signJwt` assigns no `jti`; the access token's is minted in
// packages/protocol-oidc/src/usecase/token-issuance.ts, which is therefore
// the only place the collision property can be observed rather than assumed.
// A generator's own distinctness is `newId`'s business (and asserted in
// packages/kernel/src/ids.test.ts); what is asserted here is that the token
// actually carries one of its values.
describe('[JOSE-4.1-04] a minted access token carries a collision-resistant jti', () => {
  it('carries a uuidv7 jti that differs between two tokens for the same client', async () => {
    const first = decodePayload((await issueAccessToken(longestLived)).accessToken);
    const second = decodePayload((await issueAccessToken(longestLived)).accessToken);

    expect(first.jti).toMatch(UUIDV7);
    expect(second.jti).toMatch(UUIDV7);
    expect(first.jti).not.toBe(second.jti);
  });
});
