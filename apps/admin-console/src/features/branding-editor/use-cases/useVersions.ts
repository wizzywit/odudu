import type { ThemeVersions } from '#/features/branding-editor/types/themeVersion';
import { useRefusal } from '#/entities/session';
import { useThemeVersions } from '#/features/branding-editor/repository/useThemeVersions';
import type { ThemeWrites } from '#/features/branding-editor/repository/useThemeWrites';
import { restoreFailure } from '#/features/branding-editor/services/writeFailures';
import { writeCapability, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { RESTORED_TOAST, type VersionRow } from '#/features/branding-editor/services/versions';
import { useToast } from '#/shared/repository/useToasts';
import type { Read } from '#/shared/services/read';
import { useConfirmedChange, type Confirming } from '#/shared/use-cases/useConfirmedChange';

export interface Versions {
  read: Read<ThemeVersions>;
  restoring: Confirming<VersionRow>;
}

// The versions kept, and the restore of one behind a confirmation.
export function useVersions(tenant: string, scope: ThemeScope, writes: ThemeWrites): Versions {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const read = useThemeVersions(tenant, scope, true);
  const restoring = useConfirmedChange<VersionRow, unknown>({
    refusal,
    capability: writeCapability(scope),
    change: { busy: writes.restore.busy, run: (row) => writes.restore.run(row.id) },
    failureText: restoreFailure,
    done: () => {
      toast.succeeded(RESTORED_TOAST);
    },
  });
  return { read, restoring };
}
