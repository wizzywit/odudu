import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
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

let REALM: string;
let REALM_ID: string;

const KEK = Buffer.alloc(32, 19);

// The budget under test. Small on purpose: every scenario below spends it
// in full, and a small number keeps each test's request count readable.
const LIMIT = 3;

// A deterministic double for ADR 0023's client-authentication limiter —
// not `apps/server/src/throttle.ts`'s `slidingWindow`, which that package
// does not export across the workspace boundary this suite runs outside
// of. Count-only (no window aging) is enough: what is under test is which
// calls `authenticateClient` makes into `check`, not the sliding-window
// arithmetic `apps/server/src/throttle.test.ts` already covers.
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

async function setupRealm(): Promise<void> {
  REALM = `token-client-limit-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
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

async function withSecret(clientId: string, secret: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
    },
  });
}

describe('[RFC6749-2.3.1-04] the client_secret budget at /token', () => {
  it('refuses further client_secret attempts once the budget is spent', async () => {
    const clientId = `budget-spent-${newId()}`;
    const secret = 'correct-horse-a';
    await registerFreshClient(clientId, secret);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < LIMIT + 1; attempt += 1) {
      const res = await withSecret(clientId, 'wrong-secret');
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
    const refused = await withSecret(clientId, 'wrong-secret');
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect(refused.body).toBe('');
  });

  // What this would still pass under: a build that calls `check` on every
  // attempt, success included, but happens to keep the loop below the
  // budget. LIMIT + 5 successes is deliberately more requests than the
  // budget holds, so counting every attempt — not just failures — would
  // have started refusing partway through this loop.
  it('does not count a successful authentication', async () => {
    const clientId = `healthy-${newId()}`;
    const secret = 'correct-horse-a';
    await registerFreshClient(clientId, secret);

    for (let attempt = 0; attempt < LIMIT + 5; attempt += 1) {
      const res = await withSecret(clientId, secret);
      expect(res.statusCode).toBe(200);
    }
  });

  // What this would still pass under: an implementation that skips the
  // client lookup on a wrong secret but still performs it for an unknown
  // client_id (or vice versa) — the assertion is on the two response
  // sequences and bodies together, not on either alone.
  it('counts an unknown client_id the same as a wrong secret', async () => {
    const knownClientId = `known-${newId()}`;
    await registerFreshClient(knownClientId, 'correct-horse-a');
    const unknownClientId = `unknown-${newId()}`;

    const wrongSecretStatuses: number[] = [];
    let wrongSecretFourth: LightMyRequestResponse | undefined;
    for (let attempt = 0; attempt < LIMIT + 1; attempt += 1) {
      const res = await withSecret(knownClientId, 'wrong-secret');
      wrongSecretStatuses.push(res.statusCode);
      wrongSecretFourth = res;
    }

    const unknownClientStatuses: number[] = [];
    let unknownClientFourth: LightMyRequestResponse | undefined;
    for (let attempt = 0; attempt < LIMIT + 1; attempt += 1) {
      const res = await withSecret(unknownClientId, 'anything');
      unknownClientStatuses.push(res.statusCode);
      unknownClientFourth = res;
    }

    expect(wrongSecretStatuses).toEqual([401, 401, 401, 429]);
    expect(unknownClientStatuses).toEqual([401, 401, 401, 429]);
    expect(unknownClientFourth?.body).toBe(wrongSecretFourth?.body);
    expect(unknownClientFourth?.statusCode).toBe(wrongSecretFourth?.statusCode);
  });

  it('throttles one client without throttling another', async () => {
    const throttled = `throttled-${newId()}`;
    const untouched = `untouched-${newId()}`;
    await registerFreshClient(throttled, 'correct-horse-a');
    await registerFreshClient(untouched, 'correct-horse-b');

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await withSecret(throttled, 'wrong-secret');
    }
    const exhausted = await withSecret(throttled, 'wrong-secret');
    expect(exhausted.statusCode).toBe(429);

    const other = await withSecret(untouched, 'wrong-secret');
    expect(other.statusCode).toBe(401);
  });
});

// A client of its own per scenario, so one test's spent budget (keyed by
// client_id) cannot leak into another's. Provisioned with a service subject
// so the client_credentials grant a healthy request exercises can actually
// succeed, not just authenticate.
async function registerFreshClient(clientId: string, secret: string): Promise<void> {
  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    const serviceSubject = await subjectRepository(tx).create({
      realmId: REALM_ID,
      type: 'service',
    });
    const clientDbId = newId();
    await tx.insert(clients).values({
      id: clientDbId,
      realmId: REALM_ID,
      clientId,
      name: clientId,
      type: 'confidential',
      secretHash: await hashPassword(secret),
      serviceSubjectId: serviceSubject.id,
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId: REALM_ID,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [],
    });
  });
}
