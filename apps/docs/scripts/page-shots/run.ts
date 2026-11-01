// Photographs the pages a person sees while signing in, for the landing page
// (pnpm page-shots). The markup is what the server's own renderers return, in
// the stylesheet the server serves, so nothing here is drawn by hand. Writes
// static/server-pages/<page>-<theme>.webp at twice the page's size, a
// copy of the sign-in page in a tenant's published theme (built by the
// server's own branding code, see brand.ts), and
// manifest.json with each size and a hash of what produced it.
// Each picture is the card and a margin of the page's grid around it.
// Needs packages/instrument/dist (pnpm --filter @odudu/instrument build).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';
import { brandFiles } from './brand.ts';
import { staleParts } from './dist-fresh.ts';
import {
  JOBS,
  THEMES,
  markupFor,
  renderedHash,
  type Group,
  type Job,
  type Theme,
} from './shots.ts';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ORIGIN = 'http://pages.test';
const INSTRUMENT = path.resolve(import.meta.dirname, '../../../../packages/instrument/dist');
const REPOSITORY = path.resolve(import.meta.dirname, '../../../..');
const TOKENS = 'apps/admin-console/src/shared/view/tokens.css';
const PAGES = 'packages/instrument/src/pages.css';
const OUT = path.resolve(import.meta.dirname, '../../static/server-pages');
const VIEWPORT = { width: 520, height: 1400 };
const MARGIN = 20;
const QUALITY = 0.82;
const SCALE = 2;

const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(directory, entry.name))
      : [path.join(directory, entry.name)],
  );
}

async function toWebp(context: BrowserContext, png: Buffer): Promise<Buffer> {
  const page = await context.newPage();
  const encoded = await page.evaluate(
    async ({ data, quality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', quality).split(',')[1] ?? '';
    },
    { data: png.toString('base64'), quality: QUALITY },
  );
  await page.close();
  return Buffer.from(encoded, 'base64');
}

let pending = '';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  await context.route(`${ORIGIN}/instrument/**`, async (route) => {
    const relative = new URL(route.request().url()).pathname.replace('/instrument/', '');
    const file = path.join(INSTRUMENT, relative);
    await route.fulfill({
      body: readFileSync(file),
      contentType: TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
  });
  const brand = brandFiles();
  await context.route(`${ORIGIN}/tenants/**`, async (route) => {
    const served = brand.get(new URL(route.request().url()).pathname);
    if (served === undefined) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ body: served.body, contentType: served.contentType });
  });
  if (files(INSTRUMENT).length === 0) throw new Error('packages/instrument/dist is empty');
  const stale = staleParts(readFileSync(path.join(INSTRUMENT, 'instrument.css'), 'utf8'), {
    tokensCss: readFileSync(path.join(REPOSITORY, TOKENS), 'utf8'),
    pagesCss: readFileSync(path.join(REPOSITORY, PAGES), 'utf8'),
  });
  if (stale.length > 0) {
    throw new Error(
      `packages/instrument/dist is out of date with ${stale.join(' and ')}: run pnpm --filter @odudu/instrument build`,
    );
  }
  await context.route(`${ORIGIN}/page`, async (route) => {
    await route.fulfill({ body: pending, contentType: 'text/html' });
  });

  mkdirSync(OUT, { recursive: true });

  async function measure(job: Job, theme: Theme): Promise<Box> {
    pending = markupFor(job, theme);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/page`);
    await page.evaluate(() => document.fonts.ready);
    const box = await page.locator('main').boundingBox();
    await page.close();
    if (box === null) throw new Error(`${job.file} has no main element`);
    return box;
  }

  const canvas: Partial<Record<Group, number>> = {};
  for (const job of JOBS) {
    for (const theme of THEMES) {
      const box = await measure(job, theme);
      canvas[job.group] = Math.max(canvas[job.group] ?? 0, Math.ceil(box.height + 2 * MARGIN));
    }
  }

  const sizes: Record<string, { width: number; height: number; hash: string }> = {};
  for (const job of JOBS) {
    for (const theme of THEMES) {
      pending = markupFor(job, theme);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/page`);
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator('main').boundingBox();
      if (box === null) throw new Error(`${job.file} has no main element`);
      const height = job.group === 'natural' ? box.height + 2 * MARGIN : (canvas[job.group] ?? 0);
      const clip = {
        x: Math.floor(box.x - MARGIN),
        y: Math.floor(box.y + box.height / 2 - height / 2),
        width: Math.ceil(box.width + 2 * MARGIN),
        height: Math.ceil(height),
      };
      if (clip.y < 0) throw new Error(`${job.file} does not fit the viewport`);
      const png = await page.screenshot({ clip });
      await page.close();
      writeFileSync(path.join(OUT, `${job.file}-${theme}.webp`), await toWebp(context, png));
      sizes[job.file] = { width: clip.width, height: clip.height, hash: renderedHash(job) };
    }
  }
  writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(sizes, null, 2)}\n`);
} finally {
  await browser.close();
}
