import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';

export interface FreshRead {
  pending: boolean;
  read: <T>(queryKey: QueryKey, queryFn: () => Promise<T>) => Promise<T>;
}

// A read that has to reach the server each time it is asked: a confirmation
// of what a write whose answer was lost did, or a document saved as it
// arrives. It is a query (`query`, which replaces the deprecated
// `fetchQuery`), so it is never mistaken for a write, but nothing is answered
// from the cache or kept in it afterwards.
export function useFreshRead(): FreshRead {
  const client = useQueryClient();
  const [running, setRunning] = useState(0);
  return {
    pending: running > 0,
    read: async (queryKey, queryFn) => {
      setRunning((count) => count + 1);
      try {
        return await client.query({ queryKey, queryFn, staleTime: 0, gcTime: 0, retry: false });
      } finally {
        client.removeQueries({ queryKey, exact: true });
        setRunning((count) => count - 1);
      }
    },
  };
}
