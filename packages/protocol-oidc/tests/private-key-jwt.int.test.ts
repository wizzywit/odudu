import formbody from '@fastify/formbody';
import { provisionRealm } from '@odudu/authn-flows';
import {
  generateSigningKey,
  signJwt,
  signingKeys,
  toPublicJwk,
  type SigningKeyRecord,
} from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type LightMyRequestResponse,
} from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientKeySet, type ClientKeyRequest } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 13);
const NOW = new Date('2026-09-21T00:00:00Z');

// The Host `http.inject` sends when a request names none — `view/issuer.ts`
// derives the audience an assertion must carry from exactly this, so the
// fixture computes it the same way rather than asserting a literal.
const REALM_ISSUER_BASE = 'http://localhost';

let REALM: string;
let REALM_ID: string;
let AUDIENCE: string;

// This suite's whole point: every refusal is this one body, whatever
// failed, of the eight branches `authenticatePrivateKeyJwt` has — see
// docs/protocols/rfc7523.md's "One refusal, not several" for the list,
// re-derived from the code rather than copied stale.
const REFUSAL = { error: 'invalid_client' };

let logLines: unknown[] = [];

async function buildClientKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: newId(),
    realmId: REALM_ID,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

function jwksFor(key: SigningKeyRecord): { keys: Record<string, unknown>[] } {
  return { keys: [toPublicJwk(key.publicJwk, key.kid, key.alg)] };
}

async function signAssertion(
  key: SigningKeyRecord,
  clientId: string,
  overrides: { jti?: string; aud?: string; exp?: number; iss?: string; sub?: string } = {},
): Promise<string> {
  const nowSeconds = Math.floor(NOW.getTime() / 1000);
  return signJwt(
    {
      iss: overrides.iss ?? clientId,
      sub: overrides.sub ?? clientId,
      aud: overrides.aud ?? AUDIENCE,
      exp: overrides.exp ?? nowSeconds + 60,
      jti: overrides.jti ?? newId(),
    },
    { key, kek: KEK },
  );
}

let clientKey: SigningKeyRecord;
let inlineKey: SigningKeyRecord;
let strangerKey: SigningKeyRecord;
let serviceSubjectId: string;

// The fake transport `clientKeySet` fetches through. No real socket is
// opened: `pkj-client.example` answers with `clientKey`'s published JWKS,
// `unreachable.example` never answers at all (an Error the way a timed-out
// socket would reject), `bad-document.example` answers with valid JSON
// that is not a JWK Set, and every other host is a fixture bug.
const request: ClientKeyRequest = (url) => {
  if (url.hostname === 'unreachable.example') {
    return Promise.reject(new Error('connection to unreachable.example timed out'));
  }
  if (url.hostname === 'pkj-client.example') {
    return Promise.resolve({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(jwksFor(clientKey)),
    });
  }
  if (url.hostname === 'bad-document.example') {
    return Promise.resolve({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ not: 'a jwk set' }),
    });
  }
  return Promise.reject(new Error(`unexpected fetch to ${url.hostname}`));
};

// `private-uri-client.example` alone resolves to a loopback address, so
// the address guard — not the fetch — is what refuses it.
const lookup = (hostname: string): Promise<readonly string[]> =>
  Promise.resolve(hostname === 'private-uri-client.example' ? ['127.0.0.1'] : ['93.184.216.34']);

async function createClient(
  tx: RealmScopedDatabase,
  input: {
    clientId: string;
    method: 'private_key_jwt' | 'client_secret_basic';
    jwks?: unknown;
    jwksUri?: string;
    enabled?: boolean;
  },
): Promise<void> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    realmId: REALM_ID,
    clientId: input.clientId,
    name: input.clientId,
    type: 'confidential',
    enabled: input.enabled ?? true,
    // clients_secret_matches_type requires a confidential client to carry
    // one; its value is irrelevant to every private_key_jwt path, which
    // never reads it, and to `basic-client`'s test, which sends a
    // guaranteed-wrong password.
    secretHash: await hashPassword('unused'),
    serviceSubjectId,
  });
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    realmId: REALM_ID,
    redirectUris: [],
    grantTypes: ['client_credentials'],
    tokenEndpointAuthMethod: input.method,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    jwks: input.jwks ?? null,
    jwksUri: input.jwksUri ?? null,
  });
}

