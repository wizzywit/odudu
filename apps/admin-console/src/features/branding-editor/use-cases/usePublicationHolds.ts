import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useThemeRunning } from '#/features/branding-editor/repository/useThemeWrites';
import { contrastReport } from '#/features/branding-editor/services/contrast';
import {
  publicationHolds,
  type PublicationHolds,
} from '#/features/branding-editor/services/publicationHolds';
import { unsavedSections } from '#/features/branding-editor/services/sectionTitles';
import { tabUnsaved } from '#/features/branding-editor/services/revertDraft';
import { themeRecord, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { colourValues } from '#/features/branding-editor/services/colourValues';
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
    busy: running,
    unsaved: unsavedSections(dirty),
    unsavedByTab: { theme: tabUnsaved('theme', dirty), pages: tabUnsaved('pages', dirty) },
    contrast: contrastReport(colourValues(view)).hold,
  });
}
