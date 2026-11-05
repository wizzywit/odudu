import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createServer, type Server } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchCimdDocument, ResponseTimedOut, ResponseTooLarge } from '@odudu/protocol-oidc';
import { createClientKeyRequest, createCimdRequest } from '#/client-key-transport';

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
    // reachable and the CA is trusted. The specific TLS error code, not a
    // bare throw, is what rules out ENOTFOUND/ECONNREFUSED passing for the
    // wrong reason.
    const url = new URL(`https://impostor.invalid.test:${String(port)}/keys`);

    await expect(request(url, address)).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });

  it('caps the response body at the stream, tearing the connection down before the writes finish', async () => {
    // 64KB chunks, up to ~50MB, streamed continuously with no `res.end()` —
    // a cap checked only after the body is fully materialised (`Buffer.concat`
    // then measured) would never even see this response finish, since it
    // never does. Only a cap enforced chunk-by-chunk as bytes arrive can
    // reject this quickly, well short of the full 50MB.
    const CHUNK = 'x'.repeat(64 * 1024);
    const TOTAL_CHUNKS = 800;
    let chunksWritten = 0;
    let socketClosedEarly = false;

    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.on('error', () => {
        // The client tears the socket down once its cap is exceeded.
      });
      res.socket?.once('close', () => {
        socketClosedEarly = chunksWritten < TOTAL_CHUNKS;
      });

      const writeNext = (): void => {
        if (res.destroyed || chunksWritten >= TOTAL_CHUNKS) return;
        chunksWritten += 1;
        if (res.write(CHUNK)) {
          setImmediate(writeNext);
        } else {
          res.once('drain', writeNext);
        }
      };
      writeNext();
    });

    const request = createClientKeyRequest({ ca: cert, maxBodyBytes: 1000 });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/keys`);

    await expect(request(url, address)).rejects.toThrow(/exceeded the body size cap/u);

    // Let the server's socket observe the client's teardown before checking
    // it — the cap fires on the client side first, by construction.
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(socketClosedEarly).toBe(true);
    expect(chunksWritten).toBeLessThan(TOTAL_CHUNKS);
  }, 10000);

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

    // The connect timeout is generous (5s) and would not fire in time — only
    // the total timeout's own message proves it, not the connect timeout's
    // or the two collapsed into one budget, which would also pass a looser
    // assertion here.
    await expect(request(url, address)).rejects.toThrow(/exceeded the total time budget/u);
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

    // The total timeout is generous (5s) and would not fire in time — only
    // the connect timeout's own message proves it fired, not the total
    // timeout's or the two collapsed into one budget.
    await expect(request(url, '127.0.0.1')).rejects.toThrow(/timed out before it was established/u);

    await new Promise<void>((resolve) => {
      raw.close(() => {
        resolve();
      });
    });
  });
});

describe('createCimdRequest', () => {
  const urlFor = (port: number): URL =>
    new URL(`https://${PINNED_HOSTNAME}:${String(port)}/client.json`);

  it('returns the Cache-Control header and asks for JSON', async () => {
    let accept: string | undefined;
    const { port, address } = await startServer((req, res) => {
      accept = req.headers.accept;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' });
      res.end('{}');
    });
    const response = await createCimdRequest({ ca: cert })(urlFor(port), address);
    expect(response).toMatchObject({ status: 200, cacheControl: 'max-age=60' });
    expect(accept).toBe('application/json');
  });

  it('stops reading at five KiB while the body is still streaming', async () => {
    let writes = 0;
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.on('error', () => undefined);
      const next = (): void => {
        if (res.destroyed) return;
        writes += 1;
        res.write('x'.repeat(1024));
        setImmediate(next);
      };
      next();
    });
    await expect(createCimdRequest({ ca: cert })(urlFor(port), address)).rejects.toBeInstanceOf(
      ResponseTooLarge,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settled = writes;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(writes).toBe(settled);
  });

  it('reports a body that never ends as a timeout', async () => {
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    });
    await expect(
      createCimdRequest({ ca: cert, totalTimeoutMs: 200 })(urlFor(port), address),
    ).rejects.toBeInstanceOf(ResponseTimedOut);
  });

  it('sends no accept-encoding and refuses a gzip body it did not decode, through the fetcher', async () => {
    let encoding: string | string[] | undefined;
    const { port } = await startServer((req, res) => {
      encoding = req.headers['accept-encoding'];
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(gzipSync('{"a":1}'));
    });
    const transport = createCimdRequest({ ca: cert });
    const outcome = await fetchCimdDocument(urlFor(port).href, {
      // The guard sees a public answer; the connection goes to the test server.
      lookup: () => Promise.resolve(['93.184.216.34']),
      request: (url) => transport(url, '127.0.0.1'),
      now: () => new Date(),
    });
    expect(encoding).toBeUndefined();
    expect(outcome).toEqual({ kind: 'refused', reason: 'not_json' });
  });

  it('hands a redirect back unfollowed', async () => {
    let followed = false;
    const { port, address } = await startServer((req, res) => {
      if (req.url === '/elsewhere') followed = true;
      res.writeHead(302, { location: '/elsewhere' });
      res.end();
    });
    const response = await createCimdRequest({ ca: cert })(urlFor(port), address);
    expect(response.status).toBe(302);
    expect(followed).toBe(false);
  });
});
