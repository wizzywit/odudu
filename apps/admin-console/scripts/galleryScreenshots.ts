import { chromium, type Browser } from '@playwright/test';
import { createServer } from 'vite';

// Run from apps/admin-console. The dev server needs no upstream: the gallery
// makes no request to the gateway.
const PORT = 5173;
const OUT = '../../docs/phases/p4d-gallery';
const WIDTHS = [1280, 800, 390] as const;
const THEMES = ['light', 'dark'] as const;
const DIALOGS = ['typed', 'secret', 'unsaved'] as const;

type Theme = (typeof THEMES)[number];

async function shoot(
  browser: Browser,
  {
    theme,
    width,
    dialog,
    tabs = false,
  }: { theme: Theme; width: number; dialog?: string; tabs?: boolean },
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  const query = new URLSearchParams({ theme, ...(dialog === undefined ? {} : { dialog }) });
  await page.goto(`http://localhost:${String(PORT)}/console/gallery.html?${query.toString()}`);
  await page.getByRole('heading', { level: 1, name: 'Instrument' }).waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (tabs) {
    // The toasts sit over the viewport; a close-up has no use for them.
    const dismiss = page.getByRole('button', { name: /^Dismiss/u });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    const head = page.getByRole('tablist', { name: 'Client sections' }).locator('..');
    await head.screenshot({ path: `${OUT}/tabs-${theme}.png` });
    await page.close();
    return;
  }
  const name =
    dialog === undefined ? `gallery-${String(width)}-${theme}` : `dialog-${dialog}-${theme}`;
  // A full-page capture keeps sticky and fixed layers where the first screen
  // put them, so the viewport is made as tall as the page instead.
  if (dialog === undefined) {
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
  }
} finally {
  await browser.close();
  await server.close();
}
