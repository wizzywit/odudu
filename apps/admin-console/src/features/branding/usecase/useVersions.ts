import type { ListThemeVersionsResponse } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { useThemeVersions } from '#/features/branding/repository/useThemeVersions';
import type { ThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  restoreFailure,
  RESTORED_TOAST,
  type ThemeScope,
  type VersionRow,
  writeCapability,
} from '#/features/branding/service';
import { useToast } from '#/shared/repository/useToasts';
import type { Read } from '#/shared/service/read';
import { useConfirmedChange, type Confirming } from '#/shared/usecase/useConfirmedChange';

export interface Versions {
  read: Read<ListThemeVersionsResponse>;
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
