import { PRIVATE_JWK_MEMBERS, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const PUBLIC_JWK = { kty: 'RSA', n: 'n-value', e: 'AQAB' };

async function seedRealm(
  tx: RealmScopedDatabase,
  id: string,
  opts: { name: string; enabled?: boolean },
): Promise<void> {
  await tx.insert(realms).values({ id, name: opts.name, enabled: opts.enabled ?? true });
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

  const acmeId = newId();
  await withRealm(app.db, acmeId, async (tx) => {
    await seedRealm(tx, acmeId, { name: 'acme' });
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId: acmeId,
      kid: 'k1',
      alg: 'RS256',
      status: 'active',
      publicJwk: PUBLIC_JWK,
      privateJwkEncrypted: 'ciphertext-placeholder',
    });
  });

  const disabledId = newId();
  await withRealm(app.db, disabledId, async (tx) => {
    await seedRealm(tx, disabledId, { name: 'disabled-realm', enabled: false });
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[OIDC-DISCOVERY-3-02] unknown and disabled realms are indistinguishable', () => {
  it.each(['no-such-realm', 'disabled-realm'])('returns 404 for %s', async (realm) => {
    const res = await http.inject({ url: `/realms/${realm}/.well-known/openid-configuration` });
    expect(res.statusCode).toBe(404);
  });
});

describe('[OIDC-DISCOVERY-4-01] the discovery document is served at the well-known path', () => {
  it('returns 200 with application/json for an enabled realm', async () => {
    const res = await http.inject({ url: '/realms/acme/.well-known/openid-configuration' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json<{ issuer: string }>().issuer).toMatch(/\/realms\/acme$/);
  });

  it('rejects a POST to the discovery path', async () => {
    const res = await http.inject({
      method: 'POST',
      url: '/realms/acme/.well-known/openid-configuration',
    });
    expect(res.statusCode).not.toBe(200);
  });
});

describe('[RFC7517-4-02] the published key set carries no private material', () => {
  it('never emits a private or symmetric member', async () => {
    const res = await http.inject({ url: '/realms/acme/protocol/openid-connect/certs' });
    expect(res.statusCode).toBe(200);
    for (const key of res.json<{ keys: Record<string, unknown>[] }>().keys) {
      for (const member of PRIVATE_JWK_MEMBERS) {
        expect(key).not.toHaveProperty(member);
      }
    }
  });

  it('returns 404 for an unknown realm rather than an empty key set', async () => {
    const res = await http.inject({ url: '/realms/no-such-realm/protocol/openid-connect/certs' });
    expect(res.statusCode).toBe(404);
  });
});
