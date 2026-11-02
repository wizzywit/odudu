import type { ThemeChoice } from '#/shared/services/theme';
import { browserStorage } from '#/shared/adapter/browserStorage';

const KEY = 'odudu.console.theme';

// Undefined when storage cannot be read, which is not the same as a stored
// system choice: the first leaves whatever the cookie holds alone.
export function readThemeChoice(): ThemeChoice | undefined {
  try {
    const stored = browserStorage('local')?.getItem(KEY);
    if (stored === undefined) return undefined;
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return undefined;
  }
}

export function loadThemeChoice(): ThemeChoice {
  return readThemeChoice() ?? 'system';
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') browserStorage('local')?.removeItem(KEY);
    else browserStorage('local')?.setItem(KEY, choice);
  } catch {
    // Unremembered, the choice still holds for this page.
  }
}
