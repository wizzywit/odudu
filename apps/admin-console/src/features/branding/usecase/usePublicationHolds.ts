import type { ThemeView } from '@odudu/contracts/admin';
import { useThemeRunning } from '#/features/branding/repository/useThemeWrites';
import {
  colourValues,
  contrastReport,
  publicationHolds,
  tabUnsaved,
  themeRecord,
  unsavedSections,
  type PublicationHolds,
  type ThemeScope,
} from '#/features/branding/service';
import { useDirtySections } from '#/shared/repository/useDirtySections';

// Why each action over the whole draft is held, read from what is running
// anywhere on the page and what is unsaved on any tab. The contrast pairs
// read the saved colours, which is what a publish checks.
export function usePublicationHolds(
  tenant: string,
  scope: ThemeScope,
  view: ThemeView,
): PublicationHolds {
  const dirty = useDirtySections(tenant, themeRecord(scope));
  const running = useThemeRunning(tenant, scope);
  return publicationHolds({
    view,
    busy: { ...running, sectionSave: running.other },
    unsaved: unsavedSections(dirty),
    unsavedByTab: { theme: tabUnsaved('theme', dirty), pages: tabUnsaved('pages', dirty) },
    contrast: contrastReport(colourValues(view)).hold,
  });
}
