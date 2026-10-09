import { QueryClient } from '@tanstack/react-query';

// The transport already retries a GET with backoff, and decides per method
// whether a write may be repeated at all; a Query retry on top would
// multiply the first and override the second. A mutation's result is
// dropped as soon as nothing observes it, since it may carry a secret shown
// once, which never stays in the cache.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: true, retry: false },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}
