import { randomBytes } from 'node:crypto';
import formbody from '@fastify/formbody';
import {
  generateSigningKey,
  signingKeyRepository,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant, sessionRepository } from '@odudu/authn-flows';
import { roleRepository, subjectRoles } from '@odudu/domain-authz';
import { hashPassword, subjectRepository, userRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  clientRepository,
  clients,
  provisionClientDefaults,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
  TENANT_CAPABILITIES,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  NO_CLIENT_KEY_FETCHER,
  oidcRoutes,
  provisionAdminClient,
  standardClaimMappers,
  tenantIssuerFor,
  tokenGrantRepository,
  UNLIMITED_AUDIT_REFUSAL_BUDGET,
  UNLIMITED_CLIENT_SECRET_LIMITER,
} from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { adminRoutesForTesting } from '#/index';

// Encrypts every signing key this fixture generates, and decrypts every one
// it signs with — a fixed value is fine because nothing outside this
// process ever needs to read the ciphertext.
const KEK = Buffer.alloc(32, 7);

const NO_OP_LOGGER = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NO_OP_LOGGER,
};

export interface TestClient {
  readonly id: string;
  readonly clientId: string;
  readonly secret: string;
  /** A bearer token for this client's own service account, when it has one. */
  readonly token: string;
}

export interface AdminFixture {
  readonly owner: DatabaseHandle;
  readonly app: DatabaseHandle;
  readonly http: FastifyInstance;
  readonly clock: FakeClock;
  readonly systemTenantId: string;

  /** Creates a tenant, provisions its flow and its admin client, mints a key. */
  createTenant(name: string): Promise<{ id: string; name: string }>;
  stop(): Promise<void>;

  // Tokens. `adminToken` and `systemAdminToken` carry the admin API's
  // resource identifier in `aud`; `applicationToken` deliberately does not,
  // which is what tells the admin audience check apart from an ordinary
  // access token.
  adminToken(tenantName: string, capabilities: readonly string[]): Promise<string>;
  systemAdminToken(capabilities: readonly string[]): Promise<string>;
  applicationToken(tenantName: string, options: { audience: string }): Promise<string>;
  // Like `adminToken`, but `iss`/`aud` are computed for the given `Host`
  // instead of this fixture's own default authority — what a caller
  // presenting the resulting token needs to inject with the same `host`
  // header to be accepted, and a different one to be refused.
  adminTokenAt(tenantName: string, capabilities: readonly string[], host: string): Promise<string>;
  // Signs arbitrary claims with the tenant's own active key, `iss` included,
  // so a test can present a genuine signature over an issuer it chose.
  // `typ` defaults to `at+jwt`.
  signWithTenantKey(
    tenantName: string,
    claims: Record<string, unknown>,
    options?: { typ?: string },
  ): Promise<string>;

