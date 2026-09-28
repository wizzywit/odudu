import { QueryClient } from '@tanstack/react-query';

// The transport already retries a GET with backoff, and decides per method
// whether a write may be repeated at all; a Query retry on top would
// multiply the first and override the second.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: true, retry: false },
      mutations: { retry: false },
    },
  });
}
