import {
  assertFetchableUrl,
  assertPublicAddresses,
  type LogoutDeliveryResponse,
  type LogoutDeliveryTransport,
} from '@odudu/protocol-oidc';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIPv6 } from 'node:net';
import { request as httpsRequest } from 'node:https';

/** Posts to a checked, already-resolved address — never a hostname to re-resolve. */
export type RawLogoutDeliveryRequest = (
  url: URL,
  address: string,
  logoutToken: string,
  signal: AbortSignal,
) => Promise<LogoutDeliveryResponse>;

export interface RawLogoutDeliveryRequestOptions {
  /** Bytes read from the response stream before the request is destroyed. */
  readonly maxBodyBytes?: number;
  /**
   * Replaces the default trusted root store with this CA — a test's own
   * self-signed server, never a production trust anchor. See
   * `client-key-transport.ts`'s identical field.
   */
  readonly ca?: string | Buffer;
}

// A Logout Token delivery reads nothing from the response but its status
// (OIDC Back-Channel Logout 1.0 §2.6), so this only has to be large enough
// to admit an ordinary error page a misconfigured relying party might
// answer with — not a payload this pass ever parses.
const DEFAULT_MAX_BODY_BYTES = 16_384;

/**
 * The raw POST, following `client-key-transport.ts`'s own pinned-`lookup`
 * shape: connects to `address` regardless of what a later DNS answer for
 * `url.hostname` would be (ADR 0028). Takes the caller's `signal` as the
 * exchange's one deadline rather than a connect timeout of its own —
 * `client-key-transport.ts` owns one because nothing hands it a signal.
 */
export function createRawLogoutDeliveryRequest(
  options: RawLogoutDeliveryRequestOptions = {},
): RawLogoutDeliveryRequest {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const ca = options.ca;

  return (url, address, logoutToken, signal) =>
    new Promise<LogoutDeliveryResponse>((resolve, reject) => {
      const body = `logout_token=${encodeURIComponent(logoutToken)}`;
      const port = url.port === '' ? 443 : Number(url.port);

      const req = httpsRequest({
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        servername: url.hostname,
        headers: {
          Host: url.host,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        // No connection pooling across pinned addresses — see
        // `client-key-transport.ts`'s identical comment on `agent: false`.
        agent: false,
        signal,
        ...(ca === undefined ? {} : { ca }),
        lookup: (_hostname, lookupOptions, callback) => {
          const family = isIPv6(address) ? 6 : 4;
          if (lookupOptions.all === true) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
      });

      // `client-key-transport.ts`'s identical guard: without it, a
      // body-cap rejection racing the socket's own `error` event could
      // settle this promise twice, and neither settling leaves `req`
      // itself torn down — only the response stream this file used to
      // destroy on its own.
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(err);
      };

      req.on('error', (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      req.on('response', (res) => {
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            fail(new Error(`response from ${url.hostname} exceeded the body size cap`));
          }
        });

        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ status: res.statusCode ?? 0 });
        });

        res.on('error', (err) => {
          fail(err instanceof Error ? err : new Error(String(err)));
        });
      });

      req.end(body);
    });
}

export interface LogoutDeliveryTransportOptions extends RawLogoutDeliveryRequestOptions {
  /** Resolved addresses, never a hostname — see `createRawLogoutDeliveryRequest`. */
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  /** A back-channel endpoint is client-registered, so this defaults closed. */
  readonly allowPrivate?: boolean;
  /** Overrides the raw poster this builds by default — a test's own fake. */
  readonly request?: RawLogoutDeliveryRequest;
}

async function defaultLookup(hostname: string): Promise<readonly string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/**
 * Posts a Logout Token to a relying party's back-channel endpoint, pinning
 * the connection to a checked address the way `clientKeySet` does for a
 * `jwks_uri` (ADR 0028) — `backchannel_logout_uri` is client-registered and
 * never re-validated for address afterwards, so in a realm with open
 * registration it is exactly as attacker-influenced.
 */
export function createLogoutDeliveryTransport(
  options: LogoutDeliveryTransportOptions = {},
): LogoutDeliveryTransport {
  const lookup = options.lookup ?? defaultLookup;
  const request = options.request ?? createRawLogoutDeliveryRequest(options);
  const allowPrivateOption =
    options.allowPrivate === undefined ? {} : { allowPrivate: options.allowPrivate };

  return async (endpoint, logoutToken, signal) => {
    const url = assertFetchableUrl(endpoint);
    const addresses = await lookup(url.hostname);
    assertPublicAddresses(addresses, allowPrivateOption);
    const [address] = addresses;
    if (address === undefined) {
      throw new Error(`${endpoint} did not resolve to any address`);
    }

    return request(url, address, logoutToken, signal);
  };
}
