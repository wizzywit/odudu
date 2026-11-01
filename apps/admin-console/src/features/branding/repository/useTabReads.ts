import { useMessageCatalogue } from '#/features/branding/repository/useMessageCatalogue';
import { useStylesheetHooks } from '#/features/branding/repository/useStylesheetHooks';
import { useThemeVersions } from '#/features/branding/repository/useThemeVersions';
import type { TabReads, ThemeScope } from '#/features/branding/service';
import { useTenantSettings } from '#/shared/repository/useTenantSettings';

// Starts the reads a tab will show without waiting for the theme: they share
// their keys with the tab's own hooks, which then find them under way.
export function useTabReads(tenant: string, scope: ThemeScope, reads: TabReads): void {
  useMessageCatalogue(tenant, reads.catalogue);
  useStylesheetHooks(tenant, reads.hooks);
  useThemeVersions(tenant, scope, reads.versions);
  useTenantSettings(tenant, { enabled: reads.settings, recent: true });
}
