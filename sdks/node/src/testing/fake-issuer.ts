import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JWK;
}

export async function testKey(kid: string): Promise<TestKey> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  return {
    kid,
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' },
  };
}

export interface FakeIssuer {
  issuer: string;
  keys: JWK[];
  discoveryRequests: number;
  jwksRequests: number;
  // The `jwks_uri` the discovery document names; the issuer's own `/jwks` when unset.
  jwksUri: string | undefined;
  // Answer the JWK Set with this status instead of the keys.
  jwksStatus: number;
  // Hold every JWK Set answer until released, to overlap requests.
  holdJwks: Promise<void> | undefined;
  // Answer this document with far more than any client should read, with or
  // without a declared length, and count what was written before the client
  // hung up.
  oversize: { path: 'jwks' | 'discovery'; declared: boolean } | undefined;
  bytesWritten: number;
  close: () => Promise<void>;
}

export const OVERSIZE_BYTES = 64 * 1024 * 1024;

function streamOversize(response: ServerResponse, fake: FakeIssuer, declared: boolean): void {
  const chunk = Buffer.alloc(65_536, 0x20);
  response.writeHead(200, {
    'content-type': 'application/json',
    ...(declared ? { 'content-length': String(OVERSIZE_BYTES) } : {}),
  });
  let sent = 0;
  const pump = (): void => {
    while (sent < OVERSIZE_BYTES && !response.destroyed) {
      const open = response.write(chunk);
      sent += chunk.length;
      fake.bytesWritten = sent;
      if (!open) {
        response.once('drain', pump);
        return;
      }
    }
    if (!response.destroyed) response.end();
  };
  pump();
}

export async function startFakeIssuer(keys: JWK[]): Promise<FakeIssuer> {
  const fake: FakeIssuer = {
    issuer: '',
    keys,
    discoveryRequests: 0,
    jwksRequests: 0,
    jwksUri: undefined,
    jwksStatus: 200,
    holdJwks: undefined,
    oversize: undefined,
    bytesWritten: 0,
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '';
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const document = path.endsWith('/jwks') ? 'jwks' : 'discovery';
    if (fake.oversize?.path === document) {
      if (document === 'jwks') fake.jwksRequests += 1;
      else fake.discoveryRequests += 1;
      streamOversize(response, fake, fake.oversize.declared);
      return;
    }
    if (path.endsWith('/.well-known/openid-configuration')) {
      fake.discoveryRequests += 1;
      send(200, { issuer: fake.issuer, jwks_uri: fake.jwksUri ?? `${fake.issuer}/jwks` });
      return;
    }
    if (path.endsWith('/jwks')) {
      fake.jwksRequests += 1;
      (fake.holdJwks ?? Promise.resolve()).then(
        () => {
          send(fake.jwksStatus, fake.jwksStatus === 200 ? { keys: fake.keys } : { error: 'down' });
        },
        () => {
          send(500, { error: 'held' });
        },
      );
      return;
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.issuer = `http://127.0.0.1:${String(port)}/tenants/demo`;
  fake.close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  return fake;
}

export function mintToken(
  key: TestKey,
  issuer: string,
  audience: string,
  nowSeconds: number,
): Promise<string> {
  return new SignJWT({ client_id: 'client-1', scope: 'reports:read' })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: key.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('subject-1')
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + 300)
    .sign(key.privateKey);
}
