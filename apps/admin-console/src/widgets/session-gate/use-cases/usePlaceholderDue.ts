import { PLACEHOLDER_DELAY_MS } from '#/entities/session';
import { useElapsed } from '#/widgets/session-gate/use-cases/useElapsed';

// Whether the session has been read for long enough that a placeholder is
// better than a blank page.
export function usePlaceholderDue(): boolean {
  return useElapsed(PLACEHOLDER_DELAY_MS);
}
