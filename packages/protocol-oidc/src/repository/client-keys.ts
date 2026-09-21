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

// The transport's own shape — one definition, so apps/server's real
// implementation (client-key-transport.ts) and this repository's injected
// dependency cannot drift into two structurally-equal-but-separate types.
export type ClientKeyRequest = (url: URL, address: string) => Promise<ClientKeyResponse>;

export interface ClientKeyDeps {
  readonly lookup: (hostname: string) => Promise<readonly string[]>;
  readonly request: ClientKeyRequest;
  readonly now: () => Date;
  readonly allowPrivate?: boolean;
}

export interface ClientKeySet {
  fetch: (uri: string, realmId: string) => Promise<unknown>;
}

/** A parsed JWK Set document is capped here, before `JSON.parse` ever sees it. */
export const MAX_JWKS_BYTES = 1_000_000;

export const CACHE_TTL_MS = 300_000;

// Short on purpose: a URI that fails to fetch suppresses that client's
// private_key_jwt authentication until this entry expires, so the TTL is
// also the ceiling on how long anything that can make one fetch fail (a
// dead host, a firewall rule, a slow DNS server) can deny that client. It
// trades against re-hitting a genuinely dead jwks_uri on every attempt in
// between.
export const NEGATIVE_CACHE_TTL_MS = 30_000;

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

// A JWK Set is public and answers the same way for every realm, so a success
// is cached under the URI alone and one realm's clients warm it for another's.
// A failure is not: it would let one realm's transient outage suppress
// private_key_jwt for every other realm pointed at the same jwks_uri, so it
// is cached under this key instead. `uri` is always `https://…` (enforced by
// `assertFetchableUrl`) and `realmId` is a `realms.id uuid`
// (packages/db/src/schema/realms.ts), so `:` cannot appear in either half and
// the two can never collide with each other or with a bare success key.
function negativeCacheKey(realmId: string, uri: string): string {
  return `${realmId}:${uri}`;
}

// A map keyed on a URL the caller chooses is a memory-exhaustion vector,
// the same shape apps/server/src/throttle.ts bounds its key map against.
// Eviction is by write order, not use — a read never reinserts. A negative
// entry is rewritten ten times more often than a success (NEGATIVE_CACHE_TTL_MS
// versus CACHE_TTL_MS), so it sits younger in that order and a success is
// what a full cache evicts first. Accepted: the ceiling still needs 1000
// distinct realm/URI pairs, each naming a client registered — bearer-token-
// gated — in that realm, already the bigger problem.
const MAX_CACHE_ENTRIES = 1000;

type CacheEntry =
  | { readonly kind: 'success'; readonly body: unknown; readonly expiresAt: number }
  | { readonly kind: 'failure'; readonly error: unknown; readonly expiresAt: number };

// Keyed on the URI alone, not realm-scoped: a fetch attempt is a network
// operation, not a realm-scoped one, so two realms racing the same uri
// share one attempt, and each realm that joins it is recorded in `realms`
// so the attempt's own failure handler can write every joiner's negative
// entry before this map's entry is removed (see the handler below). Every
// entry is removed there too, so this map's size is bounded by
// concurrently in-flight fetches, never by the number of distinct URIs
// seen — no ceiling needed.
interface InFlightAttempt {
  readonly promise: Promise<unknown>;
  readonly realms: Set<string>;
}

export function clientKeySet(deps: ClientKeyDeps): ClientKeySet {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightAttempt>();

  const evictOldestIfFull = (): void => {
    if (cache.size < MAX_CACHE_ENTRIES) return;
    const oldest = cache.keys().next();
    if (oldest.done === false) cache.delete(oldest.value);
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
    // Checked in this order: the success cache, then the caller's own
    // negative cache entry, then in-flight. A cache entry for this uri and
    // its in-flight attempt are never both present at once — the handler
    // below writes the entry and clears `inFlight` in the same microtask —
    // so a genuine miss on all three is the only way to join or start a
    // fetch.
    fetch: async (uri: string, realmId: string): Promise<unknown> => {
      const now = deps.now().getTime();

      const success = cache.get(uri);
      if (success?.kind === 'success' && success.expiresAt > now) {
        return success.body;
      }

      const negativeKey = negativeCacheKey(realmId, uri);
      const negative = cache.get(negativeKey);
      if (negative?.kind === 'failure' && negative.expiresAt > now) {
        throw negative.error;
      }

      const existing = inFlight.get(uri);
      if (existing !== undefined) {
        existing.realms.add(realmId);
        return existing.promise;
      }

      const realms = new Set([realmId]);
      // One handler for both outcomes, not `.then(...).catch(...).finally(...)`:
      // a rejection's cache write and this map's own cleanup must land in the
      // same microtask, or a caller landing between them finds neither a
      // cache entry nor an in-flight attempt and starts a second fetch at a
      // uri that just failed — the regression a split `.catch`/`.finally`
      // produced. `realms` is read here, not when the caller joined, so every
      // realm that joined before this handler runs gets its own entry.
      const promise = fetchFresh(uri).then(
        (body) => {
          cache.delete(uri);
          evictOldestIfFull();
          cache.set(uri, { kind: 'success', body, expiresAt: deps.now().getTime() + CACHE_TTL_MS });
          inFlight.delete(uri);
          return body;
        },
        (error: unknown) => {
          const expiresAt = deps.now().getTime() + NEGATIVE_CACHE_TTL_MS;
          for (const realm of realms) {
            const key = negativeCacheKey(realm, uri);
            cache.delete(key);
            evictOldestIfFull();
            cache.set(key, { kind: 'failure', error, expiresAt });
          }
          inFlight.delete(uri);
          throw error;
        },
      );
      inFlight.set(uri, { promise, realms });
      return promise;
    },
  };
}
