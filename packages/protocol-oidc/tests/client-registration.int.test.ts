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
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { clientRegistrationTokenRepository, clients } from '@odudu/domain-realm';
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

const URL_FOR = (realm: string) => `/realms/${realm}/clients-registrations/openid-connect`;
const MINIMAL = { redirect_uris: ['https://rp.example/cb'] };
const KEK = Buffer.alloc(32, 7);

async function seedRealm(
  tx: RealmScopedDatabase,
  id: string,
  opts: { name: string; policy?: 'disabled' | 'open' | 'token'; maxClients?: number } = {
    name: id,
  },
): Promise<void> {
  await tx.insert(realms).values({ id, name: opts.name });
  await provisionRealm(tx, id);
  if (opts.policy !== undefined || opts.maxClients !== undefined) {
    await tx
      .update(realms)
      .set({
        ...(opts.policy === undefined ? {} : { clientRegistrationPolicy: opts.policy }),
        ...(opts.maxClients === undefined ? {} : { maxClients: opts.maxClients }),
      })
      .where(eq(realms.id, id));
  }
}

async function mintToken(realmId: string, uses = 1, ttlSeconds = 3600): Promise<string> {
  const { token } = await withRealm(app.db, realmId, (tx) =>
    clientRegistrationTokenRepository(tx).mint({ realmId, uses, ttlSeconds }),
  );
  return token;
}

async function discovery(realm: string): Promise<Record<string, unknown>> {
  const res = await http.inject({ url: `/realms/${realm}/.well-known/openid-configuration` });
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

describe('[ODUDU-CLIENT-REGISTRATION-DISABLED-01] a realm that has not opened registration', () => {
  it('refuses registration with 404', async () => {
    const realmName = `closed-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId, { name: realmName }));

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
    expect(res.statusCode).toBe(404);
  });

  it('omits registration_endpoint from discovery', async () => {
    const realmName = `closed-disc-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId, { name: realmName }));

    const doc = await discovery(realmName);
    expect(doc).not.toHaveProperty('registration_endpoint');
  });

  it('answers 404 for an unknown realm the same way', async () => {
    const res = await http.inject({
      method: 'POST',
      url: URL_FOR('no-such-realm'),
      payload: MINIMAL,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-OPEN-01] the open policy', () => {
  it('registers a client, assigns its id, and advertises registration_endpoint', async () => {
    const realmName = `open-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const doc = await discovery(realmName);
    expect(doc.registration_endpoint).toBe(
      `http://localhost/realms/${realmName}/clients-registrations/openid-connect`,
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
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
    const realmName = `open-propose-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, client_id: 'i-picked-this' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  it('marks an anonymous registration as requiring consent, with origin anonymous', async () => {
    const realmName = `open-anon-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withRealm(app.db, realmId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      expect(row?.registrationOrigin).toBe('anonymous');
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.consentRequired).toBe(true);
    });
  });

  it('a token still registers under the open policy, with origin token and no default consent', async () => {
    const realmName = `open-token-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );
    const token = await mintToken(realmId);

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withRealm(app.db, realmId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, oauthClientId));
      expect(row?.registrationOrigin).toBe('token');
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.consentRequired).toBe(false);
    });
  });

  it('a public client (token_endpoint_auth_method none) is issued no secret', async () => {
    const realmName = `open-public-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, token_endpoint_auth_method: 'none' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty('client_secret');
    expect(body).not.toHaveProperty('client_secret_expires_at');
  });

  it('a confidential client is issued a secret once, hashed at rest', async () => {
    const realmName = `open-conf-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      client_id: string;
      client_secret: string;
      client_secret_expires_at: number;
    }>();
    expect(typeof body.client_secret).toBe('string');
    expect(body.client_secret_expires_at).toBe(0);

    await withRealm(app.db, realmId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, body.client_id));
      expect(row?.secretHash).not.toBe(body.client_secret);
      expect(row?.secretHash).toBeTruthy();
    });
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-TOKEN-01] the token policy', () => {
  it('refuses an unauthenticated registration with 401 and a Bearer challenge', async () => {
    const realmName = `token-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'token' }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/u);
  });

  it('refuses a spent or foreign token the same way', async () => {
    const realmName = `token-bad-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'token' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: MINIMAL,
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('registers with a valid token, consuming it', async () => {
    const realmName = `token-ok-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'token' }),
    );
    const token = await mintToken(realmId, 1);

    const first = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(201);

    // The same token, presented again, is a single-use credential already
    // spent — discriminates from a check that only looks at expiry.
    const second = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: MINIMAL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(401);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-CAP-01] the realm client cap', () => {
  it('refuses once the realm is at its client cap', async () => {
    const realmName = `cap-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open', maxClients: 0 }),
    );

    const res = await http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL });
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
    const realmName = `cap-race-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open', maxClients: 1 }),
    );

    const [first, second] = await Promise.all([
      http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL }),
      http.inject({ method: 'POST', url: URL_FOR(realmName), payload: MINIMAL }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 403]);

    const count = await withRealm(app.db, realmId, async (tx) =>
      tx.select().from(clients).where(eq(clients.realmId, realmId)),
    );
    expect(count.length).toBe(1);
  });
});

