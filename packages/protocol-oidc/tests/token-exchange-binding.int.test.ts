import {
  generateSigningKey,
  signingKeyRepository,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { auditEvents } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults, type ClientRecord } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { provisionAdminClient } from '#/usecase/provision-admin-client';
import { provisionMcpClient } from '#/usecase/provision-mcp-client';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { hashRefreshToken } from '#/service/refresh';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import { hashPassword } from '@odudu/domain-identity';

const KEK = Buffer.alloc(32, 41);
const SECRET = 'a-long-enough-client-secret';
const ACCESS = 'urn:ietf:params:oauth:token-type:access_token';
const REFRESH = 'urn:ietf:params:oauth:token-type:refresh_token';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpHandle: FastifyInstance | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

interface Settings {
  allowedForPublic?: boolean;
  actorFromOtherClient?: boolean;
}

interface World {
  tenant: string;
  tenantId: string;
  issuer: string;
  ownerSubject: string;
  actorSubject: string;
  confidential: ClientRecord;
  public: ClientRecord;
  peer: ClientRecord;
  peerServiceSubject: string;
}

async function addClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  type: 'public' | 'confidential',
  settings: Settings,
  extraGrants: string[] = [],
): Promise<ClientRecord> {
  const client = await clientRepository(tx).create({
    tenantId,
    clientId,
    name: clientId,
    type,
    secretHash: type === 'confidential' ? await hashPassword(SECRET) : null,
  });
  await provisionClientDefaults(tx, client.id);
  await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId,
    redirectUris: ['https://app.example/callback'],
    grantTypes: [TOKEN_EXCHANGE_GRANT, ...extraGrants],
    tokenEndpointAuthMethod: type === 'public' ? 'none' : 'client_secret_basic',
    audiences: ['https://api.example'],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 3600,
    tokenExchangeImpersonationAllowed: true,
    ...(settings.allowedForPublic === undefined
      ? {}
      : { tokenExchangeAllowedForPublic: settings.allowedForPublic }),
    ...(settings.actorFromOtherClient === undefined
      ? {}
      : { tokenExchangeActorFromOtherClient: settings.actorFromOtherClient }),
  });
  return client;
}

async function newWorld(
  confidential: Settings = {},
  publicSettings: Settings = {},
): Promise<World> {
  const tenantId = newId();
  const tenant = `binding-${newId()}`;
  const ids = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenant });
    await provisionTenant(tx, tenantId);
    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    await signingKeyRepository(tx).create(key);
    const ownerSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const actorSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const peerService = await subjectRepository(tx).create({ tenantId, type: 'service' });
    return {
      ownerSubject: ownerSubject.id,
      actorSubject: actorSubject.id,
      peerServiceSubject: peerService.id,
      confidential: await addClient(tx, tenantId, 'confidential-ex', 'confidential', confidential),
      public: await addClient(tx, tenantId, 'public-ex', 'public', publicSettings),
      peer: await addClient(tx, tenantId, 'peer', 'confidential', {}, ['authorization_code']),
    };
  });
  const discovery = await http.inject({
    url: `/tenants/${tenant}/.well-known/openid-configuration`,
  });
  return { tenant, tenantId, issuer: discovery.json<{ issuer: string }>().issuer, ...ids };
}

// An access token whose grant is real, as the token endpoint would have
// stored it: this is what resolves as a subject or actor token.
async function tokenFor(
  w: World,
  client: ClientRecord,
  subjectId: string,
  scope = 'openid',
): Promise<{ token: string; grantId: string }> {
  return withTenant(app.db, w.tenantId, async (tx) => {
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: client.id,
      subjectId,
      scope,
      audience: ['https://api.example'],
    });
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss: w.issuer,
        sub: subjectId,
        aud: ['https://api.example', w.issuer],
        client_id: client.clientId,
        scope,
        iat,
        exp: iat + 600,
        jti: newId(),
        grant_id: grantId,
      },
      { key: await signingKeyRepository(tx).active(), kek: KEK, typ: 'at+jwt' },
    );
    return { token, grantId };
  });
}

