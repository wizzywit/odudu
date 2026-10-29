import { useRefusal } from '#/features/session';
import type { ThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  DISCARD_DONE,
  discardFailure,
  writeCapability,
  type ThemeScope,
} from '#/features/branding/service';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/usecase/useConfirmedChange';

// The saved draft dropped, behind a confirmation that says what stays.
export function useThemeDiscard(
  tenant: string,
  scope: ThemeScope,
  tag: string,
  writes: ThemeWrites,
): Removal {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  return useConfirmedRemoval({
    refusal,
    capability: writeCapability(scope),
    change: { busy: writes.discard.busy, run: () => writes.discard.run(tag) },
    failureText: discardFailure,
    done: () => {
      toast.succeeded(DISCARD_DONE);
    },
  });
}
