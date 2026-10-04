import { chromium, type Browser } from '@playwright/test';
import { createServer } from 'vite';

// Run from apps/admin-console. The dev server needs no upstream: the gallery
// makes no request to the gateway.
const PORT = 5173;
const OUT = '../../docs/phases/p4d-gallery';
const WIDTHS = [1280, 800, 390] as const;
const THEMES = ['light', 'dark'] as const;
const DIALOGS = ['typed', 'secret', 'unsaved'] as const;
// The record, list and save patterns, each by the label of its specimen.
const PATTERNS = {
  conflict: 'A save refused with 412: theirs beside yours',
  record: 'RecordPage: updated since you opened it',
  activity: 'ActivityTab: the audit trail for one record',
  pickers: "RolePicker and GroupPicker: searched, paged, each role's owner named",
  list: 'ResourceListPage: a whole list, searched, counted and paged',
  copy: 'CopyValue',
  breadcrumb: 'Breadcrumb: the way up from a page below a list',
  'key-hint': 'KeyHint: a shortcut told, not offered, on each platform',
  'skeleton-table': 'Skeleton: a table, its own header over placeholder rows',
  'skeleton-record': 'Skeleton: a record, its tabs and sections',
  'typed-fields': 'Typed fields: a claim in its own shape, with its autocomplete token',
  profile: "Profile: a record's claims in columns, one control height",
  'view-only': 'View only: one line, and every field as text',
} as const;

type Theme = (typeof THEMES)[number];

async function shoot(
  browser: Browser,
  {
    theme,
    width,
    dialog,
    tabs = false,
    collapsed = false,
    pattern,
  }: {
    theme: Theme;
    width: number;
    dialog?: string;
    tabs?: boolean;
    collapsed?: boolean;
    pattern?: keyof typeof PATTERNS;
  },
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  const query = new URLSearchParams({
    theme,
    ...(dialog === undefined ? {} : { dialog }),
    ...(collapsed ? { rail: 'collapsed' } : {}),
  });
  await page.goto(`http://localhost:${String(PORT)}/console/gallery.html?${query.toString()}`);
  await page.getByRole('heading', { level: 1, name: 'Instrument' }).waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (tabs || pattern !== undefined) {
    // The toasts sit over the viewport; a close-up has no use for them.
    const dismiss = page.getByRole('button', { name: /^Dismiss: /u });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    if (pattern === undefined) {
      const head = page.getByRole('tablist', { name: 'Client sections' }).locator('..');
      await head.screenshot({ path: `${OUT}/tabs-${theme}.png` });
    } else {
      const specimen = page.getByText(PATTERNS[pattern], { exact: true }).locator('..');
      await specimen.screenshot({ path: `${OUT}/pattern-${pattern}-${theme}.png` });
    }
    await page.close();
    return;
  }
  const name = collapsed
    ? `gallery-${String(width)}-collapsed-${theme}`
    : dialog === undefined
      ? `gallery-${String(width)}-${theme}`
      : `dialog-${dialog}-${theme}`;
  // A full-page capture keeps sticky and fixed layers where the first screen
  // put them, so the viewport is made as tall as the page instead.
  if (dialog === undefined && !collapsed) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height });
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch();
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) await shoot(browser, { theme, width });
    for (const dialog of DIALOGS) await shoot(browser, { theme, width: 1280, dialog });
    await shoot(browser, { theme, width: 1280, tabs: true });
    await shoot(browser, { theme, width: 1280, collapsed: true });
    for (const pattern of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
      await shoot(browser, { theme, width: 1280, pattern });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
