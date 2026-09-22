import formbody from '@fastify/formbody';
import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type LightMyRequestResponse,
} from 'fastify';
import net from 'node:net';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NO_CLIENT_KEY_FETCHER, oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { CLIENT_ASSERTION_TYPE } from '#/service/client-assertion';
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
// RFC 2253's own escaping of an embedded comma keeps the space that
// follows it — the exact shape nginx's `$ssl_client_s_dn` emits, and a
// value the duplicate-header check below must never mistake for two.
const COMMA_SUBJECT_DN = 'CN=client-b,O=Example\\, Inc.';
const HEADER = 'x-ssl-client-s-dn';

let TENANT: string;
let TENANT_ID: string;
// A second, otherwise-independent tenant — the probe of whether
// `authenticateTlsClientAuth`'s `clientRepository(tx).byClientId` lookup is
// genuinely tenant-scoped (via `tx`'s `SET LOCAL app.tenant_id`) or could
// somehow reach across tenants, the same shape private-key-jwt.int.test.ts
// uses for `private_key_jwt`.
let TENANT_B: string;
let TENANT_B_ID: string;
let serviceSubjectId: string;
let logLines: unknown[] = [];

async function createClient(
  tx: TenantScopedDatabase,
  input: {
    clientId: string;
    method: 'tls_client_auth' | 'client_secret_basic';
    subjectDn?: string;
    enabled?: boolean;
    type?: 'public' | 'confidential';
    tenantId?: string;
    serviceSubjectId?: string;
  },
): Promise<void> {
  const dbId = newId();
  const tenantId = input.tenantId ?? TENANT_ID;
  await tx.insert(clients).values({
    id: dbId,
    tenantId,
    clientId: input.clientId,
    name: input.clientId,
    type: input.type ?? 'confidential',
    enabled: input.enabled ?? true,
    // clients_secret_matches_type: a public client carries no secret; every
    // confidential one here gets a real, checkable one — the one-method
    // tests below present it as a body `client_secret` or `Authorization:
    // Basic`.
    secretHash:
      (input.type ?? 'confidential') === 'confidential' ? await hashPassword('s3cret') : null,
    serviceSubjectId: input.serviceSubjectId ?? serviceSubjectId,
  });
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    tenantId,
    redirectUris: [],
    grantTypes: ['client_credentials'],
    tokenEndpointAuthMethod: input.method,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    tlsClientAuthSubjectDn: input.subjectDn ?? null,
  });
}