  // Subjects and clients.
  createSubject(tenantName: string, username: string): Promise<{ id: string }>;
  createConfidentialClient(
    tenantName: string,
    overrides: Partial<{ grantTypes: string[]; redirectUris: string[] }>,
  ): Promise<TestClient>;
  createServiceAccountClient(
    tenantName: string,
    capabilities: readonly string[],
  ): Promise<TestClient>;
  builtinAdminClient(tenantName: string): Promise<TestClient>;
  // A token whose subject holds a role of the given name that does not
  // belong to the built-in admin client — either on an ordinary
  // application client or on the tenant itself. A capability name is only
  // a capability when it sits on the admin client.
  tokenWithRoleOutsideAdminClient(
    tenantName: string,
    roleName: string,
    placement: 'application-client' | 'tenant',
  ): Promise<string>;
  registerClient(
    tenantName: string,
    metadata: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>;
  registerClientWithUserinfoAlg(tenantName: string, alg: string): Promise<TestClient>;
  patchClient(
    tenantName: string,
    clientDbId: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>;

  // Protocol calls, so a test can prove an admin change reached /token.
  tokenRequest(
    tenantName: string,
    client: TestClient,
    body: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  // So a test can prove an admin change to signing keys reaches /userinfo,
  // not only /token and /certs.
  callUserinfo(tenantName: string, token: string): Promise<LightMyRequestResponse>;
  // A token for the given, already-registered client, carrying `scope` —
  // minted directly, the same way `adminToken` is, so a test can reach
  // `/userinfo` without driving a full authorization_code exchange.
  mintUserinfoAccessToken(tenantName: string, client: TestClient, scope: string): Promise<string>;

  // State changes a test needs but no endpoint offers, written directly.
  revokeGrantsFor(tenantName: string): Promise<void>;
  revokeCapability(tenantName: string, token: string, capability: string): Promise<void>;
  disableClientOf(token: string): Promise<void>;
  renameClientIdDirectly(tenantId: string, clientDbId: string, clientId: string): Promise<void>;
  /** Forces the next mutation to throw after its audit row is written. */
  failNextWriteAfterAudit(): Promise<void>;
}

interface TenantContext {
  readonly id: string;
  readonly name: string;
  readonly issuer: string;
}

function decodeUnverified(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('fixture: token payload is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// `iss` is always `<base>/tenants/<name>` (packages/protocol-oidc/src/
// service/issuer.ts) — the name a caller who only has a token needs back.
function tenantNameFromIssuer(iss: string): string {
  const match = /\/tenants\/([^/]+)$/u.exec(iss);
  const name = match?.[1];
  if (name === undefined) {
    throw new Error(`fixture: cannot read a tenant name from issuer ${JSON.stringify(iss)}`);
  }
  return name;
}

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

export async function startAdminFixture(): Promise<AdminFixture> {
  const container: TestDatabase = await startTestDatabase();
  const owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  const app = createDatabase(appUrl, { max: 5 });

  const clock = new FakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  // Shared with adminRoutes below — the same instance, so a test can bind a
  // mapper through the admin API and see it reach issuance, and so
  // GET /scopes/:id/mappers can never list a name issuance itself would not
  // recognise.
  const claimMappers = standardClaimMappers();
  // Same request-id wiring as apps/server/src/app.ts, so an audit row's
  // request_id/ip can be tested here against a header this fixture actually
  // honours rather than against light-my-request's own random id.
  const http = Fastify({ genReqId: () => newId(), requestIdHeader: 'x-request-id' });
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      claimMappers,
    }),
  );
  let failNextAuditWrite = false;
  await http.register(
    adminRoutesForTesting(
      {
        database: app,
        ownerDatabase: owner,
        logger: NO_OP_LOGGER,
        clock,
        cursorKey: KEK,
        kek: KEK,
        claimMappers,
      },
      () => {
        if (!failNextAuditWrite) return Promise.resolve();
        failNextAuditWrite = false;
        return Promise.reject(new Error('fixture: forced failure after an audit write'));
      },
    ),
  );
  await http.ready();

  const tenantsByName = new Map<string, TenantContext>();
  const grantsByTenant = new Map<string, string[]>();

  function requireTenant(name: string): TenantContext {
    const ctx = tenantsByName.get(name);
    if (ctx === undefined) throw new Error(`fixture: unknown tenant ${JSON.stringify(name)}`);
    return ctx;
  }

  function recordGrant(tenantId: string, grantId: string): void {
    const existing = grantsByTenant.get(tenantId) ?? [];
    existing.push(grantId);
    grantsByTenant.set(tenantId, existing);
  }

  async function resolveIssuer(tenantName: string): Promise<string> {
    const res = await http.inject({
      url: `/tenants/${encodeURIComponent(tenantName)}/.well-known/openid-configuration`,
    });
    if (res.statusCode !== 200) {
      throw new Error(
        `fixture: discovery did not resolve an issuer for ${tenantName}, got ${String(res.statusCode)}`,
      );
    }
    return res.json<{ issuer: string }>().issuer;
  }

  async function provisionTenantRow(
    id: string,
    name: string,
    options: { crossTenant?: boolean } = {},
  ): Promise<TenantContext> {
    await withTenant(app.db, id, async (tx) => {
      await tx.insert(tenants).values({ id, name });
      await provisionTenant(tx, id);
      await provisionAdminClient(tx, id, options);
      const generated = await generateSigningKey('ES256', KEK);
      await signingKeyRepository(tx).create({
        id: newId(),
        tenantId: id,
        kid: generated.kid,
        alg: generated.alg,
        status: 'active',
        publicJwk: generated.publicJwk,
        privateJwkEncrypted: generated.privateJwkEncrypted,
      });
    });
    const ctx: TenantContext = { id, name, issuer: await resolveIssuer(name) };
    tenantsByName.set(name, ctx);
    return ctx;
  }

  const systemTenant = await provisionTenantRow(SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME, {
    crossTenant: true,
  });

  // Signs an access token from claims a caller has already decided, and
  // records its grant so `revokeGrantsFor` can find it again. Every minted
  // token in this fixture goes through here — `adminToken`,
  // `systemAdminToken`, `applicationToken` and the client-credentials paths
  // alike — so the shape a real access token carries (`grant_id`, `sid`,
  // `client_id`) is never approximated twice.
  async function mintTokenInTx(
    tx: TenantScopedDatabase,
    ctx: TenantContext,
    input: {
      subjectId: string;
      client: ClientRecord;
      sessionId: string | null;
      audience: string[];
      scope?: string;
    },
  ): Promise<string> {
    const key: SigningKeyRecord = await signingKeyRepository(tx).active();
    const grantId = newId();
    const iat = Math.floor(clock.now().getTime() / 1000);
    const scope = input.scope ?? '';
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: ctx.id,
      clientId: input.client.id,
      subjectId: input.subjectId,
      scope,
      audience: input.audience,
      sessionId: input.sessionId,
    });
    recordGrant(ctx.id, grantId);
    return signJwt(
      {
        iss: ctx.issuer,
        sub: input.subjectId,
        aud: input.audience,
        client_id: input.client.clientId,
        scope,
        iat,
        exp: iat + 3600,
        jti: newId(),
        grant_id: grantId,
        ...(input.sessionId !== null ? { sid: input.sessionId } : {}),
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
  }

  async function assignCapabilities(
    tx: TenantScopedDatabase,
    adminClientDbId: string,
    subjectId: string,
    capabilities: readonly string[],
  ): Promise<void> {
    const roles = roleRepository(tx);
    for (const capability of capabilities) {
      const role = await roles.byName(capability, adminClientDbId);
      if (role === null) {
        throw new Error(`fixture: no role named ${JSON.stringify(capability)} on the admin client`);
      }
      await roles.assignToSubject(subjectId, role.id);
    }
  }

  // Shared by `adminToken`, `systemAdminToken` and `applicationToken`: a
  // fresh subject carrying the named capabilities, a live session, and a
  // grant minted through the tenant's own built-in admin client.
  async function mintAdminLikeToken(
    ctx: TenantContext,
    capabilities: readonly string[],
    audience: string[],
  ): Promise<string> {
    return withTenant(app.db, ctx.id, async (tx) => {
      const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (adminClient === null) {
        throw new Error(`fixture: ${ctx.name} has no built-in admin client`);
      }
      const subject = await subjectRepository(tx).create({ tenantId: ctx.id, type: 'user' });
      await assignCapabilities(tx, adminClient.id, subject.id, capabilities);
      const sessionId = newId();
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: ctx.id,
        subjectId: subject.id,
        expiresAt: new Date(clock.now().getTime() + 24 * 3600 * 1000),
        authenticators: ['pwd'],
      });
      return mintTokenInTx(tx, ctx, {
        subjectId: subject.id,
        client: adminClient,
        sessionId,
        audience,
      });
    });
  }

