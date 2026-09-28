import type { ThemeChoice } from '#/shared/service/theme.ts';

export type { ThemeChoice };

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

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = storage()?.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function applyRememberedTheme(): void {
  apply(readThemeChoice());
}

export function rememberThemeChoice(choice: ThemeChoice): void {
  apply(choice);
  try {
    if (choice === 'system') storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, choice);
  } catch {
    // Unremembered, the choice still holds for this page.
  }
}
