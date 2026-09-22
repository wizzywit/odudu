import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

let TENANT: string;
let TENANT_ID: string;
let ISSUER: string;

const KEK = Buffer.alloc(32, 23);

// The resource server under test names itself the same way the client
// authenticating at /introspect does: `API_CLIENT_ID` is both a registered
// OAuth client_id (used to authenticate here) and the audience a separate
// client's token is minted for. `introspect`
// (packages/protocol-oidc/src/usecase/introspection.ts) entitles a caller
// through `client_id` **or** any of its own registered `audiences`; this
// fixture exercises only the `client_id` half, which is why the two
// strings have to match here.
const API_CLIENT_ID = 'api-client';
const API_CLIENT_SECRET = 'secret';
const OTHER_CLIENT_ID = 'other-client';
const OTHER_CLIENT_SECRET = 'secret';
const CALLER_CLIENT_ID = 'caller-client';
const CALLER_CLIENT_SECRET = 'caller-secret';
// Touched by no other test in this file, so its budget is still whole
// wherever the shared-limiter test reaches it.
const SHARED_LIMIT_CLIENT_ID = 'shared-limit-client';
const SHARED_LIMIT_CLIENT_SECRET = 'shared-limit-secret';

// ADR 0023's budget under test. Small on purpose, matching
// token-client-limit.int.test.ts's own reasoning: every scenario below that
// spends it does so in full, and a small number keeps the request count
// readable.
const LIMIT = 3;

// A deterministic double for ADR 0023's client-authentication limiter, not
// apps/server/src/throttle.ts's slidingWindow — see
// token-client-limit.int.test.ts's own comment on the same double for why
// count-only, with no window aging, is enough here.
function clientSecretLimiter(): ClientSecretLimiter {
  const counts = new Map<string, number>();
  return {
    check: (key) => {
      const count = counts.get(key) ?? 0;
      if (count >= LIMIT) return { allowed: false, retryAfterSeconds: 30 };
      counts.set(key, count + 1);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

async function registerClient(
  tx: TenantScopedDatabase,
  clientId: string,
  secret: string,
  opts: { audiences?: string[]; serviceSubjectId?: string } = {},
): Promise<string> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    tenantId: TENANT_ID,
    clientId,
    name: clientId,
    type: 'confidential',
    secretHash: await hashPassword(secret),
    serviceSubjectId: opts.serviceSubjectId,
  });
  await provisionClientDefaults(tx, dbId);
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    tenantId: TENANT_ID,
    redirectUris: [],
    grantTypes: ['client_credentials'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences: opts.audiences ?? [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    clientCredentialsScopes: [],
  });
  return dbId;
}

async function setupTenant(): Promise<void> {
  TENANT = `introspect-${newId()}`;
  TENANT_ID = newId();
  ISSUER = `http://localhost/tenants/${TENANT}`;

  await withTenant(app.db, TENANT_ID, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT });
    await provisionTenant(tx, TENANT_ID);

    // The resource server: authenticates at /introspect with its own
    // client_id, which is also the audience CALLER_CLIENT_ID's token below
    // is minted for.
    await registerClient(tx, API_CLIENT_ID, API_CLIENT_SECRET);

    // Authenticates at /introspect the same way, but is never named in the
    // token's `aud` — the caller with no claim to describe.
    await registerClient(tx, OTHER_CLIENT_ID, OTHER_CLIENT_SECRET);

    // Mints the token under test, via client_credentials, with `aud`
    // resolved from its own registered `audiences` — API_CLIENT_ID.
    const serviceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    await registerClient(tx, CALLER_CLIENT_ID, CALLER_CLIENT_SECRET, {
      audiences: [API_CLIENT_ID],
      serviceSubjectId: serviceSubject.id,
    });

    // Only ever authenticates with the wrong secret — proves the budget is
    // shared with /token rather than counted twice.
    await registerClient(tx, SHARED_LIMIT_CLIENT_ID, SHARED_LIMIT_CLIENT_SECRET);

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

  await setupTenant();

  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: clientSecretLimiter(),
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

function basic(clientId: string, secret: string): { clientId: string; secret: string } {
  return { clientId, secret };
}

