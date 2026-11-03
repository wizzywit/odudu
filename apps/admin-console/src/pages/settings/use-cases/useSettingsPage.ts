import { type Area } from '#/entities/area';
import { settingsPage, type SettingsPageWords } from '#/pages/settings/services/settingsPageWords';

// The gate wraps the page, so it cannot read what the page reads: it takes
// the area and the title here, before anything is fetched.
export function useSettingsPage(): { area: Area; title: string; words: SettingsPageWords } {
  return settingsPage();
}
