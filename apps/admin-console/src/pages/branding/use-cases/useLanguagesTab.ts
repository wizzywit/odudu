import { useTenantSettingsRead } from '#/entities/tenant';
import { LANGUAGES_TAB_WORDS } from '#/pages/branding/services/languagesView';

// The tenant's settings, read before either section of the tab is drawn.
export function useLanguagesTab(tenant: string) {
  return { read: useTenantSettingsRead(tenant, true), words: LANGUAGES_TAB_WORDS };
}