async function setupRealm(): Promise<void> {
  REALM = `pkj-${newId()}`;
  REALM_ID = newId();
  AUDIENCE = `${REALM_ISSUER_BASE}/realms/${REALM}/protocol/openid-connect/token`;

  clientKey = await buildClientKey();
  inlineKey = await buildClientKey();
  strangerKey = await buildClientKey();

  await withRealm(app.db, REALM_ID, async (tx) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);

    const serviceSubject = await subjectRepository(tx).create({
      realmId: REALM_ID,
      type: 'service',
    });
    serviceSubjectId = serviceSubject.id;

    await createClient(tx, {
      clientId: 'pkj-client',
      method: 'private_key_jwt',
      jwksUri: 'https://pkj-client.example/jwks.json',
    });
    await createClient(tx, {
      clientId: 'inline-jwks-client',
      method: 'private_key_jwt',
      jwks: jwksFor(inlineKey),
    });
    await createClient(tx, {
      clientId: 'unreachable-client',
      method: 'private_key_jwt',
      jwksUri: 'https://unreachable.example/jwks.json',
    });
    await createClient(tx, {
      clientId: 'private-uri-client',
      method: 'private_key_jwt',
      jwksUri: 'https://private-uri-client.example/jwks.json',
    });
    await createClient(tx, {
      clientId: 'basic-client',
      method: 'client_secret_basic',
    });
    await createClient(tx, {
      clientId: 'no-keys-client',
      method: 'private_key_jwt',
    });
    await createClient(tx, {
      clientId: 'bad-document-client',
      method: 'private_key_jwt',
      jwksUri: 'https://bad-document.example/jwks.json',
    });
    await createClient(tx, {
      clientId: 'disabled-client',
      method: 'private_key_jwt',
      jwksUri: 'https://pkj-client.example/jwks.json',
      enabled: false,
    });

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

  await setupRealm();

  const logger: FastifyBaseLogger = pino(
    { level: 'info' },
    { write: (line: string) => logLines.push(JSON.parse(line)) },
  );

  http = Fastify({ loggerInstance: logger });
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: clientKeySet({ lookup, request, now: () => NOW, allowPrivate: false }),
      clock: { now: () => NOW },
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

beforeEach(() => {
  logLines = [];
});

function basic(clientId: string, secret: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}` };
}

async function token(input: {
  assertion?: string;
  client?: string;
  auth?: Record<string, string>;
}): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  if (input.assertion !== undefined) {
    form.set('client_assertion_type', CLIENT_ASSERTION_TYPE);
    form.set('client_assertion', input.assertion);
  }
  if (input.client !== undefined && input.auth === undefined && input.assertion === undefined) {
    form.set('client_id', input.client);
  }

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(input.auth ?? {}) },
  });
}

async function discovery(): Promise<{ token_endpoint_auth_methods_supported: string[] }> {
  const res = await http.inject({ url: `/realms/${REALM}/.well-known/openid-configuration` });
  return res.json<{ token_endpoint_auth_methods_supported: string[] }>();
}

function lastLoggedReason(): string | undefined {
  const entry = [...logLines]
    .reverse()
    .find(
      (line): line is { reason: string; msg: string } =>
        typeof line === 'object' &&
        line !== null &&
        'msg' in line &&
        line.msg === 'private_key_jwt authentication refused',
    );
  return entry?.reason;
}

describe('[ODUDU-PRIVATE-KEY-JWT-01] private_key_jwt at /token', () => {
  it('issues a token to a client that signed with a key from its jwks_uri', async () => {
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(200);
  });

  it('issues a token to a client that registered inline jwks', async () => {
    const assertion = await signAssertion(inlineKey, 'inline-jwks-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an assertion signed by a key the client does not publish', async () => {
    const assertion = await signAssertion(strangerKey, 'pkj-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('assertion signature did not verify');
  });

  it('answers the same refusal when the jwks_uri does not answer', async () => {
    const assertion = await signAssertion(clientKey, 'unreachable-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toMatch(/unreachable\.example/u);
  });

  it('cannot be used to tell a reachable jwks_uri from an unreachable one', async () => {
    const unreachableAssertion = await signAssertion(clientKey, 'unreachable-client');
    const unreachable = await token({ assertion: unreachableAssertion });

    const badSignatureAssertion = await signAssertion(strangerKey, 'pkj-client');
    const badSignature = await token({ assertion: badSignatureAssertion });

    expect(unreachable.json()).toEqual(badSignature.json());
    expect(unreachable.statusCode).toBe(badSignature.statusCode);
    // The challenge itself must not distinguish the two either — see
    // rfc7523.md's note on why it is the Basic challenge on both, not a
    // scheme-specific one.
    expect(unreachable.headers['www-authenticate']).toBe(badSignature.headers['www-authenticate']);
  });

  it("never reports the address guard's own reasoning", async () => {
    const assertion = await signAssertion(clientKey, 'private-uri-client');
    const res = await token({ assertion });
    expect(res.json()).toEqual(REFUSAL);
    expect(JSON.stringify(res.json())).not.toMatch(/loopback|private|link-local|blocked/iu);
    // The reason is real and specific — just never in the response above.
    expect(lastLoggedReason()).toMatch(/loopback/u);
  });

  it('refuses an unknown client', async () => {
    const assertion = await signAssertion(clientKey, 'no-such-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('unknown client');
  });

  it('refuses an assertion from a client not registered for private_key_jwt', async () => {
    // Signed with a key `basic-client` never published — the point is that
    // the method check refuses this before any key is ever consulted.
    const assertion = await signAssertion(clientKey, 'basic-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is not registered for private_key_jwt');
  });

  it('refuses a replayed assertion', async () => {
    const assertion = await signAssertion(clientKey, 'pkj-client');
    expect((await token({ assertion })).statusCode).toBe(200);
    const replay = await token({ assertion });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('jti already spent');
  });

  it('refuses a client_secret from a client registered for private_key_jwt', async () => {
    const res = await token({ auth: basic('pkj-client', 'secret') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
  });

  it('refuses an assertion that does not even parse as a JWT', async () => {
    const res = await token({ assertion: 'not-a-jwt-at-all' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('assertion failed structural validation');
  });

  it('refuses a client that publishes no keys at all', async () => {
    const assertion = await signAssertion(clientKey, 'no-keys-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client publishes no keys');
  });

  it('refuses a signature checked against a jwks_uri document that is not a JWK Set', async () => {
    const assertion = await signAssertion(clientKey, 'bad-document-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('assertion signature did not verify');
  });

  // C1: the operator's one revocation lever must reach a private_key_jwt
  // client too. `disabled-client` publishes the same key `pkj-client` does
  // and the assertion is genuinely, correctly signed — the only thing that
  // can be refusing this is `client.enabled`.
  it('refuses a genuinely signed assertion from a disabled client', async () => {
    const assertion = await signAssertion(clientKey, 'disabled-client');
    const res = await token({ assertion });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is disabled');
  });

  // RFC 7521 §4.2 / RFC 6749 §2.3: one authentication mechanism per
  // request. `authenticateClient` already refuses Basic-plus-body-secret;
  // this is the same rule's other edge.
  it('refuses a request presenting both an assertion and a client_secret', async () => {
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await token({ assertion, auth: basic('pkj-client', 'secret') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
  });

  it('advertises private_key_jwt in token_endpoint_auth_methods_supported', async () => {
    const doc = await discovery();
    expect(doc.token_endpoint_auth_methods_supported).toContain('private_key_jwt');
  });

  // Controller correction 1's first pin: a forged signature must never
  // spend the jti it carries, or an attacker who only guesses a client's
  // jti values — no key required — could invalidate that client's next
  // genuine request as a replay it never made.
  it('leaves a jti unspent when the signature over it does not verify', async () => {
    const jti = newId();
    const forged = await signAssertion(strangerKey, 'pkj-client', { jti });
    const forgedResult = await token({ assertion: forged });
    expect(forgedResult.statusCode).toBe(401);

    const genuine = await signAssertion(clientKey, 'pkj-client', { jti });
    const genuineResult = await token({ assertion: genuine });
    expect(genuineResult.statusCode).toBe(200);
  });

  // Controller correction 1's second pin: `claim`'s atomicity, not request
  // ordering, is what resolves two concurrent genuine replays.
  it('admits exactly one of two concurrent, identically valid assertions', async () => {
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const [first, second] = await Promise.all([token({ assertion }), token({ assertion })]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
  });
});
