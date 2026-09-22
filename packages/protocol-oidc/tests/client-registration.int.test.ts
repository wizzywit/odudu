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
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { clientRegistrationTokenRepository, clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const URL_FOR = (tenant: string) => `/tenants/${tenant}/clients-registrations/openid-connect`;
const MINIMAL = { redirect_uris: ['https://rp.example/cb'] };
const KEK = Buffer.alloc(32, 7);

async function seedTenant(
  tx: TenantScopedDatabase,
  id: string,
  opts: { name: string; policy?: 'disabled' | 'open' | 'token'; maxClients?: number } = {
    name: id,
  },
): Promise<void> {
  await tx.insert(tenants).values({ id, name: opts.name });
  await provisionTenant(tx, id);
  if (opts.policy !== undefined || opts.maxClients !== undefined) {
    await tx
      .update(tenants)
      .set({
        ...(opts.policy === undefined ? {} : { clientRegistrationPolicy: opts.policy }),
        ...(opts.maxClients === undefined ? {} : { maxClients: opts.maxClients }),
      })
      .where(eq(tenants.id, id));
  }
}

async function mintToken(tenantId: string, uses = 1, ttlSeconds = 3600): Promise<string> {
  const { token } = await withTenant(app.db, tenantId, (tx) =>
    clientRegistrationTokenRepository(tx).mint({ tenantId, uses, ttlSeconds }),
  );
  return token;
}

async function discovery(tenant: string): Promise<Record<string, unknown>> {
  const res = await http.inject({ url: `/tenants/${tenant}/.well-known/openid-configuration` });
  return res.json<Record<string, unknown>>();
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 10 });
  app = appHandle;

  http = Fastify();
  httpApp = http;
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
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-CLIENT-REGISTRATION-DISABLED-01] a tenant that has not opened registration', () => {
  it('refuses registration with 404', async () => {
    const tenantName = `closed-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId, { name: tenantName }));

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(404);
  });

  it('omits registration_endpoint from discovery', async () => {
    const tenantName = `closed-disc-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId, { name: tenantName }));

    const doc = await discovery(tenantName);
    expect(doc).not.toHaveProperty('registration_endpoint');
  });

  it('answers 404 for an unknown tenant the same way', async () => {
    const res = await http.inject({
      method: 'POST',
      url: URL_FOR('no-such-tenant'),
      payload: MINIMAL,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-OPEN-01] the open policy', () => {
  it('registers a client, assigns its id, and advertises registration_endpoint', async () => {
    const tenantName = `open-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const doc = await discovery(tenantName);
    expect(doc.registration_endpoint).toBe(
      `http://localhost/tenants/${tenantName}/clients-registrations/openid-connect`,
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ client_id: string; client_id_issued_at: number }>();
    expect(body.client_id).toBeTruthy();
    expect(body.client_id_issued_at).toBeGreaterThan(0);
  });

  // Discriminates from a version that only refuses a proposed client_id at
  // the metadata layer without wiring that refusal through the endpoint —
  // route-existence for the 400 case, distinct from the 404 a missing route
  // would also answer.
  it('never echoes a proposed client_id, and refuses the request instead', async () => {
    const tenantName = `open-propose-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, client_id: 'i-picked-this' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  it('marks an anonymous registration as requiring consent, with origin anonymous', async () => {
    const tenantName = `open-anon-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      expect(row?.registrationOrigin).toBe('anonymous');
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.consentRequired).toBe(true);
    });
  });

  it('a token still registers under the open policy, with origin token and no default consent', async () => {
    const tenantName = `open-token-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );
    const token = await mintToken(tenantId);

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      expect(row?.registrationOrigin).toBe('token');
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.consentRequired).toBe(false);
    });
  });

  it('a public client (token_endpoint_auth_method none) is issued no secret', async () => {
    const tenantName = `open-public-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, token_endpoint_auth_method: 'none' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty('client_secret');
    expect(body).not.toHaveProperty('client_secret_expires_at');
  });

  it('a confidential client is issued a secret once, hashed at rest', async () => {
    const tenantName = `open-conf-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      client_id: string;
      client_secret: string;
      client_secret_expires_at: number;
    }>();
    expect(typeof body.client_secret).toBe('string');
    expect(body.client_secret_expires_at).toBe(0);

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, body.client_id));
      expect(row?.secretHash).not.toBe(body.client_secret);
      expect(row?.secretHash).toBeTruthy();
    });
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-TOKEN-01] the token policy', () => {
  it('refuses an unauthenticated registration with 401 and a Bearer challenge', async () => {
    const tenantName = `token-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'token' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/u);
  });

  it('refuses a spent or foreign token the same way', async () => {
    const tenantName = `token-bad-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'token' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: MINIMAL,
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('registers with a valid token, consuming it', async () => {
    const tenantName = `token-ok-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'token' }),
    );
    const token = await mintToken(tenantId, 1);

    const first = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(201);

    // The same token, presented again, is a single-use credential already
    // spent — discriminates from a check that only looks at expiry.
    const second = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(401);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-CAP-01] the tenant client cap', () => {
  it('refuses once the tenant is at its client cap', async () => {
    const tenantName = `cap-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open', maxClients: 0 }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // What would this test still pass under? A bare COUNT-then-INSERT (no
  // lock) also serialises correctly if the two requests happen to run one
  // after the other — the assertion below only discriminates from that
  // implementation because both requests are put in flight before either
  // can have completed (Promise.all over two separate `inject` calls, each
  // its own transaction), so a version without the FOR UPDATE lock can
  // observe the cap as not-yet-reached in both and let both through.
  it('does not let two concurrent registrations exceed the cap', async () => {
    const tenantName = `cap-race-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open', maxClients: 1 }),
    );

    const [first, second] = await Promise.all([
      http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL }),
      http.inject({ method: 'POST', url: URL_FOR(tenantName), payload: MINIMAL }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 403]);

    const count = await withTenant(app.db, tenantId, async (tx) =>
      tx.select().from(clients).where(eq(clients.tenantId, tenantId)),
    );
    expect(count.length).toBe(1);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-SEAM-01] the P3a/P3b seam, now closed', () => {
  // `backchannel_logout_uri`, `userinfo_signed_response_alg` and
  // `userinfo_encrypted_response_alg`/`_enc` are all stored, read and
  // advertised in discovery (`/userinfo` signs and encrypts — see
  // `userinfo-signed.int.test.ts` and `userinfo-encrypted.int.test.ts`).
  it('advertises signing and encryption, and stores both', async () => {
    const tenantName = `seam-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, { name: tenantName, policy: 'open' });
      const key = await generateSigningKey('RS256', KEK);
      await tx.insert(signingKeys).values({
        id: newId(),
        tenantId,
        kid: key.kid,
        alg: key.alg,
        status: 'active',
        publicJwk: key.publicJwk,
        privateJwkEncrypted: key.privateJwkEncrypted,
      });
    });

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: {
        ...MINIMAL,
        backchannel_logout_uri: 'https://rp.example/bc',
        userinfo_signed_response_alg: 'RS256',
        userinfo_encrypted_response_alg: 'RSA-OAEP-256',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.backchannel_logout_uri).toBe('https://rp.example/bc');
    expect(body.userinfo_signed_response_alg).toBe('RS256');
    expect(body.userinfo_encrypted_response_alg).toBe('RSA-OAEP-256');
    // OIDC Dynamic Client Registration §2's own default, applied because
    // `_enc` was never sent.
    expect(body.userinfo_encrypted_response_enc).toBe('A128CBC-HS256');

    const doc = await discovery(tenantName);
    expect(doc.backchannel_logout_supported).toBe(true);
    // This tenant's own active key, not a fixed pair every tenant gets —
    // it holds exactly one (`signing_keys_one_active`).
    expect(doc.userinfo_signing_alg_values_supported).toEqual(['RS256', 'none']);
    // Fixed by the installed jose, not by this tenant's own data — unlike
    // signing above, every tenant advertises the same set.
    expect(doc.userinfo_encryption_alg_values_supported).toEqual([
      'RSA-OAEP-256',
      'ECDH-ES',
      'ECDH-ES+A128KW',
      'ECDH-ES+A192KW',
      'ECDH-ES+A256KW',
    ]);
    expect(doc.userinfo_encryption_enc_values_supported).toEqual([
      'A128CBC-HS256',
      'A192CBC-HS384',
      'A256CBC-HS512',
      'A128GCM',
      'A192GCM',
      'A256GCM',
    ]);
  });

  // docs/superpowers/p3b-spike-jwe.md: RSA1_5 is removed from the
  // installed jose entirely — a registration that admitted it would
  // succeed today and fail every /userinfo request from then on.
  it('refuses a userinfo_encrypted_response_alg no installed jose can produce', async () => {
    const tenantName = `seam-enc-refuse-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_encrypted_response_alg: 'RSA1_5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // Unlike RSA1_5 above, jose *can* produce RSA-OAEP from a bare client
  // JWK; this server excludes it anyway because it specifies SHA-1 for
  // its OAEP hash (`@odudu/crypto`'s `JWE_ALGS_PERMITTED`). This pins the
  // server's own narrowing rather than jose's own refusal.
  it('refuses a userinfo_encrypted_response_alg jose can produce but this server excludes', async () => {
    const tenantName = `seam-enc-refuse-oaep-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_encrypted_response_alg: 'RSA-OAEP' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  it('refuses a userinfo_encrypted_response_enc outside the JWA registry', async () => {
    const tenantName = `seam-enc-value-refuse-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: {
        ...MINIMAL,
        userinfo_encrypted_response_alg: 'RSA-OAEP-256',
        userinfo_encrypted_response_enc: 'not-a-real-enc',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // OIDC Dynamic Client Registration §2: "When userinfo_encrypted_response_enc
  // is included, userinfo_encrypted_response_alg MUST also be provided" —
  // refused here rather than left to the DB's
  // client_oidc_config_userinfo_enc_needs_alg constraint, which would
  // otherwise turn this into an unrelated 500.
  it('refuses userinfo_encrypted_response_enc registered with no _alg', async () => {
    const tenantName = `seam-enc-no-alg-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_encrypted_response_enc: 'A256GCM' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  it('refuses a userinfo_signed_response_alg this server cannot produce', async () => {
    const tenantName = `seam-refuse-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'ES512' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // A permitted value (client-metadata.ts's own enum admits it) that this
  // tenant's own active key still cannot produce.
  it('refuses a permitted algorithm this tenant cannot produce, at registration', async () => {
    const tenantName = `seam-key-mismatch-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, { name: tenantName, policy: 'open' });
      const key = await generateSigningKey('RS256', KEK);
      await tx.insert(signingKeys).values({
        id: newId(),
        tenantId,
        kid: key.kid,
        alg: key.alg,
        status: 'active',
        publicJwk: key.publicJwk,
        privateJwkEncrypted: key.privateJwkEncrypted,
      });
    });

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'ES256' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // No active key at all: the tenant can honour neither RS256 nor ES256, so
  // this is the same refusal as a mismatch, not an unguarded exception.
  it('refuses a signing algorithm on a tenant with no active key, rather than 500', async () => {
    const tenantName = `seam-no-key-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'RS256' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });
});

describe('[RFC6749-2-01] client registration captures client type, redirect URIs, and any other information the authorization server requires', () => {
  it('stores the client type, redirect_uris and client_name a registration submits', async () => {
    const tenantName = `rfc-captures-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: {
        redirect_uris: ['https://rp.example/cb'],
        client_name: 'Captured RP',
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      expect(row?.type).toBe('public');
      expect(row?.name).toBe('Captured RP');
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.redirectUris).toEqual(['https://rp.example/cb']);
    });
  });
});

describe('[RFC6749-2.3.2-01] a mapping between client identifier and authentication scheme is defined when using a non-password scheme', () => {
  it('stores the token_endpoint_auth_method a confidential client requested', async () => {
    const tenantName = `rfc-auth-scheme-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, token_endpoint_auth_method: 'client_secret_post' },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.tokenEndpointAuthMethod).toBe('client_secret_post');
    });
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-JWKS-URI-01] a registered jwks_uri', () => {
  // What would this test still pass under? A version that fetches jwks_uri
  // and tolerates the fetch failing would also return 201 — the stored
  // value proves the string was never resolved, only accepted. This host
  // (RFC 2606) never resolves, so a version that does dereference it fails
  // on the network call itself, not on an assertion.
  it('registers even when the host cannot resolve, never dereferencing it', async () => {
    const tenantName = `jwks-uri-${newId()}`;
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      seedTenant(tx, tenantId, { name: tenantName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(tenantName),
      payload: { ...MINIMAL, jwks_uri: 'https://nonexistent.invalid/jwks.json' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ client_id: string; jwks_uri: string }>();
    expect(body.jwks_uri).toBe('https://nonexistent.invalid/jwks.json');

    await withTenant(app.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, body.client_id));
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.jwksUri).toBe('https://nonexistent.invalid/jwks.json');
    });
  });
});
