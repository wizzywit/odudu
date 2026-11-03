import { useThemeRunning } from '#/features/branding-editor/repository/useThemeWrites';
import { runningLine, sectionHold } from '#/features/branding-editor/services/publicationHolds';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

// Why a theme section's Save is held, given the section's own reason, the
// writes running anywhere on the page, and whether the section is saving.
export function useSectionHold(
  tenant: string,
  scope: ThemeScope,
  own: string | undefined,
  saving: boolean,
): string | undefined {
  return sectionHold(own, runningLine(useThemeRunning(tenant, scope)), saving);
}