  async function clientCredentialsToken(
    ctx: TenantContext,
    clientId: string,
    secret: string,
  ): Promise<string> {
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${ctx.name}/protocol/openid-connect/token`,
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(clientId, secret),
      },
    });
    if (res.statusCode !== 200) {
      throw new Error(
        `fixture: client_credentials request failed with ${String(res.statusCode)}: ${res.body}`,
      );
    }
    return res.json<{ access_token: string }>().access_token;
  }

  async function createConfidentialClientRow(
    ctx: TenantContext,
    input: {
      clientId: string;
      name: string;
      grantTypes: string[];
      redirectUris: string[];
      audiences: string[];
    },
  ): Promise<{ client: ClientRecord; secret: string }> {
    const secret = randomBytes(32).toString('base64url');
    const client = await withTenant(app.db, ctx.id, async (tx) => {
      const serviceSubject = await subjectRepository(tx).create({
        tenantId: ctx.id,
        type: 'service',
      });
      const created = await clientRepository(tx).create({
        tenantId: ctx.id,
        clientId: input.clientId,
        name: input.name,
        type: 'confidential',
        secretHash: await hashPassword(secret),
        serviceSubjectId: serviceSubject.id,
      });
      await provisionClientDefaults(tx, created.id);
      await clientOidcConfigRepository(tx).create({
        clientId: created.id,
        tenantId: ctx.id,
        redirectUris: input.redirectUris,
        grantTypes: input.grantTypes,
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: input.audiences,
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
      return created;
    });
    return { client, secret };
  }

  async function createTenant(name: string): Promise<{ id: string; name: string }> {
    const ctx = await provisionTenantRow(newId(), name);
    return { id: ctx.id, name: ctx.name };
  }

  async function stop(): Promise<void> {
    await http.close();
    await app.close();
    await owner.close();
    await container.stop();
  }

  async function adminToken(tenantName: string, capabilities: readonly string[]): Promise<string> {
    const ctx = requireTenant(tenantName);
    return mintAdminLikeToken(ctx, capabilities, [ADMIN_API_AUDIENCE]);
  }

  async function adminTokenAt(
    tenantName: string,
    capabilities: readonly string[],
    host: string,
  ): Promise<string> {
    const ctx = requireTenant(tenantName);
    const issuer = tenantIssuerFor({ protocol: 'http', host }, tenantName);
    return mintAdminLikeToken({ ...ctx, issuer }, capabilities, [ADMIN_API_AUDIENCE]);
  }

  async function signWithTenantKey(
    tenantName: string,
    claims: Record<string, unknown>,
    options: { typ?: string } = {},
  ): Promise<string> {
    const ctx = requireTenant(tenantName);
    const key = await withTenant(app.db, ctx.id, (tx) => signingKeyRepository(tx).active());
    return signJwt(claims, { key, kek: KEK, typ: options.typ ?? 'at+jwt' });
  }

  async function systemAdminToken(capabilities: readonly string[]): Promise<string> {
    return mintAdminLikeToken(systemTenant, capabilities, [ADMIN_API_AUDIENCE]);
  }

  // Carries the same capabilities `adminToken` would, so the two differ in
  // exactly one respect: `aud`. A test that refuses this token must be
  // refusing it for the audience, never for a capability it was never
  // given — otherwise the admin audience check could be missing entirely
  // and the test would still pass.
  async function applicationToken(
    tenantName: string,
    options: { audience: string },
  ): Promise<string> {
    const ctx = requireTenant(tenantName);
    return mintAdminLikeToken(ctx, TENANT_CAPABILITIES, [options.audience]);
  }

  async function createSubject(tenantName: string, username: string): Promise<{ id: string }> {
    const ctx = requireTenant(tenantName);
    return withTenant(app.db, ctx.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: ctx.id, type: 'user' });
      await userRepository(tx).create({ subjectId: subject.id, tenantId: ctx.id, username });
      return { id: subject.id };
    });
  }

  async function createConfidentialClient(
    tenantName: string,
    overrides: Partial<{ grantTypes: string[]; redirectUris: string[] }>,
  ): Promise<TestClient> {
    const ctx = requireTenant(tenantName);
    const grantTypes = overrides.grantTypes ?? ['client_credentials'];
    const redirectUris = overrides.redirectUris ?? ['https://app.example/callback'];
    const { client, secret } = await createConfidentialClientRow(ctx, {
      clientId: `client-${newId()}`,
      name: 'Test confidential client',
      grantTypes,
      redirectUris,
      audiences: [],
    });
    const token = grantTypes.includes('client_credentials')
      ? await clientCredentialsToken(ctx, client.clientId, secret)
      : '';
    return { id: client.id, clientId: client.clientId, secret, token };
  }

  async function createServiceAccountClient(
    tenantName: string,
    capabilities: readonly string[],
  ): Promise<TestClient> {
    const ctx = requireTenant(tenantName);
    const { client, secret } = await createConfidentialClientRow(ctx, {
      clientId: `service-${newId()}`,
      name: 'Test service account client',
      grantTypes: ['client_credentials'],
      redirectUris: [],
      // The admin audience, so this client's own client_credentials grant
      // authenticates at /admin the same way `adminToken` does, and
      // `disableClientOf` breaks it the same way it breaks any other.
      audiences: [ADMIN_API_AUDIENCE],
    });
    const serviceSubjectId = client.serviceSubjectId;
    if (serviceSubjectId !== null) {
      await withTenant(app.db, ctx.id, async (tx) => {
        const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
        if (adminClient === null) {
          throw new Error(`fixture: ${ctx.name} has no built-in admin client`);
        }
        await assignCapabilities(tx, adminClient.id, serviceSubjectId, capabilities);
      });
    }
    const token = await clientCredentialsToken(ctx, client.clientId, secret);
    return { id: client.id, clientId: client.clientId, secret, token };
  }

  async function builtinAdminClient(tenantName: string): Promise<TestClient> {
    const ctx = requireTenant(tenantName);
    return withTenant(app.db, ctx.id, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error(`fixture: ${ctx.name} has no built-in admin client`);
      // Public and never authenticated with client_credentials — nothing
      // to fill either field with.
      return { id: client.id, clientId: client.clientId, secret: '', token: '' };
    });
  }

  async function tokenWithRoleOutsideAdminClient(
    tenantName: string,
    roleName: string,
    placement: 'application-client' | 'tenant',
  ): Promise<string> {
    const ctx = requireTenant(tenantName);
    return withTenant(app.db, ctx.id, async (tx) => {
      const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (adminClient === null) {
        throw new Error(`fixture: ${ctx.name} has no built-in admin client`);
      }
      let roleClientId: string | null = null;
      if (placement === 'application-client') {
        const other = await clientRepository(tx).create({
          tenantId: ctx.id,
          clientId: `app-${newId()}`,
          name: 'Test application client',
          type: 'public',
          secretHash: null,
        });
        roleClientId = other.id;
      }
      const role = await roleRepository(tx).create({
        tenantId: ctx.id,
        clientId: roleClientId,
        name: roleName,
      });
      const subject = await subjectRepository(tx).create({ tenantId: ctx.id, type: 'user' });
      await roleRepository(tx).assignToSubject(subject.id, role.id);
      const sessionId = newId();
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: ctx.id,
        subjectId: subject.id,
        expiresAt: new Date(clock.now().getTime() + 24 * 3600 * 1000),
        authenticators: ['pwd'],
      });
      // The grant is minted through the built-in admin client, so the only
      // way this token differs from `adminToken`'s is where its role sits.
      return mintTokenInTx(tx, ctx, {
        subjectId: subject.id,
        client: adminClient,
        sessionId,
        audience: [ADMIN_API_AUDIENCE],
      });
    });
  }

  async function registerClient(
    tenantName: string,
    metadata: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/clients-registrations/openid-connect`,
      payload: JSON.stringify(metadata),
      headers: { 'content-type': 'application/json' },
    });
  }

  async function registerClientWithUserinfoAlg(
    tenantName: string,
    alg: string,
  ): Promise<TestClient> {
    const ctx = requireTenant(tenantName);
    const res = await registerClient(tenantName, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
      userinfo_signed_response_alg: alg,
    });
    if (res.statusCode !== 201) {
      throw new Error(
        `fixture: client registration failed with ${String(res.statusCode)}: ${res.body}`,
      );
    }
    const body = res.json<{ client_id: string; client_secret: string }>();
    const token = await clientCredentialsToken(ctx, body.client_id, body.client_secret);
    const clientDbId = await withTenant(app.db, ctx.id, async (tx) => {
      const client = await clientRepository(tx).byClientId(body.client_id);
      if (client === null) throw new Error('fixture: registered client not found');
      return client.id;
    });
    return { id: clientDbId, clientId: body.client_id, secret: body.client_secret, token };
  }

  async function patchClient(
    tenantName: string,
    clientDbId: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    const ctx = requireTenant(tenantName);
    const token = await mintAdminLikeToken(ctx, ['manage-clients'], [ADMIN_API_AUDIENCE]);
    return http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenantName}/clients/${clientDbId}`,
      payload: JSON.stringify(body),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
  }

  async function tokenRequest(
    tenantName: string,
    client: TestClient,
    body: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    return http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/protocol/openid-connect/token`,
      payload: new URLSearchParams(body).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(client.clientId, client.secret),
      },
    });
  }

  async function callUserinfo(tenantName: string, token: string): Promise<LightMyRequestResponse> {
    return http.inject({
      method: 'GET',
      url: `/tenants/${tenantName}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  // `sessionId: null` reads the same way an `offline_access` grant does —
  // no session for `/userinfo` to check liveness against — since this
  // fixture drives no login flow for the client under test.
  async function mintUserinfoAccessToken(
    tenantName: string,
    client: TestClient,
    scope: string,
  ): Promise<string> {
    const ctx = requireTenant(tenantName);
    return withTenant(app.db, ctx.id, async (tx) => {
      const clientRecord = await clientRepository(tx).byClientId(client.clientId);
      if (clientRecord === null) {
        throw new Error(`fixture: unknown client ${client.clientId}`);
      }
      const subject = await subjectRepository(tx).create({ tenantId: ctx.id, type: 'user' });
      return mintTokenInTx(tx, ctx, {
        subjectId: subject.id,
        client: clientRecord,
        sessionId: null,
        audience: [ctx.issuer],
        scope,
      });
    });
  }

  async function revokeGrantsFor(tenantName: string): Promise<void> {
    const ctx = requireTenant(tenantName);
    const ids = grantsByTenant.get(ctx.id) ?? [];
    if (ids.length === 0) return;
    const now = clock.now();
    await withTenant(app.db, ctx.id, async (tx) => {
      for (const id of ids) {
        await tokenGrantRepository(tx).revoke(id, now);
      }
    });
  }

  async function revokeCapability(
    tenantName: string,
    token: string,
    capability: string,
  ): Promise<void> {
    const ctx = requireTenant(tenantName);
    const subjectId = decodeUnverified(token).sub;
    if (typeof subjectId !== 'string') throw new Error('fixture: token carries no sub claim');
    await withTenant(app.db, ctx.id, async (tx) => {
      const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (adminClient === null)
        throw new Error(`fixture: ${ctx.name} has no built-in admin client`);
      const role = await roleRepository(tx).byName(capability, adminClient.id);
      if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(capability)}`);
      await tx
        .delete(subjectRoles)
        .where(and(eq(subjectRoles.subjectId, subjectId), eq(subjectRoles.roleId, role.id)));
    });
  }

  async function disableClientOf(token: string): Promise<void> {
    const claims = decodeUnverified(token);
    const iss = claims.iss;
    const clientIdString = claims.client_id;
    if (typeof iss !== 'string' || typeof clientIdString !== 'string') {
      throw new Error('fixture: token carries no iss/client_id claim');
    }
    const ctx = requireTenant(tenantNameFromIssuer(iss));
    await withTenant(app.db, ctx.id, async (tx) => {
      const client = await clientRepository(tx).byClientId(clientIdString);
      if (client === null) throw new Error(`fixture: unknown client ${clientIdString}`);
      await tx.update(clients).set({ enabled: false }).where(eq(clients.id, client.id));
    });
  }

  async function renameClientIdDirectly(
    tenantId: string,
    clientDbId: string,
    clientId: string,
  ): Promise<void> {
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.update(clients).set({ clientId }).where(eq(clients.id, clientDbId));
    });
  }

  function failNextWriteAfterAudit(): Promise<void> {
    failNextAuditWrite = true;
    return Promise.resolve();
  }

  return {
    owner,
    app,
    http,
    clock,
    systemTenantId: systemTenant.id,
    createTenant,
    stop,
    adminToken,
    adminTokenAt,
    signWithTenantKey,
    systemAdminToken,
    applicationToken,
    createSubject,
    createConfidentialClient,
    createServiceAccountClient,
    builtinAdminClient,
    tokenWithRoleOutsideAdminClient,
    registerClient,
    registerClientWithUserinfoAlg,
    patchClient,
    tokenRequest,
    callUserinfo,
    mintUserinfoAccessToken,
    revokeGrantsFor,
    revokeCapability,
    disableClientOf,
    renameClientIdDirectly,
    failNextWriteAfterAudit,
  };
}
