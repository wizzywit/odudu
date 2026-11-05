import { isIP } from 'node:net';
import { type CimdFetchOutcome, type CimdFetchRefusal } from '#/service/cimd-fetch-outcome';
import { cimdCacheSeconds } from '#/service/cimd-cache-control';
import {
  assertFetchableUrl,
  assertPublicAddresses,
  RemoteAddressRefused,
} from '#/service/remote-address';

export const CIMD_MAX_BODY_BYTES = 5 * 1024;
export const CIMD_DEADLINE_MS = 3_000;

export class ResponseTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseTooLarge';
  }
}

export class ResponseTimedOut extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseTimedOut';
  }
}

export interface CimdResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly body: string;
}

// Connects to `address`, which the caller has already checked, never to a
// second resolution of the URL's host; the transport is where that pin lives.
export type CimdRequest = (url: URL, address: string) => Promise<CimdResponse>;

export interface CimdFetchDeps {
  readonly lookup: (hostname: string) => Promise<readonly string[]>;
  readonly request: CimdRequest;
  readonly now: () => Date;
  readonly deadlineMs?: number;
}

class Refused extends Error {
  readonly reason: CimdFetchRefusal;

  constructor(reason: CimdFetchRefusal) {
    super(reason);
    this.reason = reason;
  }
}

function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isLocalName(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost');
}

function isJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  return (contentType.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ResponseTimedOut('the document was not fetched within its deadline'));
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}

async function checkedAddress(url: URL, lookup: CimdFetchDeps['lookup']): Promise<string> {
  const host = bareHost(url.hostname);
  if (isLocalName(host)) {
    throw new Refused('private_address');
  }
  const addresses = isIP(host) === 0 ? await lookup(host) : [host];
  assertPublicAddresses(addresses);
  const [address] = addresses;
  if (address === undefined) {
    throw new Refused('unreachable');
  }
  return address;
}

async function fetchChecked(url: URL, deps: CimdFetchDeps): Promise<CimdResponse> {
  const address = await checkedAddress(url, deps.lookup);
  return deps.request(url, address);
}

function refusalOf(error: unknown): CimdFetchRefusal {
  if (error instanceof Refused) {
    return error.reason;
  }
  if (error instanceof RemoteAddressRefused) {
    return 'private_address';
  }
  if (error instanceof ResponseTooLarge) {
    return 'too_large';
  }
  if (error instanceof ResponseTimedOut) {
    return 'timeout';
  }
  return 'unreachable';
}

function interpret(response: CimdResponse, now: Date): CimdFetchOutcome {
  if (response.status >= 300 && response.status < 400) {
    throw new Refused('redirect');
  }
  if (response.status !== 200) {
    throw new Refused('status');
  }
  if (!isJson(response.contentType)) {
    throw new Refused('not_json');
  }
  if (Buffer.byteLength(response.body, 'utf8') > CIMD_MAX_BODY_BYTES)
    throw new Refused('too_large');
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Refused('not_json');
  }
  const seconds = cimdCacheSeconds(response.cacheControl);
  return {
    kind: 'ok',
    body,
    cacheable: seconds !== null,
    expiresAt: new Date(now.getTime() + (seconds ?? 0) * 1000),
  };
}

export async function fetchCimdDocument(
  rawUrl: string,
  deps: CimdFetchDeps,
): Promise<CimdFetchOutcome> {
  let url: URL;
  try {
    url = assertFetchableUrl(rawUrl);
  } catch {
    return { kind: 'refused', reason: 'url_refused' };
  }
  try {
    const response = await withDeadline(
      fetchChecked(url, deps),
      deps.deadlineMs ?? CIMD_DEADLINE_MS,
    );
    return interpret(response, deps.now());
  } catch (error) {
    return { kind: 'refused', reason: refusalOf(error) };
  }
}