describe('[ODUDU-CLIENT-REGISTRATION-SEAM-01] the P3a/P3b seam', () => {
  // The seam that remains: `backchannel_logout_uri` and
  // `userinfo_signed_response_alg` are both stored, read, and advertised in
  // discovery now (`/userinfo` signs — see `userinfo-signed.int.test.ts`).
  // `userinfo_encrypted_response_alg`/`_enc` are still stored with nothing
  // downstream of them, and discovery advertises no capability for either.
  it('advertises signing but not encryption, and stores both', async () => {
    const realmName = `seam-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, { name: realmName, policy: 'open' });
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
    });

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: {
        ...MINIMAL,
        backchannel_logout_uri: 'https://rp.example/bc',
        userinfo_signed_response_alg: 'RS256',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.backchannel_logout_uri).toBe('https://rp.example/bc');
    expect(body.userinfo_signed_response_alg).toBe('RS256');

    const doc = await discovery(realmName);
    expect(doc.backchannel_logout_supported).toBe(true);
    // This realm's own active key, not a fixed pair every realm gets —
    // it holds exactly one (`signing_keys_one_active`).
    expect(doc.userinfo_signing_alg_values_supported).toEqual(['RS256', 'none']);
    expect(doc).not.toHaveProperty('userinfo_encryption_alg_values_supported');
  });

  it('refuses a userinfo_signed_response_alg this server cannot produce', async () => {
    const realmName = `seam-refuse-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'ES512' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // A permitted value (client-metadata.ts's own enum admits it) that this
  // realm's own active key still cannot produce.
  it('refuses a permitted algorithm this realm cannot produce, at registration', async () => {
    const realmName = `seam-key-mismatch-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, { name: realmName, policy: 'open' });
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
    });

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'ES256' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });

  // No active key at all: the realm can honour neither RS256 nor ES256, so
  // this is the same refusal as a mismatch, not an unguarded exception.
  it('refuses a signing algorithm on a realm with no active key, rather than 500', async () => {
    const realmName = `seam-no-key-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, userinfo_signed_response_alg: 'RS256' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client_metadata');
  });
});

describe('[RFC6749-2-01] client registration captures client type, redirect URIs, and any other information the authorization server requires', () => {
  it('stores the client type, redirect_uris and client_name a registration submits', async () => {
    const realmName = `rfc-captures-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: {
        redirect_uris: ['https://rp.example/cb'],
        client_name: 'Captured RP',
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withRealm(app.db, realmId, async (tx) => {
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
    const realmName = `rfc-auth-scheme-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, token_endpoint_auth_method: 'client_secret_post' },
    });
    expect(res.statusCode).toBe(201);
    const { client_id: oauthClientId } = res.json<{ client_id: string }>();

    await withRealm(app.db, realmId, async (tx) => {
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
    const realmName = `jwks-uri-${newId()}`;
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) =>
      seedRealm(tx, realmId, { name: realmName, policy: 'open' }),
    );

    const res = await http.inject({
      method: 'POST',
      url: URL_FOR(realmName),
      payload: { ...MINIMAL, jwks_uri: 'https://nonexistent.invalid/jwks.json' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ client_id: string; jwks_uri: string }>();
    expect(body.jwks_uri).toBe('https://nonexistent.invalid/jwks.json');

    await withRealm(app.db, realmId, async (tx) => {
      const [row] = await tx.select().from(clients).where(eq(clients.clientId, body.client_id));
      const config = await clientOidcConfigRepository(tx).byClientId(row?.id ?? '');
      expect(config?.jwksUri).toBe('https://nonexistent.invalid/jwks.json');
    });
  });
});
