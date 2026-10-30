import { useTabReads } from '#/features/branding/repository/useTabReads';
import { tabReads, type BrandingTab, type ThemeScope } from '#/features/branding/service';

// Starts the reads the tab shown will need, beside the scope's theme read.
export function useScopeTabReads(tenant: string, scope: ThemeScope, tab: BrandingTab): void {
  useTabReads(tenant, scope, tabReads(tab));
}
