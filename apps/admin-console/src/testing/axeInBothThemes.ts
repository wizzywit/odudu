import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';

type Theme = 'light' | 'dark';

// Page-level rules ask for a whole page's landmarks and h1, which one
// component rendered alone never has; the App test holds the page to them.
const PAGE_RULES = {
  region: { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
};

export async function axeInBothThemes(ui: () => ReactElement): Promise<Record<Theme, string[]>> {
  const found: Record<Theme, string[]> = { light: [], dark: [] };
  const root = document.documentElement;
  for (const theme of ['light', 'dark'] as const) {
    root.dataset.theme = theme;
    const { unmount } = render(ui());
    const result = await axe.run(document.body, { rules: PAGE_RULES });
    found[theme] = result.violations.map((v) => `${v.id}: ${v.help}`);
    unmount();
  }
  delete root.dataset.theme;
  return found;
}