function exchange(w: World, client: ClientRecord, fields: Record<string, string>) {
  const isPublic = client.type === 'public';
  return http.inject({
    method: 'POST',
    url: `/tenants/${w.tenant}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token_type: ACCESS,
      ...(isPublic ? { client_id: client.clientId } : {}),
      ...fields,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(isPublic
        ? {}
        : {
            authorization: `Basic ${Buffer.from(`${client.clientId}:${SECRET}`).toString('base64')}`,
          }),
    },
  });
}

async function delegation(w: World, requester: ClientRecord, actorClient: ClientRecord) {
  const subject = await tokenFor(w, w.confidential, w.ownerSubject);
  const actor = await tokenFor(w, actorClient, w.actorSubject);
  return exchange(w, requester, {
    subject_token: subject.token,
    actor_token: actor.token,
    actor_token_type: ACCESS,
  });
}

function actOf(res: LightMyRequestResponse): unknown {
  const token = res.json<{ access_token: string }>().access_token;
  const claims: unknown = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  );
  return typeof claims === 'object' && claims !== null && 'act' in claims ? claims.act : undefined;
}

async function refusals(w: World) {
  return owner.db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, w.tenantId),
        eq(auditEvents.action, 'token.exchange'),
        eq(auditEvents.outcome, 'refused'),
      ),
    );
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
  http = Fastify();
  httpHandle = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock: { now: () => new Date() },
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpHandle?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('a public client and the exchange grant', () => {
  it('is refused with unauthorized_client by default, however valid its tokens', async () => {
    const w = await newWorld();
    const res = await delegation(w, w.public, w.public);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('is refused before any token is read, so garbage tokens answer the same', async () => {
    const w = await newWorld();
    const res = await exchange(w, w.public, {
      subject_token: 'garbage',
      actor_token: 'garbage',
      actor_token_type: ACCESS,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('is refused when impersonating too, since impersonation is allowed for it', async () => {
    const w = await newWorld();
    const subject = await tokenFor(w, w.confidential, w.ownerSubject);
    const res = await exchange(w, w.public, { subject_token: subject.token });
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('is served when its own setting is on and the actor token is its own', async () => {
    const w = await newWorld({}, { allowedForPublic: true });
    const res = await delegation(w, w.public, w.public);
    expect(res.statusCode).toBe(200);
    expect(actOf(res)).toEqual({ sub: w.actorSubject });
  });

  it('is still refused an actor token of another client when only the public setting is on', async () => {
    const w = await newWorld({}, { allowedForPublic: true });
    const res = await delegation(w, w.public, w.peer);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('is served an actor token of another client when both settings are on', async () => {
    const w = await newWorld({}, { allowedForPublic: true, actorFromOtherClient: true });
    expect((await delegation(w, w.public, w.peer)).statusCode).toBe(200);
  });

  it('is not made public-friendly by the confidential client having the setting on', async () => {
    const w = await newWorld({ allowedForPublic: true });
    const res = await delegation(w, w.public, w.public);
    expect(res.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('is not served by a setting that belongs to a client of another tenant', async () => {
    const open = await newWorld({}, { allowedForPublic: true });
    const closed = await newWorld();
    expect((await delegation(open, open.public, open.public)).statusCode).toBe(200);
    expect((await delegation(closed, closed.public, closed.public)).statusCode).toBe(400);
  });
});

describe('an actor token that belongs to another client', () => {
  it('is refused by default, and the refusal is audited as an invalid grant', async () => {
    const w = await newWorld();
    const res = await delegation(w, w.confidential, w.peer);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    const rows = await refusals(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorClientId: w.confidential.id,
      detail: { reason: 'invalid_grant' },
    });
  });

  it('is accepted when the requesting client has the setting on', async () => {
    const w = await newWorld({ actorFromOtherClient: true });
    const res = await delegation(w, w.confidential, w.peer);
    expect(res.statusCode).toBe(200);
    expect(actOf(res)).toEqual({ sub: w.actorSubject });
  });

  it("is refused when it is a service account's client_credentials token", async () => {
    const w = await newWorld();
    const subject = await tokenFor(w, w.confidential, w.ownerSubject);
    const actor = await tokenFor(w, w.peer, w.peerServiceSubject, 'reports:read');
    const res = await exchange(w, w.confidential, {
      subject_token: subject.token,
      actor_token: actor.token,
      actor_token_type: ACCESS,
    });
    expect(res.statusCode).toBe(400);
  });

  it('is refused as a refresh token too', async () => {
    const w = await newWorld();
    const subject = await tokenFor(w, w.confidential, w.ownerSubject);
    const actor = await tokenFor(w, w.peer, w.actorSubject);
    const raw = `refresh-${newId()}`;
    await withTenant(app.db, w.tenantId, (tx) =>
      refreshTokenRepository(tx).create({
        tokenHash: hashRefreshToken(raw),
        tenantId: w.tenantId,
        grantId: actor.grantId,
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );
    const res = await exchange(w, w.confidential, {
      subject_token: subject.token,
      actor_token: raw,
      actor_token_type: REFRESH,
    });
    expect(res.statusCode).toBe(400);
  });

  it("is still accepted when it is the requesting client's own", async () => {
    const w = await newWorld();
    expect((await delegation(w, w.confidential, w.confidential)).statusCode).toBe(200);
  });

  it('does not loosen the refusal of a revoked actor grant', async () => {
    const w = await newWorld({ actorFromOtherClient: true });
    const subject = await tokenFor(w, w.confidential, w.ownerSubject);
    const actor = await tokenFor(w, w.peer, w.actorSubject);
    await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(actor.grantId, new Date()),
    );
    const res = await exchange(w, w.confidential, {
      subject_token: subject.token,
      actor_token: actor.token,
      actor_token_type: ACCESS,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the built-in clients', () => {
  it('have neither setting on', async () => {
    const tenantId = newId();
    const rows = await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `builtin-${newId()}` });
      await provisionTenant(tx, tenantId);
      const admin = await provisionAdminClient(tx, tenantId);
      const mcp = await provisionMcpClient(tx, tenantId);
      const configs = clientOidcConfigRepository(tx);
      return [await configs.byClientId(admin.clientDbId), await configs.byClientId(mcp.id)];
    });
    for (const config of rows) {
      expect(config).toMatchObject({
        tokenExchangeAllowedForPublic: false,
        tokenExchangeActorFromOtherClient: false,
      });
    }
  });
});
