import { PLACEHOLDER_DELAY_MS } from '#/features/session/services';
import { useElapsed } from '#/features/session/use-cases/useElapsed';

// Whether the session has been read for long enough that a placeholder is
// better than a blank page.
export function usePlaceholderDue(): boolean {
  return useElapsed(PLACEHOLDER_DELAY_MS);
}
