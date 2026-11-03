import { loadThemeChoice, storeThemeChoice } from '#/shared/api/adapter/themeChoice';
import { restoreThemeCookie, writeThemeCookie } from '#/shared/api/adapter/themeCookie';
import type { ThemeChoice } from '#/shared/lib/services/theme';

// The choice is named on <html> first, so it holds for this page even when
// the browser refuses to remember it.
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

// Written on start as well, so a choice made before the cookie existed
// reaches the server-rendered pages without being picked again.
export function applyRememberedTheme(): void {
  apply(loadThemeChoice());
  restoreThemeCookie();
}

export function rememberThemeChoice(choice: ThemeChoice): void {
  apply(choice);
  storeThemeChoice(choice);
  writeThemeCookie(choice);
}
