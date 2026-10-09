import type { ThemeChoice } from '#/shared/service/theme.ts';

const KEY = 'odudu.console.theme';

// A per-browser convenience: private windows and blocked site data refuse
// storage, sometimes at the getter, and the page must theme itself anyway.
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadThemeChoice(): ThemeChoice {
  try {
    const stored = storage()?.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, choice);
  } catch {
    // Unremembered, the choice still holds for this page.
  }
}
