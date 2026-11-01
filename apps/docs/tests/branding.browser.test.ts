import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGES_BASE } from '#docs/site.config.ts';
import { DOCS_ROOT, distDir } from '#docs/tests/support/dist.ts';

let origin = '';
let server: ChildProcess | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const child = spawn(
    process.execPath,
    [
      path.join(DOCS_ROOT, 'scripts/serve.mjs'),
      distDir('pages'),
      '--base',
      PAGES_BASE,
      '--port',
      '0',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  server = child;
  origin = await new Promise<string>((resolve, reject) => {
    child.once('exit', () => {
      reject(new Error('the docs server exited before it was serving'));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /Serving (http:\/\/127\.0\.0\.1:\d+)/u.exec(chunk.toString());
      if (match?.[1] !== undefined) resolve(match[1]);
    });
  });
  browser = await chromium.launch();
});

afterAll(async () => {
  server?.kill();
  await browser?.close();
});

async function visibleSources(page: Page): Promise<string[]> {
  return page
    .locator('[data-section="branding"] figure img')
    .evaluateAll((images) =>
      images
        .filter((image) => getComputedStyle(image).display !== 'none')
        .map((image) => (image as HTMLImageElement).getAttribute('src') ?? ''),
    );
}

describe.each(['light', 'dark'] as const)('the branding swap in %s', (theme) => {
  async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
    if (browser === undefined) throw new Error('the browser did not launch');
    const context = await browser.newContext({ colorScheme: theme });
    const page = await context.newPage();
    await page.addInitScript((value) => {
      localStorage.setItem('theme', value);
    }, theme);
    await page.goto(`${origin}${PAGES_BASE}`);
    await page.evaluate((value) => {
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    return { page, close: () => context.close() };
  }

  it('shows exactly one picture by default, the Odudu look in this theme', async () => {
    const { page, close } = await open();
    try {
      expect(await visibleSources(page)).toEqual([
        `${PAGES_BASE}server-pages/look-odudu-${theme}.webp`,
      ]);
    } finally {
      await close();
    }
  });

  it('switches to the other brand from the keyboard, and back, one picture at a time', async () => {
    const { page, close } = await open();
    try {
      const odudu = page.getByRole('radio', { name: 'Odudu look' });
      await odudu.focus();
      await page.keyboard.press('ArrowDown');
      expect(await visibleSources(page)).toEqual([
        `${PAGES_BASE}server-pages/look-other-${theme}.webp`,
      ]);
      await page.keyboard.press('ArrowUp');
      expect(await visibleSources(page)).toEqual([
        `${PAGES_BASE}server-pages/look-odudu-${theme}.webp`,
      ]);
    } finally {
      await close();
    }
  });

  it('loads the picture it shows, at its own size', async () => {
    const { page, close } = await open();
    try {
      await page.getByRole('radio', { name: "A tenant's theme" }).check({ force: true });
      const image = page.locator('[data-section="branding"] figure img:visible');
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBe(920);
    } finally {
      await close();
    }
  });
});
