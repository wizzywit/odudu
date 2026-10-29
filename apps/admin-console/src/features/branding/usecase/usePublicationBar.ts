import type { ThemeView } from '@odudu/contracts/admin';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  colourValues,
  contrastReport,
  revertTarget,
  themeRecord,
  unsavedSections,
  type PublishOutcome,
  type ThemeScope,
} from '#/features/branding/service';
import { usePublication, type Publication } from '#/features/branding/usecase/usePublication';
import { useRevert, type Revert } from '#/features/branding/usecase/useRevert';
import { useThemeDiscard } from '#/features/branding/usecase/useThemeDiscard';
import { useDirtySections } from '#/shared/repository/useDirtySections';
import type { Removal } from '#/shared/usecase/useConfirmedChange';

export interface PublicationBar {
  publication: Publication;
  discard: Removal;
  // Taking the tab being shown back to published, which the bar offers where
  // it is too narrow to leave that to the tab's own panel, and only on a tab
  // that has parts to take back.
  revert: Revert;
  revertOffered: boolean;
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
  const dirty = useDirtySections(tenant, themeRecord(scope));
  const target = revertTarget(tab);
  return {
    revert: useRevert({ tenant, scope, view, tag, tab: target.tab }),
    revertOffered: target.offered,
    publication: usePublication({
      tenant,
      scope,
      view,
      tag,
      unsaved: unsavedSections(dirty),
      contrast: contrastReport(colourValues(view)).hold,
      writes,
      outcome: published,
      onOutcome: onPublished,
    }),
    discard: useThemeDiscard(tenant, scope, tag, writes),
  };
}
