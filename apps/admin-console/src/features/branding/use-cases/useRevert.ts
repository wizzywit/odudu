import type { ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import { revertHoldOf } from '#/features/branding/services/holds';
import {
  announceRevert,
  revertAnswered,
  revertAnswerOf,
  revertDefected,
  type RevertAnswer,
  revertRequest,
  revertSection,
  shownRevertConflicts,
} from '#/features/branding/services/publication';
import { writeCapability, type ThemeScope } from '#/features/branding/services/themeScope';
import type { ScopedTab } from '#/features/branding/services/tabs';
import { usePublicationHolds } from '#/features/branding/use-cases/usePublicationHolds';
import { useToast } from '#/shared/repository/useToasts';
import type { Conflict } from '#/shared/services/conflict';
import { reportFailure } from '#/shared/services/settled';

export interface Revert {
  busy: boolean;
  // Why Revert is held, when it is.
  hold: string | undefined;
  // What the server said of the last revert it refused.
  problem: string | null;
  // The pieces somebody else changed in the draft since it was read, beside
  // what the revert would write, once the server has refused it as stale.
  conflicts: Conflict[];
  section: string;
  revert: () => void;
  takeTheirs: () => void;
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
  const [answer, setAnswer] = useState<RevertAnswer | null>(null);
  const { problem, stale } = revertAnswerOf(answer, tab);
  return {
    busy: writes.revert.busy,
    hold: revertHoldOf(holds, tab),
    problem,
    conflicts: shownRevertConflicts(stale, view, tab),
    section: revertSection(tab),
    takeTheirs: () => {
      setAnswer(null);
    },
    revert: () => {
      setAnswer(null);
      writes.revert
        .run({ body: revertRequest(view, tab), tag })
        .then((result) => {
          announceRevert(result, toast.succeeded);
          setAnswer(revertAnswered(tab, result));
          reportFailure(result, (failure) => {
            refusal.report(failure, writeCapability(scope));
          });
        })
        .catch(() => {
          setAnswer(revertDefected(tab));
        });
    },
  };
}
