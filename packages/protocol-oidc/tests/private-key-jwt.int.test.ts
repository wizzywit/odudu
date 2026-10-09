import formbody from '@fastify/formbody';
import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys, type SigningKeyRecord } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import { clientRepository, clients } from '@odudu/domain-tenant';
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
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import {
  buildClientSigningKey,
  jwksDocumentFor,
  signClientAssertion,
} from '#/testing/private-key-jwt-fixture';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let appUrlForPools = '';
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 13);
// The wall clock, not a fixed instant: /revoke reads an access token's own
// signature and expiry, which jose checks against the real time.
const NOW = new Date();

// The Host `http.inject` sends when a request names none — `view/issuer.ts`
// derives the audience an assertion must carry from exactly this, so the
// fixture computes it the same way rather than asserting a literal.
const TENANT_ISSUER_BASE = 'http://localhost';

let TENANT: string;
let TENANT_ID: string;
let AUDIENCE: string;
// A second, otherwise-empty tenant — enough to answer at `/token` without
// 404ing, never enough to hold a client `pkj-client`'s assertion could
// possibly resolve against.
let TENANT_B: string;
let TENANT_B_ID: string;

// This suite's whole point: every refusal is this one body, whatever
// failed, of the eight branches `authenticatePrivateKeyJwt` has — see
// docs/protocols/rfc7523.md's "One refusal, not several" for the list,
// re-derived from the code rather than copied stale.
const REFUSAL = { error: 'invalid_client' };

let logLines: unknown[] = [];

function buildClientKey(): Promise<SigningKeyRecord> {
  return buildClientSigningKey(KEK, TENANT_ID);
}

function jwksFor(key: SigningKeyRecord): { keys: Record<string, unknown>[] } {
  return jwksDocumentFor(key);
}

function signAssertion(
  key: SigningKeyRecord,
  clientId: string,
  overrides: { jti?: string; aud?: string; exp?: number; iss?: string; sub?: string } = {},
): Promise<string> {
  return signClientAssertion({
    key,
    clientId,
    audience: AUDIENCE,
    kek: KEK,
    now: NOW,
    ...overrides,
  });
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
  tx: TenantScopedDatabase,
  input: {
    clientId: string;
    method: 'private_key_jwt' | 'client_secret_basic';
    jwks?: unknown;
    jwksUri?: string;
    enabled?: boolean;
    grantTypes?: string[];
    redirectUris?: string[];
  },
): Promise<void> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    tenantId: TENANT_ID,
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
    tenantId: TENANT_ID,
    redirectUris: input.redirectUris ?? [],
    grantTypes: input.grantTypes ?? ['client_credentials'],
    tokenEndpointAuthMethod: input.method,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    jwks: input.jwks ?? null,
    jwksUri: input.jwksUri ?? null,
  });
}

async function setupTenant(): Promise<void> {
  TENANT = `pkj-${newId()}`;
  TENANT_ID = newId();
  AUDIENCE = `${TENANT_ISSUER_BASE}/tenants/${TENANT}/protocol/openid-connect/token`;

  clientKey = await buildClientKey();
  inlineKey = await buildClientKey();
  strangerKey = await buildClientKey();

  await withTenant(app.db, TENANT_ID, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT });
    await provisionTenant(tx, TENANT_ID);

    const serviceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    serviceSubjectId = serviceSubject.id;

    await createClient(tx, {
      clientId: 'pkj-client',
      method: 'private_key_jwt',
      jwksUri: 'https://pkj-client.example/jwks.json',
    });
    await createClient(tx, {
      clientId: 'refresh-client',
      method: 'private_key_jwt',
      jwks: jwksFor(inlineKey),
      grantTypes: ['client_credentials', 'refresh_token'],
      redirectUris: ['https://app.example/cb'],
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
      tenantId: TENANT_ID,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });

  TENANT_B = `pkj-b-${newId()}`;
  TENANT_B_ID = newId();
  await withTenant(app.db, TENANT_B_ID, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_B_ID, name: TENANT_B });
    await provisionTenant(tx, TENANT_B_ID);

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: TENANT_B_ID,
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
  appUrlForPools = appUrl;
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;

  await setupTenant();

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
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
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
  tenant?: string;
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
    url: `/tenants/${input.tenant ?? TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(input.auth ?? {}) },
  });
}

async function discovery(): Promise<{ token_endpoint_auth_methods_supported: string[] }> {
  const res = await http.inject({ url: `/tenants/${TENANT}/.well-known/openid-configuration` });
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

  // Every non-`unsupported` outcome runs through `authenticatePrivateKeyJwt`
  // scoped to the tenant the request named — `byClientId` is read inside
  // `withTenant(tenant.id, …)`, RLS-enforced — and `aud` embeds that tenant's
  // name via its issuer, so an assertion minted for TENANT can never even
  // parse as valid for TENANT_B: `aud` cannot match. That is what this pins.
  it("refuses TENANT's assertion posted to a different tenant's /token", async () => {
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await token({ assertion, tenant: TENANT_B });
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
    // This refusal sits upstream of authenticatePrivateKeyJwt's eight, but
    // shares its logging closure — it must not be the one that logs nothing.
    expect(lastLoggedReason()).toBe('assertion presented alongside a client_secret');
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

async function postForm(
  endpoint: 'revoke' | 'token/introspect',
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/${endpoint}`,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function withAssertion(assertion: string, fields: Record<string, string>): Record<string, string> {
  return { ...fields, client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: assertion };
}

