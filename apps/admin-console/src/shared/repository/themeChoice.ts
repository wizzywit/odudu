import { loadThemeChoice, storeThemeChoice } from '#/shared/adapter/themeChoice.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';

// The choice is named on <html> first, so it holds for this page even when
// the browser refuses to remember it.
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function applyRememberedTheme(): void {
  apply(loadThemeChoice());
}

export function rememberThemeChoice(choice: ThemeChoice): void {
  apply(choice);
  storeThemeChoice(choice);
}
