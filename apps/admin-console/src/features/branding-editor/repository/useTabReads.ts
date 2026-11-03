import { useMessageCatalogue } from '#/features/branding-editor/repository/useMessageCatalogue';
import { useStylesheetHooks } from '#/features/branding-editor/repository/useStylesheetHooks';
import { useThemeVersions } from '#/features/branding-editor/repository/useThemeVersions';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import type { TabReads } from '#/features/branding-editor/services/tabs';
import { useTenantSettings } from '#/entities/tenant';

// Starts the reads a tab will show without waiting for the theme: they share
// their keys with the tab's own hooks, which then find them under way.
export function useTabReads(tenant: string, scope: ThemeScope, reads: TabReads): void {
  useMessageCatalogue(tenant, reads.catalogue);
  useStylesheetHooks(tenant, reads.hooks);
  useThemeVersions(tenant, scope, reads.versions);
  useTenantSettings(tenant, { enabled: reads.settings, recent: true });
}
