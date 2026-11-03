import { useQueryClient, type QueryKey } from '@tanstack/react-query';

// A failed refetch is the next read's to show: the client's invalidation
// does not reject on one. It is fire-and-forget at its callers (a retry, a
// reread and an after-change hook return void or the write's own result, and
// awaiting a refetch would hold that answer back).
export function useInvalidate() {
  const client = useQueryClient();
  return {
    // Every query under each key's prefix is read again.
    invalidate: (...keys: readonly QueryKey[]): void => {
      for (const queryKey of keys) {
        client.invalidateQueries({ queryKey });
      }
    },
    // Only the query at exactly this key.
    invalidateExact: (queryKey: QueryKey): void => {
      client.invalidateQueries({ queryKey, exact: true });
    },
  };
}