async function buildServer(deps: {
  trustProxy: boolean;
  tlsClientCertHeader?: string;
}): Promise<FastifyInstance> {
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
      ...(deps.tlsClientCertHeader === undefined
        ? {}
        : { tlsClientCertHeader: deps.tlsClientCertHeader }),
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

  TENANT = `tca-${newId()}`;
  TENANT_ID = newId();

  await withTenant(app.db, TENANT_ID, async (tx) => {
    await tx.insert(tenants).values({
      id: TENANT_ID,
      name: TENANT,
      // Open so the registration-gating test below can reach
      // registerClient at all — every other test in this file registers
      // clients directly and never touches this policy.
      clientRegistrationPolicy: 'open',
    });
    await provisionTenant(tx, TENANT_ID);

    const serviceSubject = await subjectRepository(tx).create({
      tenantId: TENANT_ID,
      type: 'service',
    });
    serviceSubjectId = serviceSubject.id;

    await createClient(tx, {
      clientId: 'tls-client',
      method: 'tls_client_auth',
      subjectDn: SUBJECT_DN,
    });
    await createClient(tx, {
      clientId: 'comma-client',
      method: 'tls_client_auth',
      subjectDn: COMMA_SUBJECT_DN,
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
      tenantId: TENANT_ID,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });

  TENANT_B = `tca-b-${newId()}`;
  TENANT_B_ID = newId();
  await withTenant(app.db, TENANT_B_ID, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_B_ID, name: TENANT_B });
    await provisionTenant(tx, TENANT_B_ID);

    const serviceSubjectB = await subjectRepository(tx).create({
      tenantId: TENANT_B_ID,
      type: 'service',
    });

    // Same OAuth client_id string as TENANT's own `tls-client`, a
    // deliberately *different* registered subject — if the lookup in
    // `authenticateTlsClientAuth` ever escaped tenant scoping, TENANT's
    // matching header would authenticate here too, against the wrong row.
    await createClient(tx, {
      clientId: 'tls-client',
      method: 'tls_client_auth',
      subjectDn: 'CN=tenant-b-client',
      tenantId: TENANT_B_ID,
      serviceSubjectId: serviceSubjectB.id,
    });

    const keyB = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: TENANT_B_ID,
      kid: keyB.kid,
      alg: keyB.alg,
      status: 'active',
      publicJwk: keyB.publicJwk,
      privateJwkEncrypted: keyB.privateJwkEncrypted,
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
  return { [HEADER]: subjectDn };
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
  tenant?: string;
  client?: string;
  headers?: Record<string, string>;
  extraForm?: Record<string, string>;
}): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  if (input.client !== undefined) form.set('client_id', input.client);
  for (const [key, value] of Object.entries(input.extraForm ?? {})) form.set(key, value);

  const server = input.server ?? trusted;
  if (server === undefined) throw new Error('server not ready');
  return server.inject({
    method: 'POST',
    url: `/tenants/${input.tenant ?? TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(input.headers ?? {}) },
  });
}

const REFUSAL = { error: 'invalid_client' };

describe('tls_client_auth at /token', () => {
  it('[RFC8705-2-03] authenticates a client whose registered subject matches the header', async () => {
    const res = await token({ client: 'tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(200);
  });

  // RFC 2253's own escaping of an embedded comma keeps the following
  // space — this is a certificate openssl would issue for an organization
  // named "Example, Inc.", sent exactly once, and it must authenticate
  // like any other.
  it('[RFC8705-2-03] authenticates a client whose subject contains a legitimate comma', async () => {
    const res = await token({ client: 'comma-client', headers: certHeader(COMMA_SUBJECT_DN) });
    expect(res.statusCode).toBe(200);
  });

  it('[RFC8705-2-03] refuses when the registered subject differs', async () => {
    const res = await token({ client: 'tls-client', headers: certHeader('CN=someone-else') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    // Proves this refusal actually ran the comparison, rather than the
    // header being silently ignored some other way.
    expect(lastLoggedReason()).toBe('certificate subject does not match the registered value');
  });

  it('[ODUDU-TLS-CLIENT-AUTH-TRUST-PROXY-01] refuses the method entirely when ODUDU_TRUST_PROXY is off', async () => {
    // Same 401 and body as the subject-mismatch case above (the shared
    // invalid_client shape), but for a different reason: with no trusted
    // proxy, tlsClientSubject returns "absent", so this falls back to
    // ordinary client authentication, refusing a confidential client that
    // presented no client_secret. `lastLoggedReason` below is what
    // actually tells the two apart, since the response bytes cannot.
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

  it('[RFC8705-2-02] refuses an unknown client', async () => {
    const res = await token({ client: 'no-such-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('unknown client');
  });

  it('[RFC8705-2-02] refuses a disabled client even with a matching subject', async () => {
    const res = await token({ client: 'disabled-tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is disabled');
  });

  it('[RFC8705-2-02] refuses a client not registered for tls_client_auth', async () => {
    const res = await token({ client: 'basic-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('client is not registered for tls_client_auth');
  });

  it('[RFC8705-2-02] refuses a public client even if registered with tls_client_auth', async () => {
    const res = await token({ client: 'public-tls-client', headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    // Status and body are indistinguishable from the confidentiality
    // check having never run (evaluateClientCredentialsGrant refuses a
    // public client downstream regardless) — this is what actually
    // proves the check above fired.
    expect(lastLoggedReason()).toBe('client is not confidential');
  });

  it('[RFC8705-2-01] refuses no client_id presented alongside the certificate', async () => {
    const res = await token({ headers: certHeader(SUBJECT_DN) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('no client_id presented alongside the certificate');
  });

  // The one-method-per-request rule, pinned against a fixture the rule
  // itself must be what refuses: `tls-client`'s certificate genuinely
  // matches its registered subject, so without this check the request
  // would otherwise succeed. `basic-client` above proves a different
  // thing — a client never registered for this method at all — and
  // cannot stand in for this case, since it is refused on its own merits
  // whether or not the one-method check runs.
  it.each([
    ['a client_secret', { client_secret: 's3cret' }, {}],
    [
      'Basic',
      {},
      { authorization: `Basic ${Buffer.from('tls-client:s3cret').toString('base64')}` },
    ],
    [
      'a client_assertion',
      { client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: 'not-a-real-jwt' },
      {},
    ],
  ] as const)(
    '[ODUDU-TLS-CLIENT-AUTH-ONE-METHOD-01] refuses a matching certificate presented alongside %s',
    async (_name, extraForm, extraHeaders) => {
      const res = await token({
        client: 'tls-client',
        headers: { ...certHeader(SUBJECT_DN), ...extraHeaders },
        extraForm,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REFUSAL);
      expect(lastLoggedReason()).toBe(
        'certificate presented alongside another authentication method',
      );
    },
  );

  // A genuinely duplicated header, verified over a real socket rather
  // than through `inject`'s own header folding (light-my-request joins an
  // array header value into one string before it ever reaches
  // `rawHeaders`, so it cannot reproduce two independent header lines —
  // only a raw connection can). A dedicated, short-lived listener, closed
  // within the test rather than left for `afterAll`.
  it('[ODUDU-TLS-CLIENT-AUTH-DUPLICATE-HEADER-01] refuses a header sent twice on the wire, and logs why', async () => {
    const probe = await buildServer({ trustProxy: true });
    try {
      const address = await probe.listen({ port: 0, host: '127.0.0.1' });
      const url = new URL(address);
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'tls-client',
      }).toString();
      const request = [
        `POST /tenants/${TENANT}/protocol/openid-connect/token HTTP/1.1`,
        `Host: ${url.host}`,
        'Content-Type: application/x-www-form-urlencoded',
        `Content-Length: ${String(Buffer.byteLength(body))}`,
        `X-SSL-Client-S-DN: ${SUBJECT_DN}`,
        `X-SSL-Client-S-DN: CN=attacker`,
        'Connection: close',
        '',
        body,
      ].join('\r\n');
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(url.port), url.hostname, () => {
          socket.write(request);
        });
        let data = '';
        socket.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
        });
        socket.on('error', reject);
        socket.on('close', () => {
          resolve(data);
        });
      });
      expect(response).toContain(' 401 ');
      expect(response).toContain('{"error":"invalid_client"}');
    } finally {
      await probe.close();
    }
    expect(lastLoggedReason()).toBe('certificate subject header presented more than once');
  });

  // The header name is configuration, not a constant — a deployment
  // behind a proxy that emits a different one must still work.
  it('[ODUDU-TLS-CLIENT-AUTH-HEADER-NAME-01] reads the subject from a deployment-configured header name', async () => {
    const custom = await buildServer({ trustProxy: true, tlsClientCertHeader: 'x-custom-cert-dn' });
    try {
      const res = await custom.inject({
        method: 'POST',
        url: `/tenants/${TENANT}/protocol/openid-connect/token`,
        payload: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'tls-client',
        }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-custom-cert-dn': SUBJECT_DN,
          // The default header name must not also be honoured once a
          // deployment has chosen a different one — this is the failure
          // mode that would make a misconfiguration look like it worked.
          [HEADER]: 'CN=should-be-ignored',
        },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await custom.close();
    }
  });

  // Tenant-scoping probe: same OAuth client_id string in both tenants, a
  // different registered subject in each — RLS (`tx`'s `SET LOCAL
  // app.tenant_id`) is what makes `clientRepository(tx).byClientId` in
  // `authenticateTlsClientAuth` see only the row for the tenant named in
  // the URL, never the other one.
  it("[ODUDU-TLS-CLIENT-AUTH-TENANT-ISOLATION-01] tenant B's client is unreachable through TENANT's own matching header", async () => {
    const res = await token({
      tenant: TENANT_B,
      client: 'tls-client',
      headers: certHeader(SUBJECT_DN),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(REFUSAL);
    expect(lastLoggedReason()).toBe('certificate subject does not match the registered value');
  });

  it("[ODUDU-TLS-CLIENT-AUTH-TENANT-ISOLATION-01] tenant B's own client authenticates against tenant B's own registered subject", async () => {
    const res = await token({
      tenant: TENANT_B,
      client: 'tls-client',
      headers: certHeader('CN=tenant-b-client'),
    });
    expect(res.statusCode).toBe(200);
  });

  // docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598:
  // registration is refused too, not only authentication — the untrusted
  // server never advertises the method, but a client could still try to
  // register one directly.
  it('[ODUDU-TLS-CLIENT-AUTH-REGISTRATION-GATE-01] refuses to register a tls_client_auth client when ODUDU_TRUST_PROXY is off', async () => {
    if (untrusted === undefined) throw new Error('server not ready');
    const res = await untrusted.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/clients-registrations/openid-connect`,
      payload: JSON.stringify({
        redirect_uris: [],
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: 'CN=new-client',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('[ODUDU-TLS-CLIENT-AUTH-REGISTRATION-GATE-01] registers a tls_client_auth client when ODUDU_TRUST_PROXY is on', async () => {
    if (trusted === undefined) throw new Error('server not ready');
    const registration = await trusted.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/clients-registrations/openid-connect`,
      payload: JSON.stringify({
        redirect_uris: [],
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: 'CN=new-client',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toMatchObject({
      token_endpoint_auth_method: 'tls_client_auth',
      tls_client_auth_subject_dn: 'CN=new-client',
    });
  });
});
