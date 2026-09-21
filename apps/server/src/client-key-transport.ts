import {
  MAX_JWKS_BYTES,
  type ClientKeyRequest,
  type ClientKeyResponse,
} from '@odudu/protocol-oidc';
import { isIPv6 } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';

export type { ClientKeyRequest, ClientKeyResponse };

/** `clientKeySet`'s own `lookup`: every address a hostname resolves to, for `assertPublicAddresses` to check. */
export async function defaultClientKeyLookup(hostname: string): Promise<readonly string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

export interface ClientKeyTransportOptions {
  /** Bounds the TCP connect and TLS handshake, not the whole exchange. */
  readonly connectTimeoutMs?: number;
  /** Bounds the request end-to-end, including a slow or trickling body. */
  readonly totalTimeoutMs?: number;
  /** Bytes read from the response stream before the request is destroyed. */
  readonly maxBodyBytes?: number;
  /**
   * Replaces the default trusted root store with this CA — Node's `ca`
   * does not add to the well-known set, it overrides it — so this is for
   * a test's own self-signed server, never a production trust anchor.
   */
  readonly ca?: string | Buffer;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
// The one cap on a fetched JWK Set, shared with client-keys.ts's own check
// on the same bytes — this transport reads the response stream that check
// runs against, so the two must not drift on the number.
const DEFAULT_MAX_BODY_BYTES = MAX_JWKS_BYTES;

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// The only `node:https` call in this repository. `lookup` connects to the
// address the caller already checked, never a fresh resolution of
// `url.hostname` — the rejected alternative in ADR 0028, since nothing
// then guarantees the two lookups agree. `servername` and `Host` stay on
// the hostname throughout, so certificate validation and virtual hosting
// are unaffected by the pin.
export function createClientKeyRequest(options: ClientKeyTransportOptions = {}): ClientKeyRequest {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const ca = options.ca;

  return (url, address) =>
    new Promise<ClientKeyResponse>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
        fn();
      };
      const fail = (err: Error): void => {
        finish(() => {
          req.destroy();
          reject(err);
        });
      };

      const port = url.port === '' ? 443 : Number(url.port);

      const req = httpsRequest({
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: url.hostname,
        headers: { Host: url.host, Accept: 'application/json, application/jwk-set+json' },
        // No connection pooling across pinned addresses — each call gets
        // its own socket, so a reused keep-alive connection can never
        // carry an earlier call's pin into a later one's hostname.
        agent: false,
        ...(ca === undefined ? {} : { ca }),
        // Resolves to the address the caller already checked, never to a
        // fresh DNS answer for `url.hostname` — see the module comment.
        // Node's own connect path asks for every address at once
        // (`options.all`) since it added happy-eyeballs dual-stack
        // connect; there is only ever the one checked address to offer it.
        lookup: (_hostname, lookupOptions, callback) => {
          const family = isIPv6(address) ? 6 : 4;
          if (lookupOptions.all === true) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
      });

      const connectTimer = setTimeout(() => {
        fail(new Error(`connection to ${url.hostname} timed out before it was established`));
      }, connectTimeoutMs);

      const totalTimer = setTimeout(() => {
        fail(new Error(`fetching ${url.hostname} exceeded the total time budget`));
      }, totalTimeoutMs);

      req.on('socket', (socket) => {
        socket.once('secureConnect', () => {
          clearTimeout(connectTimer);
        });
      });

      req.on('error', (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            res.destroy();
            fail(new Error(`response from ${url.hostname} exceeded the body size cap`));
          } else {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          finish(() => {
            resolve({
              status: res.statusCode ?? 0,
              contentType: firstHeaderValue(res.headers['content-type']),
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        });

        res.on('error', (err) => {
          fail(err instanceof Error ? err : new Error(String(err)));
        });
      });

      req.end();
    });
}
