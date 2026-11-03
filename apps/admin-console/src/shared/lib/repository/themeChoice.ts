import {
  loadThemeChoice,
  showThemeChoice,
  storeThemeChoice,
} from '#/shared/api/adapter/themeChoice';
import { restoreThemeCookie, writeThemeCookie } from '#/shared/api/adapter/themeCookie';
import type { ThemeChoice } from '#/shared/lib/services/theme';

// Written on start as well, so a choice made before the cookie existed
// reaches the server-rendered pages without being picked again.
export function applyRememberedTheme(): void {
  showThemeChoice(loadThemeChoice());
  restoreThemeCookie();
}

export function rememberThemeChoice(choice: ThemeChoice): void {
  showThemeChoice(choice);
  storeThemeChoice(choice);
  writeThemeCookie(choice);
}
