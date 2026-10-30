import { useRefusal } from '#/features/session';
import type { ThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  resetFailure,
  RESET_DONE,
  writeCapability,
  type ThemeScope,
} from '#/features/branding/service';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/usecase/useConfirmedChange';

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
