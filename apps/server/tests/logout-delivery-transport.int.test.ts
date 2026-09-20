import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRawLogoutDeliveryRequest } from '#/logout-delivery-transport';

// `.invalid` is reserved by RFC 2606 and never resolves. As in
// `client-key-transport.int.test.ts`, this proves the raw request connects
// to the address it is handed, not to a fresh resolution of this hostname.
const PINNED_HOSTNAME = 'logout-pinned.invalid.test';
const TOKEN = 'signed-logout-token';

let workDir: string;
let cert: string;
let key: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'logout-delivery-transport-'));
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

describe('createRawLogoutDeliveryRequest', () => {
  it('[OIDC-BACKCHANNEL-2.5-01] posts the logout token as form-urlencoded and returns the status', async () => {
    let sawBody = '';
    let sawContentType: string | undefined;
    const { port, address } = await startServer((req, res) => {
      sawContentType = req.headers['content-type'];
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        sawBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200);
        res.end();
      });
    });

    const request = createRawLogoutDeliveryRequest({ ca: cert });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/backchannel`);

    const response = await request(url, address, TOKEN, new AbortController().signal);

    expect(response.status).toBe(200);
    expect(sawContentType).toBe('application/x-www-form-urlencoded');
    expect(sawBody).toBe(`logout_token=${TOKEN}`);
  });

  it('honours the caller-supplied signal as the exchange deadline, not a timer of its own', async () => {
    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200);
      res.write('still waiting');
      // Deliberately never calls res.end() — only the caller's own
      // deadline can end this exchange; grep confirms no setTimeout here.
    });

    const request = createRawLogoutDeliveryRequest({ ca: cert });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/backchannel`);

    await expect(request(url, address, TOKEN, AbortSignal.timeout(200))).rejects.toThrow();
  });

  it('caps the response body at the stream, tearing the connection down', async () => {
    const CHUNK = 'x'.repeat(64 * 1024);
    const TOTAL_CHUNKS = 800;
    let chunksWritten = 0;
    let socketClosed = false;
    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const { port, address } = await startServer((_req, res) => {
      res.writeHead(200);
      res.on('error', () => {
        // The client tears the socket down once its cap is exceeded.
      });
      // Without `createRawLogoutDeliveryRequest`'s own `req.destroy()`, the
      // client stops reading but never closes the connection, so this
      // event never fires and the assertion below times out fast rather
      // than the test hanging for the file's 120s afterEach hook (which
      // waits for every open connection before `server.close()` resolves).
      res.socket?.once('close', () => {
        socketClosed = true;
        resolveClosed();
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

    const request = createRawLogoutDeliveryRequest({ ca: cert, maxBodyBytes: 1000 });
    const url = new URL(`https://${PINNED_HOSTNAME}:${String(port)}/backchannel`);

    await expect(request(url, address, TOKEN, new AbortController().signal)).rejects.toThrow(
      /exceeded the body size cap/u,
    );
    expect(chunksWritten).toBeLessThan(TOTAL_CHUNKS);

    const timedOut = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          resolve(true);
        }, 2000);
      }),
    ]);
    expect(timedOut).toBe(false);
    expect(socketClosed).toBe(true);
  }, 10000);
});
