import { fetchMetadata } from '#/adapter/discovery';
import { DiscoveryCache } from '#/services/discovery-cache';
import type { Deps, ServerMetadata } from '#/types';

const cache = new DiscoveryCache();

// An issuer's metadata, from the cache while it is fresh and from the issuer
// otherwise. A request that fails is not kept. The cache is shared by every
// caller in the process. A result fetched with `allowInsecureRequests` is
// kept apart, so a caller that did not ask for it never receives it; a result
// fetched through a custom `fetch` is not, so callers that use different
// `fetch` members for one issuer share what the first one read.
export function readMetadata(issuer: string, deps: Deps): Promise<ServerMetadata> {
  const key = `${deps.allowInsecureRequests === true ? 'insecure:' : ''}${issuer}`;
  const now = (deps.now ?? Date.now)();
  const cached = cache.get(key, now);
  if (cached !== undefined) return cached;
  const request = fetchMetadata(issuer, deps);
  cache.set(key, request, now);
  request.catch(() => {
    cache.drop(key, request);
  });
  return request;
}
