import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClientKeyRequest } from '#/client-key-transport';

// `.invalid` is reserved by RFC 2606 and never resolves. The hostname below
// names no real host on purpose: if the transport ever let Node re-resolve
// it instead of connecting to the address it was handed, every test here
// would fail with ENOTFOUND rather than proving the pin.
const PINNED_HOSTNAME = 'jwks-pinned.invalid.test';

let workDir: string;
let cert: string;
let key: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'client-key-transport-'));
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
    `/CN=${PINNED_HOSTNAME}`,
    '-addext',
    `subjectAltName=DNS:${PINNED_HOSTNAME}`,
  ]);
  cert = readFileSync(certPath, 'utf8');
  key = readFileSync(keyPath, 'utf8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let server: Server | undefined;

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; address: string }> {
  return new Promise((resolve) => {
    server = createServer({ cert, key }, handler);
    server.listen(0, '127.0.0.1', () => {
      const info = server?.address() as AddressInfo;
      resolve({ port: info.port, address: '127.0.0.1' });
    });
  });
}

afterEach(async () => {
  if (server === undefined) return;
  await new Promise<void>((resolve) => {
    server?.close(() => {
      resolve();
    });
  });
  server = undefined;
});

describe('createClientKeyRequest', () => {
  it('connects to the checked address, not to a second resolution of the hostname', async () => {
    let sawHost: string | undefined;
    const { port, address } = await startServer((req, res) => {
      sawHost = req.headers.host;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"keys":[]}');
    });

    const request = createClientKeyRequest({ ca: cert });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/keys`);

    const response = await request(url, address);

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({ keys: [] });
    // The certificate validated against the hostname (no rejectUnauthorized
    // override), and the server saw that same hostname as Host — proving
    // both halves: packets to the checked address, identity on the name.
    expect(sawHost).toBe(`${PINNED_HOSTNAME}:${String(port)}`);
  });

  it('rejects when the certificate does not match the pinned hostname', async () => {
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });

    const request = createClientKeyRequest({ ca: cert });
    // A different hostname than the one the certificate was issued for —
    // TLS verification must still refuse this even though the address is
    // reachable and the CA is trusted.
    const url = new URL(`https://impostor.invalid.test:${String(port)}/keys`);

    await expect(request(url, address)).rejects.toThrow();
  });

  it('caps the response body at the stream and destroys the request', async () => {
    const oversized = 'x'.repeat(2000);
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(oversized);
    });

    const request = createClientKeyRequest({ ca: cert, maxBodyBytes: 1000 });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/keys`);

    await expect(request(url, address)).rejects.toThrow(/cap|too large|exceed/iu);
  });

  it('rejects a response that trickles forever, once the total timeout elapses', async () => {
    // The handshake completes and headers arrive — the connect timeout is
    // satisfied — but the body never does. Only the total timeout, a
    // separate budget covering the whole exchange, can bound this.
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"keys":[');
      // Deliberately never calls res.end().
    });

    const request = createClientKeyRequest({
      ca: cert,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 200,
    });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/keys`);

    await expect(request(url, address)).rejects.toThrow(/timed out|timeout|budget/iu);
  });

  it('rejects a connection that never completes, once the connect timeout elapses', async () => {
    // A server that accepts the TCP connection but never sends TLS bytes —
    // the socket hangs during the handshake, which is what a connect
    // timeout (as opposed to a total timeout on an established connection)
    // has to bound.
    const { createServer: createRawServer } = await import('node:net');
    const raw = createRawServer((socket) => {
      // Resumed so the socket notices the client's teardown once its
      // connect timeout fires — otherwise it sits paused and `raw.close`
      // below waits forever for a `close` event it never emits.
      socket.resume();
      socket.on('error', () => {
        // Ignore — the client tears the socket down once its timeout fires.
      });
    });
    await new Promise<void>((resolve) => {
      raw.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const info = raw.address() as AddressInfo;

    const request = createClientKeyRequest({
      ca: cert,
      connectTimeoutMs: 200,
      totalTimeoutMs: 5000,
    });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(info.port)}/keys`);

    await expect(request(url, '127.0.0.1')).rejects.toThrow(/timed out|timeout/iu);

    await new Promise<void>((resolve) => {
      raw.close(() => {
        resolve();
      });
    });
  });
});
