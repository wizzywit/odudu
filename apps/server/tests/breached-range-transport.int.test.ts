import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  breachedHash,
  remoteBreachedSource,
  concurrencyLimiter,
  REMOTE_BREACHED_HOST,
} from '@odudu/domain-identity';
import { breachedRangeRequest, createBreachedRangeFetch } from '#/breached-range-transport';

let workDir: string;
let cert: string;
let key: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'breached-range-'));
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
    `/CN=${REMOTE_BREACHED_HOST}`,
    '-addext',
    `subjectAltName=DNS:${REMOTE_BREACHED_HOST}`,
  ]);
  cert = readFileSync(certPath, 'utf8');
  key = readFileSync(keyPath, 'utf8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let server: Server | undefined;

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<number>((resolve) => {
    server = createServer({ cert, key }, handler);
    server.listen(0, '127.0.0.1', () => {
      resolve((server?.address() as AddressInfo).port);
    });
  });
}

afterEach(async () => {
  const closing = server;
  server = undefined;
  if (closing === undefined) return;
  closing.closeAllConnections();
  await new Promise<void>((resolve) => {
    closing.close(() => {
      resolve();
    });
  });
});

// The fixed host with this server's port: the certificate and the Host header
// are the real host's. The address guard refuses loopback whatever the
// settings, so the lookup names a public address and the connection, which
// is the same request the server builds, is pinned to the stub instead.
function fetchTo() {
  return createBreachedRangeFetch({
    lookup: () => Promise.resolve(['203.0.113.7']),
    requestFor: (limit) => (url) => breachedRangeRequest(limit, cert)(url, '127.0.0.1'),
  });
}

describe('the range lookup over a real TLS connection', () => {
  it('sends a bare GET of the prefix, padded, with nothing that identifies the caller', async () => {
    const seen: {
      method?: string | undefined;
      url?: string | undefined;
      headers?: IncomingMessage['headers'];
      body: string;
    } = { body: '' };
    const port = await startServer((req, res) => {
      seen.method = req.method;
      seen.url = req.url;
      seen.headers = req.headers;
      req.on('data', (chunk: Buffer) => {
        seen.body += chunk.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ABCDEF0123456789ABCDEF0123456789ABC:2');
      });
    });

    const response = await fetchTo()(
      new URL(`https://${REMOTE_BREACHED_HOST}:${String(port)}/range/5BAA6`),
      { timeoutMs: 3000, maxBytes: 4096 },
    );

    expect(response).toEqual({ status: 200, body: 'ABCDEF0123456789ABCDEF0123456789ABC:2' });
    expect(seen.method).toBe('GET');
    expect(seen.url).toBe('/range/5BAA6');
    expect(seen.body).toBe('');
    expect(seen.headers?.['add-padding']).toBe('true');
    for (const name of ['cookie', 'authorization', 'user-agent', 'referer', 'x-forwarded-for']) {
      expect(seen.headers?.[name], name).toBeUndefined();
    }
  });

  it('refuses an answer longer than the cap, as a failed lookup', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('A'.repeat(10_000));
    });

    await expect(
      fetchTo()(new URL(`https://${REMOTE_BREACHED_HOST}:${String(port)}/range/5BAA6`), {
        timeoutMs: 3000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/size cap/u);
  });

  it('gives up on a host that never answers, within the timeout', async () => {
    const port = await startServer(() => undefined);
    const started = Date.now();

    await expect(
      fetchTo()(new URL(`https://${REMOTE_BREACHED_HOST}:${String(port)}/range/5BAA6`), {
        timeoutMs: 300,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/time/u);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads a suffix from the answer end to end through the source', async () => {
    const { prefix, suffix } = breachedHash('a password the stub knows');
    const port = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(
        req.url === `/range/${prefix}`
          ? `${suffix}:5\r\nABCDEF0123456789ABCDEF0123456789ABC:0`
          : 'ABCDEF0123456789ABCDEF0123456789ABC:0',
      );
    });
    const real = fetchTo();
    const source = remoteBreachedSource({
      tenantId: 't',
      limiter: concurrencyLimiter(2),
      // The source names the default port; the stub listens on its own.
      fetchRange: (url, limit) => {
        const local = new URL(url);
        local.port = String(port);
        return real(local, limit);
      },
    });

    expect(await source.isBreached('a password the stub knows')).toBe(true);
    expect(await source.isBreached('a password nobody lists')).toBe(false);
  });
});
