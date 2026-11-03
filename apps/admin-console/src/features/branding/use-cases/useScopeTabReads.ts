import { useTabReads } from '#/features/branding/repository/useTabReads';
import { type ThemeScope } from '#/features/branding/services/themeScope';
import { tabReads, type BrandingTab } from '#/features/branding/services/tabs';

// Starts the reads the tab shown will need, beside the scope's theme read.
export function useScopeTabReads(tenant: string, scope: ThemeScope, tab: BrandingTab): void {
  useTabReads(tenant, scope, tabReads(tab));
}
