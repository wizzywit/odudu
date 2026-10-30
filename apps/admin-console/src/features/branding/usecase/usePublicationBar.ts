import type { ThemeView } from '@odudu/contracts/admin';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  revertTarget,
  type PublicationHolds,
  type PublishOutcome,
  type ScopedTab,
  type ThemeScope,
} from '#/features/branding/service';
import { usePublication, type Publication } from '#/features/branding/usecase/usePublication';
import { usePublicationHolds } from '#/features/branding/usecase/usePublicationHolds';
import { useRevert, type Revert } from '#/features/branding/usecase/useRevert';
import { useThemeDiscard } from '#/features/branding/usecase/useThemeDiscard';
import type { Removal } from '#/shared/usecase/useConfirmedChange';

export interface PublicationBar {
  publication: Publication;
  discard: Removal;
  // Taking the tab being shown back to published, which the bar offers where
  // it is too narrow to leave that to the tab's own panel, and only on a tab
  // that has parts to take back.
  revert: Revert;
  revertOffered: boolean;
  // The tab a revert from the bar takes back.
  revertTab: ScopedTab;
  // Why each action is held, which a running write does to all of them.
  holds: PublicationHolds;
}

// What every tab shares: publishing the saved draft whole, and dropping it.
// The contrast pairs read the saved colours, which is what a publish checks.
export function usePublicationBar({
  tenant,
  scope,
  view,
  tag,
  tab,
  published,
  onPublished,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  // The tab being shown.
  tab: string;
  published: PublishOutcome;
  onPublished: (outcome: PublishOutcome) => void;
}): PublicationBar {
  const writes = useThemeWrites(tenant, scope);
  const holds = usePublicationHolds(tenant, scope, view);
  const target = revertTarget(tab);
  return {
    revert: useRevert({ tenant, scope, view, tag, tab: target.tab }),
    revertOffered: target.offered,
    revertTab: target.tab,
    holds,
    publication: usePublication({
      tenant,
      scope,
      tag,
      hold: holds.publish,
      writes,
      outcome: published,
      onOutcome: onPublished,
    }),
    discard: useThemeDiscard(tenant, scope, tag, writes),
  };
}
