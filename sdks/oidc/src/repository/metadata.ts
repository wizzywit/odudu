import { fetchMetadata } from '#/adapter/discovery';
import { DiscoveryCache } from '#/services/discovery-cache';
import type { Deps, ServerMetadata } from '#/types';

const cache = new DiscoveryCache();

// An issuer's metadata, from the cache while it is fresh and from the issuer
// otherwise. A request that fails is not kept.
export function readMetadata(issuer: string, deps: Deps): Promise<ServerMetadata> {
  const now = (deps.now ?? Date.now)();
  const cached = cache.get(issuer, now);
  if (cached !== undefined) return cached;
  const request = fetchMetadata(issuer, deps);
  cache.set(issuer, request, now);
  request.catch(() => {
    cache.drop(issuer, request);
  });
  return request;
}
