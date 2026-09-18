import { assertFetchableUrl, assertPublicAddresses } from '#/service/remote-address';

export class ClientKeySetRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ClientKeySetRefused';
  }
}

export interface ClientKeyResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

export interface ClientKeyDeps {
  readonly lookup: (hostname: string) => Promise<readonly string[]>;
  readonly request: (url: URL, address: string) => Promise<ClientKeyResponse>;
  readonly now: () => Date;
  readonly allowPrivate?: boolean;
}

export interface ClientKeySet {
  fetch: (uri: string) => Promise<unknown>;
}

/** A parsed JWK Set document is capped here, before `JSON.parse` ever sees it. */
export const MAX_JWKS_BYTES = 1_000_000;

const CACHE_TTL_MS = 300_000;

// RFC 7517 §8.5 registers `application/jwk-set+json` for a JWK Set; the
// OIDF conformance suite and most relying parties serve plain
// `application/json` instead. Both are accepted; the media type is taken
// only from before the first `;` (parameters such as `charset` follow it)
// and compared case-insensitively, never substring-matched against the raw
// header — which would also accept an unrelated type like `application/jsonish`.
const ACCEPTED_CONTENT_TYPES = new Set(['application/json', 'application/jwk-set+json']);

function acceptsContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return ACCEPTED_CONTENT_TYPES.has(mediaType);
}

// A map keyed on a URL the caller chooses is a memory-exhaustion vector,
// the same shape apps/server/src/throttle.ts bounds its key map against —
// but this is a different budget: a cache of resolved key sets, not a
// request-rate window, so it gets its own ceiling.
const MAX_CACHE_ENTRIES = 1000;

interface CacheEntry {
  readonly body: unknown;
  readonly expiresAt: number;
}

export function clientKeySet(deps: ClientKeyDeps): ClientKeySet {
  const cache = new Map<string, CacheEntry>();

  const evictColdestIfFull = (): void => {
    if (cache.size < MAX_CACHE_ENTRIES) return;
    const coldest = cache.keys().next();
    if (coldest.done === false) cache.delete(coldest.value);
  };

  const fetchFresh = async (uri: string): Promise<unknown> => {
    const url = assertFetchableUrl(uri);
    const addresses = await deps.lookup(url.hostname);
    assertPublicAddresses(
      addresses,
      deps.allowPrivate === undefined ? {} : { allowPrivate: deps.allowPrivate },
    );
    const [address] = addresses;
    if (address === undefined) {
      throw new ClientKeySetRefused(`${uri} did not resolve to any address`);
    }

    const response = await deps.request(url, address);
    if (response.status >= 300 && response.status < 400) {
      throw new ClientKeySetRefused(`${uri} answered with a redirect (${String(response.status)})`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ClientKeySetRefused(`${uri} answered with status ${String(response.status)}`);
    }
    if (!acceptsContentType(response.contentType)) {
      throw new ClientKeySetRefused(
        `${uri} answered with content type ${response.contentType ?? '(none)'}, not JSON`,
      );
    }
    if (Buffer.byteLength(response.body, 'utf8') > MAX_JWKS_BYTES) {
      throw new ClientKeySetRefused(`${uri} answered with a body too large to accept`);
    }

    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new ClientKeySetRefused(`${uri} did not answer with valid JSON`);
    }
  };

  return {
    fetch: async (uri: string): Promise<unknown> => {
      const cached = cache.get(uri);
      const now = deps.now().getTime();
      if (cached !== undefined && cached.expiresAt > now) {
        return cached.body;
      }

      const body = await fetchFresh(uri);

      cache.delete(uri);
      evictColdestIfFull();
      cache.set(uri, { body, expiresAt: now + CACHE_TTL_MS });
      return body;
    },
  };
}
