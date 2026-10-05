import { PLACEHOLDER_DELAY_MS } from '#/features/session/service.ts';
import { useElapsed } from '#/shared/usecase/useElapsed.ts';

// Whether the session has been read for long enough that a placeholder is
// better than a blank page.
export function usePlaceholderDue(): boolean {
  return useElapsed(PLACEHOLDER_DELAY_MS);
}
