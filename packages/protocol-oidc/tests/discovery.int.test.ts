import { PRIVATE_JWK_MEMBERS, signingKeys } from '@odudu/crypto';
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
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const PUBLIC_JWK = { kty: 'RSA', n: 'n-value', e: 'AQAB' };

async function seedTenant(
  tx: TenantScopedDatabase,
  id: string,
  opts: { name: string; enabled?: boolean },
): Promise<void> {
  await tx.insert(tenants).values({ id, name: opts.name, enabled: opts.enabled ?? true });
  await provisionTenant(tx, id);
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
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 7),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();

  const acmeId = newId();
  await withTenant(app.db, acmeId, async (tx) => {
    await seedTenant(tx, acmeId, { name: 'acme' });
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: acmeId,
      kid: 'k1',
      alg: 'RS256',
      status: 'active',
      publicJwk: PUBLIC_JWK,
      privateJwkEncrypted: 'ciphertext-placeholder',
    });
  });

  const disabledId = newId();
  await withTenant(app.db, disabledId, async (tx) => {
    await seedTenant(tx, disabledId, { name: 'disabled-tenant', enabled: false });
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: disabledId,
      kid: 'disabled-k1',
      alg: 'RS256',
      status: 'active',
      publicJwk: PUBLIC_JWK,
      privateJwkEncrypted: 'ciphertext-placeholder',
    });
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-DISCOVERY-TENANT-404-01] an unknown tenant has no discovery document', () => {
  it('returns 404 for a tenant that does not exist', async () => {
    const res = await http.inject({
      url: '/tenants/no-such-tenant/.well-known/openid-configuration',
    });
    expect(res.statusCode).toBe(404);
  });
});

// A disabled tenant's relying parties still have queued Logout Tokens to
// validate (Back-Channel Logout 1.0 §2.6), signed with its keys; public keys
// and the document naming them are not secret. Everything else is refused.
describe('[ODUDU-DISCOVERY-TENANT-DISABLED-01] a disabled tenant still publishes its keys', () => {
  it('serves discovery and the key set', async () => {
    const discovery = await http.inject({
      url: '/tenants/disabled-tenant/.well-known/openid-configuration',
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json<{ issuer: string }>().issuer).toMatch(/\/tenants\/disabled-tenant$/);

    const certs = await http.inject({
      url: '/tenants/disabled-tenant/protocol/openid-connect/certs',
    });
    expect(certs.statusCode).toBe(200);
    expect(certs.json<{ keys: { kid: string }[] }>().keys.map((key) => key.kid)).toEqual([
      'disabled-k1',
    ]);
  });

  it('refuses every other protocol request as an unknown tenant is refused', async () => {
    for (const tenant of ['disabled-tenant', 'no-such-tenant']) {
      const base = `/tenants/${tenant}/protocol/openid-connect`;
      const token = await http.inject({ url: `${base}/token` });
      const userinfo = await http.inject({ url: `${base}/userinfo` });
      const auth = await http.inject({ url: `${base}/auth?client_id=anyone` });
      expect([tenant, token.statusCode, userinfo.statusCode, auth.statusCode]).toEqual([
        tenant,
        404,
        404,
        400,
      ]);
      expect(auth.body).toContain('Unknown or disabled client');
    }
  });
});

describe('[OIDC-DISCOVERY-4-01] the discovery document is served at the well-known path', () => {
  it('returns 200 with application/json for an enabled tenant', async () => {
    const res = await http.inject({ url: '/tenants/acme/.well-known/openid-configuration' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json<{ issuer: string }>().issuer).toMatch(/\/tenants\/acme$/);
  });

  it('rejects a POST to the discovery path', async () => {
    const res = await http.inject({
      method: 'POST',
      url: '/tenants/acme/.well-known/openid-configuration',
    });
    expect(res.statusCode).not.toBe(200);
  });
});

describe('[OIDC-RPINITIATED-2.1-01] end_session_endpoint is advertised', () => {
  it("names this tenant's logout endpoint", async () => {
    const res = await http.inject({ url: '/tenants/acme/.well-known/openid-configuration' });
    expect(res.json<{ end_session_endpoint: string }>().end_session_endpoint).toBe(
      'http://localhost/tenants/acme/protocol/openid-connect/logout',
    );
  });

  // The path is spelled independently in the discovery document
  // (`@odudu/contracts`' discoveryDocument) and in the router
  // (view/routes/logout.ts's own PATH) — nothing else keeps the two in
  // agreement, so a rename on one side would otherwise advertise a 404
  // with every other test still green.
  it('is a path the router actually answers, not a 404', async () => {
    const discovery = await http.inject({ url: '/tenants/acme/.well-known/openid-configuration' });
    const { end_session_endpoint: endSessionEndpoint } = discovery.json<{
      end_session_endpoint: string;
    }>();
    const res = await http.inject({ url: new URL(endSessionEndpoint).pathname });
    expect(res.statusCode).not.toBe(404);
  });
});

describe('[OIDC-BACKCHANNEL-2.1-02] back-channel logout is advertised', () => {
  it('advertises support, with session support', async () => {
    const res = await http.inject({ url: '/tenants/acme/.well-known/openid-configuration' });
    const document = res.json<{
      backchannel_logout_supported: boolean;
      backchannel_logout_session_supported: boolean;
    }>();
    expect(document.backchannel_logout_supported).toBe(true);
    expect(document.backchannel_logout_session_supported).toBe(true);
  });
});

describe('[OIDC-FRONTCHANNEL-3-01] front-channel logout is advertised', () => {
  it('advertises support, with session support', async () => {
    const res = await http.inject({ url: '/tenants/acme/.well-known/openid-configuration' });
    const document = res.json<{
      frontchannel_logout_supported: boolean;
      frontchannel_logout_session_supported: boolean;
    }>();
    expect(document.frontchannel_logout_supported).toBe(true);
    expect(document.frontchannel_logout_session_supported).toBe(true);
  });
});

describe('[RFC7517-4-02] the published key set carries no private material', () => {
  it('never emits a private or symmetric member', async () => {
    const res = await http.inject({ url: '/tenants/acme/protocol/openid-connect/certs' });
    expect(res.statusCode).toBe(200);
    for (const key of res.json<{ keys: Record<string, unknown>[] }>().keys) {
      for (const member of PRIVATE_JWK_MEMBERS) {
        expect(key).not.toHaveProperty(member);
      }
    }
  });

  it('returns 404 for an unknown tenant rather than an empty key set', async () => {
    const res = await http.inject({ url: '/tenants/no-such-tenant/protocol/openid-connect/certs' });
    expect(res.statusCode).toBe(404);
  });
});
