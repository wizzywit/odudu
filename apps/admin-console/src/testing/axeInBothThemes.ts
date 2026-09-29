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

// `ready` waits for a page that reads before it renders what is to be checked.
// `disable` switches off rules one open state is known to trip, each named
// where it is passed, never the whole run.
export async function axeInBothThemes(
  ui: () => ReactElement,
  ready: () => Promise<unknown> = () => Promise.resolve(),
  { disable = [] }: { readonly disable?: readonly string[] } = {},
): Promise<Record<Theme, string[]>> {
  const found: Record<Theme, string[]> = { light: [], dark: [] };
  const root = document.documentElement;
  for (const theme of ['light', 'dark'] as const) {
    root.dataset.theme = theme;
    const { unmount } = render(ui());
    await ready();
    const rules = {
      ...PAGE_RULES,
      ...Object.fromEntries(disable.map((id) => [id, { enabled: false }])),
    };
    const result = await axe.run(document.body, { rules });
    found[theme] = result.violations.map((v) => `${v.id}: ${v.help}`);
    unmount();
  }
  delete root.dataset.theme;
  return found;
}
