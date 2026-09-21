import formbody from '@fastify/formbody';
import { provisionRealm } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type LightMyRequestResponse,
} from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NO_CLIENT_KEY_FETCHER, oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let trusted: FastifyInstance | undefined;
let untrusted: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const KEK = Buffer.alloc(32, 17);
const NOW = new Date('2026-09-21T00:00:00Z');
const SUBJECT_DN = 'CN=client-a,O=Example';

let REALM: string;
let REALM_ID: string;
let serviceSubjectId: string;
let logLines: unknown[] = [];

async function createClient(
  tx: RealmScopedDatabase,
  input: {
    clientId: string;
    method: 'tls_client_auth' | 'client_secret_basic';
    subjectDn?: string;
    enabled?: boolean;
    type?: 'public' | 'confidential';
  },
): Promise<void> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    realmId: REALM_ID,
    clientId: input.clientId,
    name: input.clientId,
    type: input.type ?? 'confidential',
    enabled: input.enabled ?? true,
    // clients_secret_matches_type requires a confidential client to carry
    // one; tls_client_auth never reads it.
    secretHash:
      (input.type ?? 'confidential') === 'confidential' ? await hashPassword('unused') : null,
    serviceSubjectId,
  });
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    realmId: REALM_ID,
    redirectUris: [],
    grantTypes: ['client_credentials'],
    tokenEndpointAuthMethod: input.method,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    tlsClientAuthSubjectDn: input.subjectDn ?? null,
  });
}

async function buildServer(deps: { trustProxy: boolean }): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = pino(
    { level: 'info' },
    { write: (line: string) => logLines.push(JSON.parse(line)) },
  );
  const http = Fastify({ loggerInstance: logger });
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      clock: { now: () => NOW },
      trustProxy: deps.trustProxy,
    }),
  );
  await http.ready();
  return http;
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

  REALM = `tca-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);

    const serviceSubject = await subjectRepository(tx).create({
      realmId: REALM_ID,
      type: 'service',
    });
    serviceSubjectId = serviceSubject.id;

    await createClient(tx, {
      clientId: 'tls-client',
      method: 'tls_client_auth',
      subjectDn: SUBJECT_DN,
    });
    await createClient(tx, {
      clientId: 'disabled-tls-client',
      method: 'tls_client_auth',
      subjectDn: SUBJECT_DN,
      enabled: false,
    });
    await createClient(tx, {
      clientId: 'basic-client',
      method: 'client_secret_basic',
    });
    await createClient(tx, {
      clientId: 'public-tls-client',
      method: 'tls_client_auth',
      subjectDn: SUBJECT_DN,
      type: 'public',
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

  trusted = await buildServer({ trustProxy: true });
  untrusted = await buildServer({ trustProxy: false });
}, 120_000);

afterAll(async () => {
  await trusted?.close();
  await untrusted?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

beforeEach(() => {
  logLines = [];
});

function certHeader(subjectDn: string): Record<string, string> {
  return { 'x-ssl-client-s-dn': subjectDn };
}

function lastLoggedReason(): string | undefined {
  const entry = [...logLines]
    .reverse()
    .find(
      (line): line is { reason: string; msg: string } =>
        typeof line === 'object' &&
        line !== null &&
        'msg' in line &&
        line.msg === 'tls_client_auth authentication refused',
    );
  return entry?.reason;
}

async function token(input: {
  server?: FastifyInstance;
  client?: string;
  headers?: Record<string, string>;
}): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  if (input.client !== undefined) form.set('client_id', input.client);

  const server = input.server ?? trusted;
  if (server === undefined) throw new Error('server not ready');
  return server.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(input.headers ?? {}) },
  });
}

const REFUSAL = { error: 'invalid_client' };

describe('[RFC8705-2.1-03] tls_client_auth at /token', () => {
  it('authenticates a client whose registered subject matches the header', async () => {
    const res = await token({ client: 'tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(200);
  });

  it('refuses when the registered subject differs', async () => {
    const res = await token({ client: 'tls-client', headers: certHeader('CN=someone-else') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    // Proves this refusal actually ran the comparison, rather than the
    // header being silently ignored some other way.
    expect(lastLoggedReason()).toBe('certificate subject does not match the registered value');
  });

  it('refuses the method entirely when ODUDU_TRUST_PROXY is off', async () => {
    // Same 401 and body as the subject-mismatch case above (the shared
    // invalid_client shape), but for a different reason: with no trusted
    // proxy, tlsClientSubject returns null, so this falls back to ordinary
    // client authentication, refusing a confidential client that presented
    // no client_secret. `lastLoggedReason` below is what actually tells the
    // two apart, since the response bytes cannot.
    if (untrusted === undefined) throw new Error('server not ready');
    const res = await token({
      server: untrusted,
      client: 'tls-client',
      headers: certHeader(SUBJECT_DN),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBeUndefined();
  });

  it('refuses an unknown client', async () => {
    const res = await token({ client: 'no-such-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('unknown client');
  });

  it('refuses a disabled client even with a matching subject', async () => {
    const res = await token({ client: 'disabled-tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is disabled');
  });

  it('refuses a client not registered for tls_client_auth', async () => {
    const res = await token({ client: 'basic-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is not registered for tls_client_auth');
  });

  it('refuses a public client even if registered with tls_client_auth', async () => {
    const res = await token({ client: 'public-tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is not confidential');
  });

  it('refuses no client_id presented alongside the certificate', async () => {
    const res = await token({ headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('no client_id presented alongside the certificate');
  });

  it('refuses a certificate presented alongside a client_secret', async () => {
    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    form.set('client_id', 'basic-client');
    form.set('client_secret', 'unused');
    const server = trusted;
    if (server === undefined) throw new Error('server not ready');
    const res = await server.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      payload: form.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...certHeader(SUBJECT_DN),
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe(
      'certificate presented alongside another authentication method',
    );
  });

  it('refuses a duplicated header even for a matching subject', async () => {
    // What arrives when two devices set this header is Node's own join with
    // ", " (verified empirically — tls-client-auth.ts's own comment), not an
    // array; this fixture mirrors that shape.
    const res = await token({
      client: 'tls-client',
      headers: { 'x-ssl-client-s-dn': `${SUBJECT_DN}, CN=attacker` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    // Falls back to ordinary client authentication, same as the
    // untrusted-proxy case: tlsClientSubject already returned null, so
    // authenticateTlsClientAuth never ran and logged nothing.
    expect(lastLoggedReason()).toBeUndefined();
  });
});
