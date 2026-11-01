import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { brandMarkup, type PageLocale } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPOSITORY = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(REPOSITORY, file), 'utf8');
// The server's stylesheet is these two sources with the fonts between them,
// which no display rule reads.
const INSTRUMENT =
  read('apps/admin-console/src/shared/view/tokens.css') + read('packages/instrument/src/pages.css');

const locale = (darkUrl: string | null): PageLocale => ({
  tag: 'en',
  dir: 'ltr',
  branding: {
    origin: 'https://idp.example',
    templates: {},
    tokensCss: '',
    stylesheetUrl: null,
    faviconUrl: null,
    logo: { url: '/t/a/l.png', darkUrl, alt: 'Acme' },
    assetUrls: [],
  },
});

const SCHEMES = ['light', 'dark'] as const;
const CHOICES = [undefined, 'light', 'dark'] as const;

// Which images are shown, as the light and dark one, for a tenant sheet.
type Shown = [boolean, boolean];

const expected = (
  tenant: string,
  system: 'light' | 'dark',
  choice: 'light' | 'dark' | undefined,
): Shown => {
  const active = choice ?? system;
  const hidden = tenant.includes('.logo{display:none}');
  const light = !hidden && !tenant.includes('.logo-light{display:none}') && active === 'light';
  const dark = !hidden && !tenant.includes('.logo-dark{display:none}') && active === 'dark';
  return [light, dark];
};

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function shown(
  tenant: string,
  system: 'light' | 'dark',
  choice: 'light' | 'dark' | undefined,
  darkUrl: string | null,
): Promise<boolean[]> {
  if (browser === undefined) throw new Error('the browser did not launch');
  const context = await browser.newContext({ colorScheme: system });
  const page = await context.newPage();
  const attribute = choice === undefined ? '' : ` data-theme="${choice}"`;
  await page.setContent(
    `<!doctype html><html${attribute}><head><style>${INSTRUMENT}</style>` +
      `<style>${tenant}</style></head><body><main class="page">` +
      `${brandMarkup(locale(darkUrl), '')}</main></body></html>`,
  );
  const display = await page
    .locator('img')
    .evaluateAll((images) => images.map((image) => getComputedStyle(image).display !== 'none'));
  await context.close();
  return display;
}

describe('a logo pair on a page', () => {
  const tenants = [
    '',
    '.logo{display:block}',
    '.logo{display:inline}',
    '.logo{display:none}',
    '.logo-light{display:none}',
    '.logo-dark{display:none}',
  ];
  for (const tenant of tenants) {
    it(`shows the one image in use for ${tenant || 'no tenant rule'}`, async () => {
      for (const system of SCHEMES) {
        for (const choice of CHOICES) {
          const got = await shown(tenant, system, choice, '/t/a/d.png');
          expect(got, `${system} ${String(choice)}`).toEqual(expected(tenant, system, choice));
        }
      }
    });
  }

  it('keeps the other variant hidden against a rule naming both classes', async () => {
    const got = await shown('.logo.logo-dark{display:block}', 'light', undefined, '/t/a/d.png');
    expect(got).toEqual([true, false]);
  });

  it('shows a lone logo, and a tenant rule hides it', async () => {
    for (const system of SCHEMES) {
      for (const choice of CHOICES) {
        expect(await shown('', system, choice, null)).toEqual([true]);
        expect(await shown('.logo{display:none}', system, choice, null)).toEqual([false]);
      }
    }
  });
});
