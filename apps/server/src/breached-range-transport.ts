import { DEFAULT_POOL_MAX } from '@odudu/db';
import { REMOTE_BREACHED_HOST, type RangeFetch, type RangeLimit } from '@odudu/domain-identity';
import { assertPublicAddresses, type ClientKeyRequest } from '@odudu/protocol-oidc';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createClientKeyRequest } from '#/client-key-transport';

/**
 * Remote lookups in flight across every tenant. A lookup holds no database
 * connection, so this bounds the outbound requests, and the sockets and timers
 * they hold, that anonymous forms can start at once; it sits below the pool
 * size so lookups never outnumber the work the pool serves.
 */
export const BREACHED_LOOKUPS_IN_PROCESS = DEFAULT_POOL_MAX - 2;

export interface BreachedRangeFetchOptions {
  /** Every address the host resolves to, checked before any is connected to. */
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  /** The development escape hatch of ADR 0028; production refuses to start with it on. */
  readonly allowPrivate?: boolean;
  /** Replaces the trusted roots, for a test's own server. */
  readonly ca?: string | Buffer;
  /** Builds the pinned request for one lookup's bounds; a test's own fake. */
  readonly requestFor?: (limit: RangeLimit) => ClientKeyRequest;
}

const RANGE_PATH = /^\/range\/[0-9A-F]{5}$/;

async function defaultLookup(hostname: string): Promise<readonly string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/** The pinned request, bounded, padded, with no header beyond `Host` and `Accept`. */
export function breachedRangeRequest(limit: RangeLimit, ca?: string | Buffer): ClientKeyRequest {
  return createClientKeyRequest({
    maxBodyBytes: limit.maxBytes,
    totalTimeoutMs: limit.timeoutMs,
    connectTimeoutMs: limit.timeoutMs,
    accept: 'text/plain',
    headers: { 'Add-Padding': 'true' },
    ...(ca === undefined ? {} : { ca }),
  });
}

/**
 * The range lookup's GET, for `remoteBreachedSource`. It names one host and
 * one path shape, connects to an address that was checked and no other (ADR
 * 0028), carries no cookie, credential or body, and asks for padded answers.
 */
export function createBreachedRangeFetch(options: BreachedRangeFetchOptions = {}): RangeFetch {
  const lookup = options.lookup ?? defaultLookup;
  const requestFor =
    options.requestFor ?? ((limit: RangeLimit) => breachedRangeRequest(limit, options.ca));

  return async (url, limit) => {
    if (url.hostname !== REMOTE_BREACHED_HOST) {
      throw new Error(`a breached-password lookup goes to the fixed host, not ${url.hostname}`);
    }
    if (!RANGE_PATH.test(url.pathname) || url.search !== '' || url.hash !== '') {
      throw new Error('a breached-password lookup is a GET of /range/ and five hex characters');
    }
    const addresses = await lookup(url.hostname);
    assertPublicAddresses(addresses, { allowPrivate: options.allowPrivate ?? false });
    const [address] = addresses;
    if (address === undefined) throw new Error(`${url.hostname} did not resolve to any address`);
    const response = await requestFor(limit)(url, address);
    return { status: response.status, body: response.body };
  };
}
