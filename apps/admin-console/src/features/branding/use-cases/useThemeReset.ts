import { useRefusal } from '#/entities/session';
import type { ThemeWrites } from '#/features/branding/repository/useThemeWrites';
import { resetFailure } from '#/features/branding/services/failures';
import { writeCapability, type ThemeScope } from '#/features/branding/services/themeScope';
import { RESET_DONE } from '#/features/branding/services/versions';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

// Back to the default theme, behind a confirmation that says what it removes.
export function useThemeReset(tenant: string, scope: ThemeScope, writes: ThemeWrites): Removal {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  return useConfirmedRemoval({
    refusal,
    capability: writeCapability(scope),
    change: writes.reset,
    failureText: resetFailure,
    done: () => {
      toast.succeeded(RESET_DONE);
    },
  });
}
