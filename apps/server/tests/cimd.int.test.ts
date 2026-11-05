import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  type DatabaseHandle,
} from '@odudu/db';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createCimdRequest } from '#/client-key-transport';
import { createLogger } from '#/logger';

// The whole path with a real TLS server for the client's document: the
// address guard stays on, and only the resolver and the connect target are
// swapped, which is the seam the application exposes for this.

const KEK = Buffer.alloc(32, 7);
const PASSWORD = 'correct horse battery staple';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CLIENT_HOST = 'notes-client.invalid.test';
const PUBLIC_ADDRESS = '93.184.216.34';
const SUFFIX = '/.well-known/oauth-authorization-server';

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let guarded: FastifyInstance;
let workDir: string;
let documentServer: Server;
let port: number;
let served = 0;
let tenantName: string;
let tenantId: string;
let username: string;

function clientUrl(): string {
  return `https://${CLIENT_HOST}:${String(port)}/oauth/client.json`;
}
const callback = () => `https://${CLIENT_HOST}:${String(port)}/callback`;

function document(req: IncomingMessage, res: ServerResponse): void {
  served += 1;
  if (req.url !== '/oauth/client.json') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=300' });
  res.end(
    JSON.stringify({
      client_id: clientUrl(),
      client_name: 'Notes',
      redirect_uris: [callback()],
    }),
  );
}

function build(transport?: Parameters<typeof buildApp>[0]['cimdTransport']): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    tls: false,
    throttle: { limit: 100_000, windowSeconds: 60 },
    ...(transport === undefined ? {} : { cimdTransport: transport }),
  });
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cimd-int-'));
  const keyPath = join(workDir, 'key.pem');
  const certPath = join(workDir, 'cert.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-nodes',
    '-subj',
    `/CN=${CLIENT_HOST}`,
    '-addext',
    `subjectAltName=DNS:${CLIENT_HOST}`,
  ]);
  const cert = readFileSync(certPath, 'utf8');
  documentServer = createServer({ cert, key: readFileSync(keyPath, 'utf8') }, document);
  await new Promise<void>((resolve) => documentServer.listen(0, '127.0.0.1', resolve));
  port = (documentServer.address() as AddressInfo).port;

  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');

  const real = createCimdRequest({ ca: cert });
  app = build({
    lookup: () => Promise.resolve([PUBLIC_ADDRESS]),
    request: (url) => real(url, '127.0.0.1'),
  });
  guarded = build();
  await app.ready();
  await guarded.ready();

  tenantName = `cimd-${newId()}`;
  username = `u${newId().slice(-8)}`;
  const seeded = await seed({
    tenant: tenantName,
    clientId: 'portal',
    redirectUris: ['https://portal.example/callback'],
    username,
    password: PASSWORD,
  });
  tenantId = seeded.tenantId;
}, 180_000);

afterAll(async () => {
  await app.close();
  await guarded.close();
  await new Promise<void>((resolve) => {
    documentServer.close(() => {
      resolve();
    });
  });
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

function setCimd(enabled: boolean): Promise<unknown> {
  return owner.db.update(tenants).set({ cimdEnabled: enabled }).where(eq(tenants.id, tenantId));
}

function authorize(
  server: FastifyInstance,
  id: string,
  redirectUri: string,
): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri,
    state: 'xyz',
    scope: 'openid',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return server.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

async function signIn(res: LightMyRequestResponse): Promise<LightMyRequestResponse> {
  const session = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1] ?? '';
  return app.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: session,
      username,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('Client ID Metadata Documents served over TLS', () => {
  it('[CIMD-5-01] advertises support only while the tenant has them on', async () => {
    await setCimd(false);
    const off = await app.inject({ url: `${SUFFIX}/tenants/${tenantName}` });
    expect(off.json<Record<string, unknown>>()).not.toHaveProperty(
      'client_id_metadata_document_supported',
    );

    await setCimd(true);
    const on = await app.inject({ url: `${SUFFIX}/tenants/${tenantName}` });
    expect(on.json<Record<string, unknown>>().client_id_metadata_document_supported).toBe(true);
    expect(
      on.json<{ token_endpoint_auth_methods_supported: string[] }>()
        .token_endpoint_auth_methods_supported,
    ).toContain('none');
  });

  it('[CIMD-4-01] fetches the document at the client_id and reaches consent', async () => {
    await setCimd(true);
    const first = await signIn(await authorize(app, clientUrl(), callback()));
    expect(first.statusCode, first.body).toBe(200);
    expect(first.body).toContain('Notes');
    expect(first.body).toContain(`${CLIENT_HOST}:${String(port)}`);
    expect(first.body).toContain(callback());
  });

  it('[CIMD-4.4-02] caches the document for the lifetime its Cache-Control gives', async () => {
    await setCimd(true);
    await authorize(app, clientUrl(), callback());
    served = 0;
    await authorize(app, clientUrl(), callback());
    expect(served).toBe(0);
  });

  it('refuses a redirect address the document does not list', async () => {
    await setCimd(true);
    const res = await authorize(app, clientUrl(), 'https://evil.example/callback');
    expect(res.statusCode).toBe(400);
  });

  it('is refused with the setting off, as an unknown client is', async () => {
    await setCimd(false);
    const asUrl = await authorize(app, clientUrl(), callback());
    const asUnknown = await authorize(app, 'no-such-client', callback());
    expect(asUrl.statusCode).toBe(400);
    expect(asUrl.body).toBe(asUnknown.body);
  });

  it('[CIMD-6.5-02] never connects to a local name, with no setting to allow it', async () => {
    await setCimd(true);
    served = 0;
    const id = `https://client.localhost:${String(port)}/oauth/client.json`;
    const res = await authorize(guarded, id, `https://client.localhost:${String(port)}/callback`);
    expect(res.statusCode).toBe(400);
    expect(served).toBe(0);
  });
});
