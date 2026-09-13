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
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

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

const AUDIENCE = 'https://api.example';
const KEK = Buffer.alloc(32, 11);

let batchJobServiceSubjectId: string;

async function setupRealm(): Promise<void> {
  REALM = `client-credentials-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });

    const serviceSubject = await subjectRepository(tx).create({
      realmId: REALM_ID,
      type: 'service',
    });
    batchJobServiceSubjectId = serviceSubject.id;

    const batchJobDbId = newId();
    await tx.insert(clients).values({
      id: batchJobDbId,
      realmId: REALM_ID,
      clientId: 'batch-job',
      name: 'Batch job',
      type: 'confidential',
      secretHash: await hashPassword('s3cret'),
      serviceSubjectId: batchJobServiceSubjectId,
    });
    await clientOidcConfigRepository(tx).create({
      clientId: batchJobDbId,
      realmId: REALM_ID,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: ['reports:read'],
    });

    // A confidential client whose grant_types claims client_credentials but
    // which was never provisioned with a service_subject_id — the
    // configuration error the grant must refuse at request time rather than
    // silently minting a token with no one behind it.
    const unprovisionedDbId = newId();
    await tx.insert(clients).values({
      id: unprovisionedDbId,
      realmId: REALM_ID,
      clientId: 'unprovisioned-job',
      name: 'Unprovisioned job',
      type: 'confidential',
      secretHash: await hashPassword('anothersecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: unprovisionedDbId,
      realmId: REALM_ID,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: ['reports:read'],
    });

    // Registered for client_secret_post, so a credential it sends as a
    // request parameter is one this server will read — which is what makes
    // where the parameter sits the only thing under test in
    // RFC6749-2.3.1-02.
    const postingJobDbId = newId();
    await tx.insert(clients).values({
      id: postingJobDbId,
      realmId: REALM_ID,
      clientId: 'posting-job',
      name: 'Posting job',
      type: 'confidential',
      secretHash: await hashPassword('p0stsecret'),
      serviceSubjectId: batchJobServiceSubjectId,
    });
    await clientOidcConfigRepository(tx).create({
      clientId: postingJobDbId,
      realmId: REALM_ID,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_post',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: ['reports:read'],
    });

    const spaDbId = newId();
    await tx.insert(clients).values({
      id: spaDbId,
      realmId: REALM_ID,
      clientId: 'spa',
      name: 'Public SPA',
      type: 'public',
      secretHash: null,
    });
    await clientOidcConfigRepository(tx).create({
      clientId: spaDbId,
      realmId: REALM_ID,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'none',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: ['reports:read'],
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

  http = Fastify();
  await http.register(formbody);
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function clientCredentials(
  clientId: string,
  secret: string | null,
  scope?: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  if (scope !== undefined) form.set('scope', scope);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (secret === null) {
    form.set('client_id', clientId);
  } else {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
  }

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers,
  });
}

// Ordered pairs rather than an object, so a request can leave client_id or
// the credential out entirely instead of sending an empty one.
async function postToken(
  params: [string, string][],
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const body = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
}

function basicHeader(clientId: string, secret: string): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
  };
}

function decodePayload(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('[RFC6749-4.4-01] client credentials grant', () => {
  it('issues an access token for a confidential client', async () => {
    const res = await clientCredentials('batch-job', 's3cret', 'reports:read');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ scope: string }>().scope).toBe('reports:read');
  });

  it('[RFC6749-4.4.3-01] issues no refresh token', async () => {
    const res = await clientCredentials('batch-job', 's3cret');
    expect(res.json<{ refresh_token?: string }>().refresh_token).toBeUndefined();
  });

  it('issues no id token, because no person authenticated', async () => {
    const res = await clientCredentials('batch-job', 's3cret');
    expect(res.json<{ id_token?: string }>().id_token).toBeUndefined();
  });

  it('[RFC6749-4.4-02] refuses a public client', async () => {
    const res = await clientCredentials('spa', null);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('[RFC6749-3.3-02] refuses scope beyond what the client is allowed', async () => {
    const res = await clientCredentials('batch-job', 's3cret', 'admin');
    expect(res.json<{ error: string }>().error).toBe('invalid_scope');
  });

  it('sets sub to the client service-account subject', async () => {
    const res = await clientCredentials('batch-job', 's3cret', 'reports:read');
    const { access_token: accessToken } = res.json<{ access_token: string }>();
    expect(decodePayload(accessToken).sub).toBe(batchJobServiceSubjectId);
  });

  it('refuses a confidential client with no provisioned service subject', async () => {
    const res = await clientCredentials('unprovisioned-job', 'anothersecret', 'reports:read');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('unauthorized_client');
  });
});

// RFC 6749 §4.4.2 and §6 each require client authentication on their own
// grant. The obligation is per-grant, and a request that authenticates is
// carried alongside every refusal here so that the refusal is about the
// credential and not about the rest of the request.
describe('[RFC6749-4.4.2-01] client authentication on the client_credentials grant', () => {
  const grant: [string, string][] = [
    ['grant_type', 'client_credentials'],
    ['scope', 'reports:read'],
  ];

  it('issues a token to a confidential client presenting its registered secret', async () => {
    const res = await postToken(grant, basicHeader('batch-job', 's3cret'));
    expect(res.statusCode).toBe(200);
  });

  it('refuses the same request with a wrong secret', async () => {
    const res = await postToken(grant, basicHeader('batch-job', 'not-the-secret'));
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('refuses the same request from a client that names itself but presents no credential', async () => {
    const res = await postToken([...grant, ['client_id', 'batch-job']]);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('refuses the same request with no client identification at all', async () => {
    const res = await postToken(grant);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });
});

// RFC 6749 §2.3.1: credentials carried as request parameters go in the body
// and "MUST NOT be included in the request URI". The client half of that is
// unenforceable on its own — what makes it hold is a token endpoint that
// reads no credential from the query string, so a client that puts one
// there gets no authentication out of it, only a secret in the access log.
describe('[RFC6749-2.3.1-02] client credentials in the request URI authenticate nobody', () => {
  const grant: [string, string][] = [
    ['grant_type', 'client_credentials'],
    ['scope', 'reports:read'],
  ];

  async function postWithQuery(
    query: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const body = grant
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return http.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token?${new URLSearchParams(query).toString()}`,
      payload: body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    });
  }

  // posting-job is registered for client_secret_post: these exact two
  // parameters, sent in the body, authenticate it. Sent in the query string
  // instead they authenticate nobody, so the refusal is attributable to
  // where they were and to nothing else.
  it('refuses a client_secret_post credential that arrives in the query string', async () => {
    const res = await postWithQuery({ client_id: 'posting-job', client_secret: 'p0stsecret' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');

    const inTheBody = await postToken([
      ...grant,
      ['client_id', 'posting-job'],
      ['client_secret', 'p0stsecret'],
    ]);
    expect(inTheBody.statusCode).toBe(200);
  });

  // A query component is otherwise no obstacle: the same URL, with the
  // credential presented the way its client registered to present it, is
  // answered. A server that read the query string would see two
  // authentication methods here and refuse under §2.3.1.
  it('issues a token for the identical URL once the credential moves to the header', async () => {
    const res = await postWithQuery(
      { client_id: 'batch-job', client_secret: 's3cret' },
      basicHeader('batch-job', 's3cret'),
    );
    expect(res.statusCode).toBe(200);
  });
});
