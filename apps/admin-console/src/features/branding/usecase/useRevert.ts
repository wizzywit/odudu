import type { ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  announceRevert,
  revertFailure,
  revertHoldOf,
  revertProblem,
  revertRequest,
  writeCapability,
  type ScopedTab,
  type ThemeScope,
} from '#/features/branding/service';
import { usePublicationHolds } from '#/features/branding/usecase/usePublicationHolds';
import { useToast } from '#/shared/repository/useToasts';
import { reportFailure } from '#/shared/service/settled';

export interface Revert {
  busy: boolean;
  // Why Revert is held, when it is.
  hold: string | undefined;
  // What the server said of the last revert it refused.
  problem: string | null;
  revert: () => void;
}

// One tab's parts taken back to the published theme, in the saved draft.
export function useRevert({
  tenant,
  scope,
  view,
  tag,
  tab,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  tab: ScopedTab;
}): Revert {
  const writes = useThemeWrites(tenant, scope);
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const holds = usePublicationHolds(tenant, scope, view);
  const [problem, setProblem] = useState<string | null>(null);
  return {
    busy: writes.revert.busy,
    hold: revertHoldOf(holds, tab),
    problem,
    revert: () => {
      setProblem(null);
      writes.revert
        .run({ body: revertRequest(view, tab), tag })
        .then((result) => {
          announceRevert(result, toast.succeeded);
          setProblem(revertProblem(result));
          reportFailure(result, (failure) => {
            refusal.report(failure, writeCapability(scope));
          });
        })
        .catch(() => {
          setProblem(revertFailure({ ok: false, kind: 'defect' }));
        });
    },
  };
}