async function introspect(opts: {
  token: string;
  auth: { clientId: string; secret: string } | null;
}): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('token', opts.token);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (opts.auth !== null) {
    headers.authorization = `Basic ${Buffer.from(`${opts.auth.clientId}:${opts.auth.secret}`).toString('base64')}`;
  }

  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token/introspect`,
    payload: form.toString(),
    headers,
  });
}

async function tokenWithSecret(clientId: string, secret: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
    },
  });
}

async function discovery(): Promise<{ introspection_endpoint: string }> {
  const res = await http.inject({ url: `/tenants/${TENANT}/.well-known/openid-configuration` });
  return res.json<{ introspection_endpoint: string }>();
}

async function mintToken(): Promise<string> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CALLER_CLIENT_ID}:${CALLER_CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

describe('[RFC7662-2.1-01] the introspection endpoint requires authorization to call it', () => {
  it('refuses an unauthenticated call with 401', async () => {
    const token = await mintToken();
    const response = await introspect({ token, auth: null });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('[RFC7662-2.2-01] a response differs by which protected resource is asking', () => {
  it('describes a token to the resource server that authenticated', async () => {
    const token = await mintToken();
    const response = await introspect({ token, auth: basic(API_CLIENT_ID, API_CLIENT_SECRET) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: true });
  });
});

describe('[RFC7662-2.2-02] an unentitled caller gets the fused active:false, nothing else', () => {
  // Pinned separately from RFC7662-2.1-01's 401: an authenticated caller
  // absent from `aud` is a fact about the token, not about who is asking,
  // so it must never collapse into invalid_client's "I do not know who you
  // are". `toEqual`, not `toMatchObject` — §2.2's SHOULD NOT forbids any
  // member beyond `active` on this path, and §2.3 forbids an error
  // response for it.
  it('answers 200 with active false to an authenticated caller with no claim to the token', async () => {
    const token = await mintToken();
    const response = await introspect({ token, auth: basic(OTHER_CLIENT_ID, OTHER_CLIENT_SECRET) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ active: false });
  });
});

describe('[RFC7662-2.2-03] a token this server never minted also gets the fused active:false', () => {
  // The third leg of the fused MUST, pinned separately from
  // RFC7662-2.2-02's caller-not-addressed case: an authenticated caller
  // presenting a token this server did not issue must not be told anything
  // different — no distinguishing status code, not even a 400 for an
  // unparseable one.
  it('answers 200 with active false for a token this server never minted', async () => {
    const response = await introspect({
      token: 'this-was-never-a-jwt',
      auth: basic(API_CLIENT_ID, API_CLIENT_SECRET),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ active: false });
  });
});

describe('[ODUDU-INTROSPECT-RATE-LIMIT-01] a client_secret guess here spends the same budget as /token', () => {
  it('rate-limits repeated bad secrets, as /token does', async () => {
    const token = await mintToken();
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      const res = await introspect({ token, auth: basic(API_CLIENT_ID, 'wrong') });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);

    const response = await introspect({ token, auth: basic(API_CLIENT_ID, 'wrong') });
    expect(response.statusCode).toBe(429);
  });

  // A second, independent counter for this endpoint would let an attacker
  // spend the budget twice, once per endpoint — proven here by spending it
  // entirely at /token and finding /introspect already refuses, for a
  // client_id neither test above has touched. A fresh limiter local to this
  // route would still answer 401 to the first attempt below.
  it('shares its budget with /token, not a second counter of its own', async () => {
    const token = await mintToken();
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await tokenWithSecret(SHARED_LIMIT_CLIENT_ID, 'wrong');
      expect(res.statusCode).toBe(401);
    }

    const response = await introspect({ token, auth: basic(SHARED_LIMIT_CLIENT_ID, 'wrong') });
    expect(response.statusCode).toBe(429);
  });
});

describe('[ODUDU-INTROSPECT-NO-STORE-01] the response carries no-store', () => {
  it('answers no-store', async () => {
    const token = await mintToken();
    const response = await introspect({ token, auth: basic(API_CLIENT_ID, API_CLIENT_SECRET) });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('[ODUDU-INTROSPECT-DISCOVERY-01] the endpoint is advertised in discovery', () => {
  it('advertises the endpoint in discovery', async () => {
    expect((await discovery()).introspection_endpoint).toBe(
      `${ISSUER}/protocol/openid-connect/token/introspect`,
    );
  });
});
