import { useRefusal } from '#/entities/session';
import type { ThemeWrites } from '#/features/branding-editor/repository/useThemeWrites';
import { resetFailure } from '#/features/branding-editor/services/writeFailures';
import { writeCapability, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import {
  RESET_DONE,
  resetWords,
  type ResetWords,
} from '#/features/branding-editor/services/versions';
import { useToast } from '#/shared/lib/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/lib/use-cases/useConfirmedChange';

export interface ThemeReset {
  removal: Removal;
  words: ResetWords;
}

// Back to the default theme, behind a confirmation that says what it removes.
export function useThemeReset(tenant: string, scope: ThemeScope, writes: ThemeWrites): ThemeReset {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const removal = useConfirmedRemoval({
    refusal,
    capability: writeCapability(scope),
    change: writes.reset,
    failureText: resetFailure,
    done: () => {
      toast.succeeded(RESET_DONE);
    },
  });
  return { removal, words: resetWords(scope) };
}