async function issuedAccessToken(): Promise<string> {
  const res = await token({ assertion: await signAssertion(clientKey, 'pkj-client') });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

async function isRevoked(accessToken: string): Promise<boolean> {
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { grant_id: string };
  return withTenant(app.db, TENANT_ID, async (tx) => {
    const grant = await tokenGrantRepository(tx).byId(payload.grant_id);
    return grant?.revokedAt != null;
  });
}

describe('[ODUDU-PRIVATE-KEY-JWT-02] private_key_jwt at /revoke and /introspect', () => {
  it('revokes a token for a client that presents a valid assertion', async () => {
    const accessToken = await issuedAccessToken();
    expect(await isRevoked(accessToken)).toBe(false);

    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await postForm('revoke', withAssertion(assertion, { token: accessToken }));
    expect(res.statusCode).toBe(200);
    expect(await isRevoked(accessToken)).toBe(true);
  });

  it('refuses a revocation that presents no client authentication', async () => {
    const accessToken = await issuedAccessToken();
    const res = await postForm('revoke', { token: accessToken, client_id: 'pkj-client' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(await isRevoked(accessToken)).toBe(false);
  });

  it('refuses a revocation signed by a key the client does not publish', async () => {
    const accessToken = await issuedAccessToken();
    const forged = await signAssertion(strangerKey, 'pkj-client');
    const res = await postForm('revoke', withAssertion(forged, { token: accessToken }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(await isRevoked(accessToken)).toBe(false);
  });

  it('refuses a revocation whose assertion names another audience', async () => {
    const accessToken = await issuedAccessToken();
    const wrong = await signAssertion(clientKey, 'pkj-client', {
      aud: `${TENANT_ISSUER_BASE}/tenants/${TENANT_B}/protocol/openid-connect/token`,
    });
    const res = await postForm('revoke', withAssertion(wrong, { token: accessToken }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(await isRevoked(accessToken)).toBe(false);
  });

  it('refuses an assertion already spent at the token endpoint', async () => {
    const accessToken = await issuedAccessToken();
    const assertion = await signAssertion(clientKey, 'pkj-client');
    expect((await token({ assertion })).statusCode).toBe(200);
    const res = await postForm('revoke', withAssertion(assertion, { token: accessToken }));
    expect(res.statusCode).toBe(401);
    expect(await isRevoked(accessToken)).toBe(false);
  });

  it('refuses an assertion alongside a client_secret', async () => {
    const accessToken = await issuedAccessToken();
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await postForm(
      'revoke',
      withAssertion(assertion, { token: accessToken, client_secret: 'whatever' }),
    );
    expect(res.statusCode).toBe(401);
    expect(await isRevoked(accessToken)).toBe(false);
  });

  it('answers an introspection that presents a valid assertion', async () => {
    const accessToken = await issuedAccessToken();
    const assertion = await signAssertion(clientKey, 'pkj-client');
    const res = await postForm(
      'token/introspect',
      withAssertion(assertion, { token: accessToken }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('active');
  });

  it('answers the introspection of an unauthenticated caller with the same refusal', async () => {
    const accessToken = await issuedAccessToken();
    const res = await postForm('token/introspect', {
      token: accessToken,
      client_id: 'pkj-client',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
  });

  it('advertises private_key_jwt for introspection and revocation', async () => {
    const res = await http.inject({ url: `/tenants/${TENANT}/.well-known/openid-configuration` });
    const doc = res.json<{
      introspection_endpoint_auth_methods_supported: string[];
      revocation_endpoint_auth_methods_supported: string[];
    }>();
    expect(doc.introspection_endpoint_auth_methods_supported).toContain('private_key_jwt');
    expect(doc.revocation_endpoint_auth_methods_supported).toContain('private_key_jwt');
  });
});

describe('[ODUDU-PRIVATE-KEY-JWT-03] a pool no larger than the requests in flight', () => {
  // Each request holds a connection for its transaction; a jti claimed on a
  // connection of its own would need a second, and N requests on N
  // connections would all wait for it.
  it.each([2, 3])(
    'serves %i concurrent assertions on a pool of that many connections',
    async (size) => {
      const small = createDatabase(appUrlForPools, { max: size });
      const server = Fastify();
      await server.register(formbody);
      await server.register(
        oidcRoutes({
          database: small,
          ownerDatabase: owner,
          kek: KEK,
          clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
          auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
          clientKeySet: clientKeySet({ lookup, request, now: () => NOW, allowPrivate: false }),
          clock: { now: () => NOW },
        }),
      );
      await server.ready();
      try {
        const assertions = await Promise.all(
          Array.from({ length: size }, () => signAssertion(inlineKey, 'inline-jwks-client')),
        );
        const answers = await Promise.race([
          Promise.all(
            assertions.map((assertion) =>
              server.inject({
                method: 'POST',
                url: `/tenants/${TENANT}/protocol/openid-connect/token`,
                payload: new URLSearchParams({
                  grant_type: 'client_credentials',
                  client_assertion_type: CLIENT_ASSERTION_TYPE,
                  client_assertion: assertion,
                }).toString(),
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
              }),
            ),
          ),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('the pool is exhausted: requests are waiting for a connection'));
            }, 8000);
          }),
        ]);
        expect(answers.map((answer) => answer.statusCode)).toEqual(Array(size).fill(200));
      } finally {
        await server.close();
        await small.close();
      }
    },
  );
});

async function bareServer(
  size: number,
): Promise<{ server: FastifyInstance; close: () => Promise<void> }> {
  const small = createDatabase(appUrlForPools, { max: size });
  const server = Fastify();
  await server.register(formbody);
  await server.register(
    oidcRoutes({
      database: small,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: clientKeySet({ lookup, request, now: () => NOW, allowPrivate: false }),
      clock: { now: () => NOW },
    }),
  );
  await server.ready();
  return {
    server,
    close: async () => {
      await server.close();
      await small.close();
    },
  };
}

function tokenForm(
  assertion: string,
  extra: Record<string, string> = {},
): { method: 'POST'; url: string; payload: string; headers: Record<string, string> } {
  return {
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: assertion,
      ...extra,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

async function spentJtis(jti: string): Promise<number> {
  const rows = await owner.sql<{ n: string }[]>`
    select count(*)::text as n from client_assertion_jti where jti = ${jti}`;
  return Number(rows[0]?.n ?? '0');
}

describe('[ODUDU-PRIVATE-KEY-JWT-04] a jti is never waited on', () => {
  it.each([1, 2, 3, 4, 5])(
    'refuses a concurrent replay while the other use is refused after authentication (round %i)',
    async () => {
      const jti = newId();
      const assertion = await signAssertion(inlineKey, 'inline-jwks-client', { jti });
      // Both ask for a scope the client may not have, so whichever authenticates
      // fails afterwards. Exactly one may get that far: the other is a replay.
      const answers = await Promise.all([
        http.inject(tokenForm(assertion, { scope: 'not-a-scope-this-client-has' })),
        http.inject(tokenForm(assertion, { scope: 'not-a-scope-this-client-has' })),
      ]);
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([400, 401]);
      expect(await spentJtis(jti)).toBe(1);
    },
  );

  it('leaves the jti spent after a request that failed after authentication', async () => {
    const jti = newId();
    const assertion = await signAssertion(inlineKey, 'inline-jwks-client', { jti });
    const first = await http.inject(tokenForm(assertion, { scope: 'not-a-scope-this-client-has' }));
    expect(first.statusCode).toBeGreaterThanOrEqual(400);
    expect(first.statusCode).not.toBe(401);
    expect((await http.inject(tokenForm(assertion))).statusCode).toBe(401);
    expect(await spentJtis(jti)).toBe(1);
  });

  it('survives its own spending failing: the refusal is still answered', async () => {
    const jti = `poison-${newId()}`;
    await owner.sql`
      create or replace function reject_poisoned_jti() returns trigger language plpgsql as $$
      begin
        if new.jti like 'poison-%' then raise exception 'jti store unavailable'; end if;
        return new;
      end $$`;
    await owner.sql`create trigger reject_poisoned_jti before insert on client_assertion_jti
      for each row execute function reject_poisoned_jti()`;
    try {
      const assertion = await signAssertion(inlineKey, 'inline-jwks-client', { jti });
      const res = await http.inject(tokenForm(assertion, { scope: 'not-a-scope-this-client-has' }));
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_scope');
    } finally {
      await owner.sql`drop trigger reject_poisoned_jti on client_assertion_jti`;
    }
  });

  it('refuses N+1 replays of one assertion on a pool of N without hanging, beside a refresh', async () => {
    const size = 3;
    const { server, close } = await bareServer(size);
    try {
      const refresh = await withTenant(app.db, TENANT_ID, async (tx) => {
        const client = await clientRepository(tx).byClientId('refresh-client');
        if (client === null) throw new Error('no refresh-client');
        const grant = await tokenGrantRepository(tx).create({
          id: newId(),
          tenantId: TENANT_ID,
          clientId: client.id,
          subjectId: serviceSubjectId,
          scope: '',
          audience: [],
        });
        const token = generateRefreshToken();
        await refreshTokenRepository(tx).create({
          tokenHash: hashRefreshToken(token),
          tenantId: TENANT_ID,
          grantId: grant.id,
          expiresAt: new Date(NOW.getTime() + 1_209_600_000),
        });
        return token;
      });
      const replayed = await signAssertion(inlineKey, 'inline-jwks-client', { jti: newId() });
      const refreshAssertion = await signAssertion(inlineKey, 'refresh-client');
      const calls = [
        ...Array.from({ length: size + 1 }, () => server.inject(tokenForm(replayed))),
        server.inject(
          tokenForm(refreshAssertion, { grant_type: 'refresh_token', refresh_token: refresh }),
        ),
      ];
      const answers = await Promise.race([
        Promise.all(calls),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('requests are waiting: the pool is starved'));
          }, 8000);
        }),
      ]);
      const replays = answers.slice(0, size + 1).map((answer) => answer.statusCode);
      expect(replays.filter((status) => status === 200)).toHaveLength(1);
      expect(replays.filter((status) => status === 401)).toHaveLength(size);
      expect(answers[size + 1]?.statusCode).toBe(200);
    } finally {
      await close();
    }
  });
});

describe('[ODUDU-PRIVATE-KEY-JWT-05] what an assertion must agree with', () => {
  it('refuses a body client_id that names another client than the assertion', async () => {
    const assertion = await signAssertion(inlineKey, 'inline-jwks-client');
    const res = await http.inject(tokenForm(assertion, { client_id: 'pkj-client' }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client_id does not match the assertion');
  });

  it('accepts a body client_id that names the assertion’s own client', async () => {
    const assertion = await signAssertion(inlineKey, 'inline-jwks-client');
    const res = await http.inject(tokenForm(assertion, { client_id: 'inline-jwks-client' }));
    expect(res.statusCode).toBe(200);
  });

  it('allows no clock leeway: an assertion that expired a second ago is refused', async () => {
    const assertion = await signAssertion(inlineKey, 'inline-jwks-client', {
      exp: Math.floor(NOW.getTime() / 1000) - 1,
    });
    expect((await http.inject(tokenForm(assertion))).statusCode).toBe(401);
  });

  it('allows no clock leeway at the far end: a lifetime of 301 s is refused, 300 s accepted', async () => {
    const base = Math.floor(NOW.getTime() / 1000);
    const tooLong = await signAssertion(inlineKey, 'inline-jwks-client', { exp: base + 301 });
    const longest = await signAssertion(inlineKey, 'inline-jwks-client', { exp: base + 300 });
    expect((await http.inject(tokenForm(tooLong))).statusCode).toBe(401);
    expect((await http.inject(tokenForm(longest))).statusCode).toBe(200);
  });
});
