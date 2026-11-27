import { assistantStatusKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';

// Reads the assistant's status again, for a change that may have switched it
// on or off for the tenant. The key stays out of the pages' hands.
export function useRefreshAssistantStatus(tenant: string): () => void {
  const { invalidateExact } = useInvalidate();
  return () => {
    invalidateExact(assistantStatusKey(tenant));
  };
}
