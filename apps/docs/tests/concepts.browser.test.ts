import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGES_BASE, PAGES_DOCS_BASE } from '#docs/site.config.ts';
import { declaredTexts } from '#docs/tests/support/diagram-markup.ts';
import { DOCS_ROOT, distDir } from '#docs/tests/support/dist.ts';

const PAGES = [
  'tenants',
  'clients',
  'scopes',
  'roles-and-groups',
  'sessions',
  'tokens',
  'consent-and-audit',
  'branding',
] as const;

// The smallest a diagram's text may render, in CSS pixels, at a phone's width.
const LEAST_PHONE_TEXT = 12;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let origin = '';

beforeAll(async () => {
  server = spawn(
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
  const serving = server;
  origin = await new Promise<string>((resolve, reject) => {
    serving.once('exit', () => {
      reject(new Error('the docs server exited before it was serving'));
    });
    serving.stdout?.on('data', (chunk: Buffer) => {
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

function luminance([red, green, blue]: readonly number[]): number {
  const channel = (value: number): number => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red ?? 0) + 0.7152 * channel(green ?? 0) + 0.0722 * channel(blue ?? 0);
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function channels(colour: string): number[] {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/u.exec(colour);
  if (match === null) throw new Error(`not a colour this test can read: ${colour}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

interface Measured {
  readonly texts: {
    readonly words: string;
    readonly colour: string;
    readonly surface: string;
    readonly straddles: boolean;
    readonly rendered: number;
    readonly inside: boolean;
  }[];
  readonly arrows: string[];
  readonly page: string;
  readonly overflow: boolean;
}

// The surface behind a text is found by where the text is drawn: the smallest
// rectangle of the drawing that holds its whole box, or the page when none
// does. A text that is only partly over a rectangle is reported, because
// neither surface then decides how readable it is.
async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const svg = document.querySelector('article svg[role="img"]');
    if (!(svg instanceof SVGSVGElement)) throw new Error('no diagram on the page');
    const box = svg.viewBox.baseVal;
    const scale = svg.getBoundingClientRect().width / box.width;
    const pageColour = (): string => {
      for (let node: Element | null = svg; node !== null; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)') return colour;
      }
      return 'rgb(255, 255, 255)';
    };
    const background = pageColour();
    const rects = [...svg.querySelectorAll('rect')].map((rect) => ({
      x: rect.x.baseVal.value,
      y: rect.y.baseVal.value,
      width: rect.width.baseVal.value,
      height: rect.height.baseVal.value,
      fill: getComputedStyle(rect).fill,
    }));
    const texts = [...svg.querySelectorAll('text')].map((text) => {
      const bounds = text.getBBox();
      const right = bounds.x + bounds.width;
      const bottom = bounds.y + bounds.height;
      const holding = rects
        .filter(
          (rect) =>
            bounds.x >= rect.x &&
            bounds.y >= rect.y &&
            right <= rect.x + rect.width &&
            bottom <= rect.y + rect.height,
        )
        .sort((a, b) => a.width * a.height - b.width * b.height);
      const straddles = rects.some(
        (rect) =>
          bounds.x < rect.x + rect.width &&
          right > rect.x &&
          bounds.y < rect.y + rect.height &&
          bottom > rect.y &&
          !holding.includes(rect),
      );
      return {
        words: text.textContent,
        colour: getComputedStyle(text).fill,
        surface: holding[0]?.fill ?? background,
        straddles,
        rendered: Number.parseFloat(getComputedStyle(text).fontSize) * scale,
        inside: bounds.x >= 0 && right <= box.width && bounds.y >= 0 && bottom <= box.height,
      };
    });
    const arrows = [...svg.querySelectorAll('path[marker-end]')].map(
      (arrow) => getComputedStyle(arrow).stroke,
    );
    return {
      texts,
      arrows,
      page: background,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

async function setTheme(page: Page, wanted: 'light' | 'dark'): Promise<void> {
  const any = page.locator('button[class*="toggleButton"]');
  const toggle = any.locator('visible=true').first();
  // On a phone the toggle sits in the menu the hamburger opens.
  const menu = page.locator('button.navbar__toggle');
  const opened = async (): Promise<void> => {
    if ((await any.locator('visible=true').count()) === 0 && (await menu.isVisible()))
      await menu.click();
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('html').getAttribute('data-theme')) === wanted) return;
    await opened();
    await toggle.click();
  }
  expect(await page.locator('html').getAttribute('data-theme')).toBe(wanted);
}

// Every text the drawing declares is in the page, in order, inside the drawing:
// a drawing that is right on the server and wrong once the browser has drawn it
// again shows up as a count or a position that is not the declared one.
function expectDeclared(seen: Measured, name: (typeof PAGES)[number], how: string): void {
  expect(
    seen.texts.map((text) => text.words),
    `${name} ${how}`,
  ).toEqual(declaredTexts(name));
  expect(
    seen.texts.filter((text) => !text.inside).map((text) => text.words),
    `${name} ${how} leaves the drawing`,
  ).toEqual([]);
}

async function shown(page: Page): Promise<void> {
  await hydrated(page);
  await page.locator('article svg[role="img"]').waitFor();
}

async function hydrated(page: Page): Promise<void> {
  await page.locator('html[data-has-hydrated="true"]').waitFor();
}

describe('the concept diagrams in a browser, following the site toggle', () => {
  for (const [label, size] of [
    ['a phone', { width: 375, height: 800 }],
    ['a desktop', { width: 1280, height: 900 }],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      it(`are legible, contrasted and free of violations on ${label}, ${theme}`, async () => {
        if (browser === undefined) throw new Error('the browser did not launch');
        // The system says the opposite, so only the toggle can make the theme.
        const context = await browser.newContext({
          viewport: size,
          colorScheme: theme === 'light' ? 'dark' : 'light',
        });
        const page = await context.newPage();
        const problems: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') problems.push(message.text());
        });
        for (const name of PAGES) {
          await page.goto(`${origin}${PAGES_DOCS_BASE}concepts/${name}/`);
          await setTheme(page, theme);
          // The toggle's choice is kept, so a fresh load shows the page with the menu shut.
          await page.goto(`${origin}${PAGES_DOCS_BASE}concepts/${name}/`);
          expect(await page.locator('html').getAttribute('data-theme')).toBe(theme);
          await shown(page);
          const seen = await measure(page);
          expectDeclared(seen, name, 'after hydration');
          const background = channels(seen.page);
          expect(seen.texts.length, name).toBeGreaterThan(5);
          for (const text of seen.texts) {
            const where = `${name} "${text.words}"`;
            expect(
              contrast(channels(text.colour), channels(text.surface)),
              where,
            ).toBeGreaterThanOrEqual(4.5);
            expect(text.inside, `${where} leaves the drawing`).toBe(true);
            expect(text.straddles, `${where} is only partly over a box`).toBe(false);
            if (size.width === 375) {
              expect(text.rendered, `${where} renders small`).toBeGreaterThanOrEqual(
                LEAST_PHONE_TEXT,
              );
            }
          }
          for (const arrow of seen.arrows) {
            expect(contrast(channels(arrow), background), `${name} arrow`).toBeGreaterThanOrEqual(
              3,
            );
          }
          expect(seen.overflow, `${name} scrolls sideways`).toBe(false);
          const results = await new AxeBuilder({ page }).include('article').analyze();
          expect(
            results.violations.map(
              (violation) =>
                `${violation.id} ${JSON.stringify(violation.nodes.map((node) => node.target))}`,
            ),
            name,
          ).toEqual([]);
          // Reached by the router, the drawing is made in the browser, not read from the page.
          await page.goto(`${origin}${PAGES_DOCS_BASE}concepts/`);
          await hydrated(page);
          await page.locator(`article a[href$="/concepts/${name}/"]`).first().click();
          await page.waitForURL(`**/concepts/${name}/`);
          await shown(page);
          expectDeclared(await measure(page), name, 'after navigation');
          // Drawn again in the same page: the module's state outlives a render.
          await page.goBack();
          await hydrated(page);
          await page.goForward();
          await shown(page);
          expectDeclared(await measure(page), name, 'after coming back to it');
          await setTheme(page, theme === 'light' ? 'dark' : 'light');
          await setTheme(page, theme);
          expectDeclared(await measure(page), name, 'after the theme was toggled');
        }
        expect(problems).toEqual([]);
        await context.close();
      }, 120_000);
    }
  }
});
