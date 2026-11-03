import { useRefusal } from '#/entities/session';
import type { ThemeWrites } from '#/features/branding-editor/repository/useThemeWrites';
import { DISCARD_DONE, discardFailure } from '#/features/branding-editor/services/discardDraft';
import { writeCapability, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

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
