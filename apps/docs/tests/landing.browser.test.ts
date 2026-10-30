import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';
import { chromium, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOURNEYS, SECTIONS } from '#docs/nav.ts';
import { BEATS, SCENE_EASE } from '#docs/src/features/landing/service/geometry.ts';
import { PAGES_BASE, PAGES_DOCS_BASE } from '#docs/site.config.ts';
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

const home = (): string => `${origin}${PAGES_BASE}`;

async function visit(
  options: BrowserContextOptions = {},
  prepare?: (page: Page) => Promise<void>,
): Promise<{ page: Page; close: () => Promise<void> }> {
  if (browser === undefined) throw new Error('the browser did not launch');
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await prepare?.(page);
  await page.goto(home());
  return { page, close: () => context.close() };
}

// Automation says so through navigator.webdriver and the page then skips its
// reveal; the reveal's own tests want the page a visitor gets.
const visitHuman = (
  options: BrowserContextOptions = {},
  prepare?: (page: Page) => Promise<void>,
): ReturnType<typeof visit> =>
  visit(options, async (target) => {
    await target.context().addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await prepare?.(target);
  });

const WINDOWS_LABEL = 'PowerShell';

describe('the landing page in a browser', () => {
  it('shows what it is, the one command and the docs link above the fold at 390 x 844', async () => {
    const { page, close } = await visit({ viewport: { width: 390, height: 844 } });
    const heading = await page.locator('h1').boundingBox();
    const command = await page.locator('code[data-shell]:visible').first().boundingBox();
    const docs = await page.getByRole('link', { name: 'Read the docs' }).boundingBox();
    expect(heading?.y ?? -1).toBeGreaterThanOrEqual(0);
    for (const box of [heading, command, docs]) {
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
    }
    await close();
  });

  for (const width of [320, 390, 768, 1280]) {
    it(`has no horizontal scroll at ${String(width)} px`, async () => {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
      await close();
    });
  }

  it('copies the command that is showing, as one ASCII line', async () => {
    const { page, close } = await visit({ permissions: ['clipboard-read', 'clipboard-write'] });
    for (const choose of [undefined, WINDOWS_LABEL]) {
      if (choose !== undefined) await page.getByText(choose, { exact: true }).click();
      await page.getByRole('button', { name: /^Copy/u }).click();
      await page.getByRole('button', { name: /^Copied/u }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      const shown = await page.locator('code[data-shell]:visible').innerText();
      expect(copied).toBe(shown);
      expect(copied).toMatch(/^[\x20-\x7e]+$/u);
      expect(copied).not.toContain('\n');
    }
    await close();
  });

  it('opens each reader path in one click', async () => {
    const { page, close } = await visit();
    const links = page.locator(
      '[data-section="readers"] li:not([data-section="examples"] li) h3 a',
    );
    expect(await links.count()).toBe(4);
    const targets = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
    );
    for (const target of targets) {
      await page.goto(home());
      await page.locator(`[data-section="readers"] a[href="${target}"]`).click();
      await page.waitForURL(`${origin}${target}`);
      expect(await page.locator('h1').count()).toBeGreaterThan(0);
    }
    await close();
  });

  it('answers every link of the capabilities and the examples with a page', async () => {
    const { page, close } = await visit();
    const hrefs = await page
      .locator('[data-section="capabilities"] a, [data-section="examples"] a[href^="/"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    for (const href of hrefs) {
      const response = await page.request.get(`${origin}${href}`);
      expect(response.status(), href).toBe(200);
    }
    await close();
  });

  it('has no motion under prefers-reduced-motion: reduce', async () => {
    const { page, close } = await visit({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const moving = await page.evaluate(() => {
      const zero = (value: string): boolean =>
        value.split(',').every((part) => part.trim() === '0s');
      return [...document.querySelectorAll('[data-page="landing"], [data-page="landing"] *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.animationName !== 'none' || !zero(style.transitionDuration);
        })
        .map((element) => element.getAttribute('class') ?? element.tagName);
    });
    expect(moving).toEqual([]);
    await close();
  });

  it('shows every section and every step with JavaScript disabled', async () => {
    const { page, close } = await visit({ javaScriptEnabled: false });
    const state = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-reveal], [data-flow-captions] > li')];
      return {
        count: items.length,
        hidden: items.filter((element) => {
          const style = getComputedStyle(element);
          return style.opacity !== '1' || style.visibility !== 'visible';
        }).length,
      };
    });
    expect(state.count).toBeGreaterThan(20);
    expect(state.hidden).toBe(0);
    await close();
  });

  it('shifts nothing while loading and scrolling', async () => {
    if (browser === undefined) throw new Error('the browser did not launch');
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const holder = window as unknown as { shift: number };
      holder.shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const record = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!record.hadRecentInput) holder.shift += record.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(home());
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      for (let y = 0; y <= document.documentElement.scrollHeight; y += 250) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    });
    await page.waitForTimeout(500);
    const shift = await page.evaluate(() => (window as unknown as { shift: number }).shift);
    expect(shift).toBeLessThan(0.001);
    await context.close();
  });

  for (const [width, shown, hidden] of [
    [375, 'tall', 'wide'],
    [390, 'tall', 'wide'],
    [1280, 'wide', 'tall'],
  ] as const) {
    it(`composes the scene for ${String(width)} px and keeps its words at 12 px or more`, async () => {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      expect(await page.locator(`svg[data-layout="${shown}"]`).isVisible()).toBe(true);
      expect(await page.locator(`svg[data-layout="${hidden}"]`).isVisible()).toBe(false);
      const smallest = await page.evaluate((layout) => {
        const svg = document.querySelector<SVGSVGElement>(`svg[data-layout="${layout}"]`);
        if (svg === null) return 0;
        const box = svg.viewBox.baseVal;
        const scale = svg.getBoundingClientRect().width / box.width;
        return Math.min(
          ...[...svg.querySelectorAll('text')].map(
            (text) => Number.parseFloat(getComputedStyle(text).fontSize) * scale,
          ),
        );
      }, shown);
      expect(smallest).toBeGreaterThanOrEqual(12);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await close();
    });
  }

  it('passes axe with a step chosen, in both colour modes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { page, close } = await visit({ colorScheme: scheme });
      await page.locator('[data-flow] [role="group"]').waitFor();
      await page.getByRole('button', { name: /Sign in once/u }).click();
      await page.waitForTimeout(700);
      const results = await new AxeBuilder({ page })
        .include('[data-section="signin"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map(
          (violation: Result) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
        ),
        scheme,
      ).toEqual([]);
      await close();
    }
  });

  it('types the command over real text, in a box that never changes size', async () => {
    if (browser === undefined) throw new Error('the browser did not launch');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      const holder = window as unknown as { shift: number };
      holder.shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const record = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!record.hadRecentInput) holder.shift += record.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await context.newPage();
    await page.goto(home(), { waitUntil: 'domcontentloaded' });
    const command = await page.locator('code[data-shell="unix"]').textContent();
    expect(command).toContain('docker compose up -d');
    const heights: number[] = [];
    const sample = async (): Promise<void> => {
      heights.push((await page.locator('[data-panel="unix"]').boundingBox())?.height ?? 0);
    };
    await page.locator('code[data-shell="unix"]').waitFor({ state: 'visible' });
    await sample();
    await page.locator('[class*="typed"]').first().waitFor({ state: 'attached' });
    await sample();
    expect(await page.locator('code[data-shell="unix"]').textContent()).toBe(command);
    const before = await page.evaluate(() => (window as unknown as { shift: number }).shift);
    expect(before).toBeLessThan(0.001);
    await page.getByRole('button', { name: /^Copy/u }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    const axe = await new AxeBuilder({ page }).include('[data-panel="unix"]').analyze();
    expect(axe.violations.map((violation: Result) => violation.id)).toEqual([]);
    await page.locator('[class*="typed"]').first().waitFor({ state: 'detached' });
    await sample();
    await page.waitForTimeout(400);
    await sample();
    expect(heights.map((height) => Math.round(height))).toEqual(
      heights.map(() => Math.round(heights[0] ?? 0)),
    );
    await context.close();
  });

  it('shows the command at once, untyped, under reduced motion', async () => {
    const { page, close } = await visit({ reducedMotion: 'reduce' });
    await page.waitForTimeout(600);
    expect(await page.locator('[class*="typed"]').count()).toBe(0);
    const colour = await page
      .locator('code[data-shell="unix"]')
      .evaluate((element) => getComputedStyle(element).color);
    expect(colour).not.toBe('rgba(0, 0, 0, 0)');
    await close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      for (const route of ['', 'introduction/']) {
        for (const scrolled of route === '' ? [false, true] : [false]) {
          it(`passes axe: ${scheme}, motion ${motion}, /${route}${scrolled ? ', scrolled' : ''}`, async () => {
            const { page, close } = await visit({ colorScheme: scheme, reducedMotion: motion });
            if (route !== '') await page.goto(`${origin}${PAGES_DOCS_BASE}${route}`);
            await page.evaluate(async () => {
              await document.fonts.ready;
            });
            if (scrolled) {
              await page.evaluate(async () => {
                for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) {
                  window.scrollTo(0, y);
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                window.scrollTo(0, 0);
              });
              await page.waitForTimeout(5000);
            }
            const results = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze();
            expect(
              results.violations.map(
                (violation: Result) =>
                  `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
              ),
            ).toEqual([]);
            await close();
          });
        }
      }
    }
  }

  // A slow machine, which is what showed a page that is still moving when it should be still.
  const slowCpu = async (target: Page): Promise<void> => {
    const session = await target.context().newCDPSession(target);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  };

  it('shows the headline, the one command and every section link with JavaScript disabled, nothing moving', async () => {
    const { page, close } = await visit({ javaScriptEnabled: false }, slowCpu);
    expect(await page.locator('h1').isVisible()).toBe(true);
    expect(await page.locator('code[data-shell]:visible').count()).toBe(1);
    expect(await page.locator('code[data-shell="unix"]').isVisible()).toBe(true);
    for (const route of [...SECTIONS.map((s) => s.route), ...JOURNEYS.map((j) => j.route)]) {
      const link = page.locator(`main a[href="${PAGES_DOCS_BASE}${route}"]`).first();
      expect(await link.isVisible(), route).toBe(true);
    }
    const moving = await page.evaluate(() =>
      document.getAnimations().map((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        const name = animation instanceof CSSAnimation ? animation.animationName : 'a transition';
        return `${name} on ${target?.tagName.toLowerCase() ?? 'nothing'} .${target?.getAttribute('class') ?? ''}`;
      }),
    );
    expect(moving, 'nothing animates without script').toEqual([]);
    await page.getByText(WINDOWS_LABEL, { exact: true }).click({ timeout: 5000 });
    expect(await page.locator('code[data-shell="windows"]').isVisible()).toBe(true);
    expect(await page.locator('code[data-shell="unix"]').isVisible()).toBe(false);
    await close();
  });

  it('keeps the sign-in section the same height from the first paint to the settled page', async () => {
    if (browser === undefined) throw new Error('the browser did not launch');
    for (const width of [1280, 768, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto(home(), { waitUntil: 'domcontentloaded' });
      const height = (): Promise<number> =>
        page
          .locator('[data-section="signin"]')
          .evaluate((section) => section.getBoundingClientRect().height);
      const before = await height();
      await page.locator('[data-flow] [role="group"]').waitFor();
      await page.waitForTimeout(800);
      const after = await height();
      await page.getByRole('button', { name: /Already signed in/u }).click();
      const stepped = await height();
      await context.close();
      expect(
        Math.abs(after - before),
        `${String(width)} px: ${String(before)} then ${String(after)}`,
      ).toBeLessThanOrEqual(3);
      expect(Math.abs(stepped - after), `${String(width)} px, a step chosen`).toBeLessThanOrEqual(
        3,
      );
    }
  });

  it('keeps the terminal output hidden until it is final: it never shows and then vanishes', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 900 } });
    const seen: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      seen.push(
        await page
          .locator('[data-panel="unix"] [class*="followUp"]')
          .evaluate((element) => getComputedStyle(element).visibility),
      );
      await page.waitForTimeout(60);
    }
    const firstVisible = seen.indexOf('visible');
    expect(firstVisible).toBeGreaterThan(-1);
    expect(seen.slice(firstVisible).every((state) => state === 'visible')).toBe(true);
    await close();
  });

  it('draws the resting routes at 3:1 against the surface they sit on, in both colour modes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { page, close } = await visit({ colorScheme: scheme, reducedMotion: 'reduce' });
      const ratio = await page.evaluate(() => {
        const channel = (value: number): number => {
          const unit = value / 255;
          return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (css: string): number => {
          const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/gu) ?? []).map(Number);
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const route = document.querySelector('svg[data-layout="wide"] path[class*="route"]');
        const section = document.querySelector('[data-section="signin"]');
        if (route === null || section === null) return 0;
        const light = Math.max(
          luminance(getComputedStyle(route).stroke),
          luminance(getComputedStyle(section).backgroundColor),
        );
        const dark = Math.min(
          luminance(getComputedStyle(route).stroke),
          luminance(getComputedStyle(section).backgroundColor),
        );
        return (light + 0.05) / (dark + 0.05);
      });
      expect(ratio, scheme).toBeGreaterThanOrEqual(3);
      await close();
    }
  });

  it('leaves room under the navbar when a section is the target of a link', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 800 } });
    const margins = await page.evaluate(() => {
      const bar = document.querySelector('nav.navbar');
      const navbar = bar === null ? 0 : bar.getBoundingClientRect().height;
      return [
        ...document.querySelectorAll(
          '[data-page="landing"] section[id], [data-page="landing"] section[aria-labelledby]',
        ),
      ].map((section) => Number.parseFloat(getComputedStyle(section).scrollMarginTop) - navbar);
    });
    expect(margins.length).toBeGreaterThanOrEqual(7);
    for (const margin of margins) expect(margin).toBeGreaterThanOrEqual(8);
    await close();
  });

  it('plays nothing and shows everything under reduced motion', async () => {
    const { page, close } = await visit({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      // The step marker marks nothing while the scene is at rest; the next test holds it still.
      const items = [...document.querySelectorAll('[data-page="landing"] *')].filter(
        (element) => element instanceof HTMLElement && element.closest('[data-pill]') === null,
      );
      return {
        pending: document.querySelectorAll('[data-pending]').length,
        running: document.getAnimations().length,
        hidden: items.filter((element) => getComputedStyle(element).opacity !== '1').length,
        moved: items.filter((element) => getComputedStyle(element).transform !== 'none').length,
      };
    });
    expect(state).toEqual({ pending: 0, running: 0, hidden: 0, moved: 0 });
    await close();
  });

  it('is fully visible for automation: no offset, no hidden band, on a capture without scrolling', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 800 } });
    await page.waitForTimeout(1200);
    expect(await page.locator('[data-pending]').count()).toBe(0);
    const least = await page.evaluate(() =>
      Math.min(
        ...[...document.querySelectorAll('[data-reveal], [data-flow-captions] > li')].map((item) =>
          Number(getComputedStyle(item).opacity),
        ),
      ),
    );
    expect(least).toBe(1);
    expect((await page.screenshot({ fullPage: true })).byteLength).toBeGreaterThan(50_000);
    await close();
  });

  it('reveals below-the-fold items for a visitor: each is fully visible within 1.5 s of entering view', async () => {
    const { page, close } = await visitHuman({ viewport: { width: 1280, height: 800 } });
    await page.locator('[data-motion="ok"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(900);
    const first = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-reveal]')];
      return {
        pending: items.filter((item) => item.hasAttribute('data-pending')).length,
        hidden: items.filter((item) => getComputedStyle(item).opacity === '0').length,
        above: items
          .filter((item) => item.getBoundingClientRect().top < window.innerHeight)
          .filter((item) => getComputedStyle(item).opacity !== '1').length,
      };
    });
    expect(first.pending).toBeGreaterThan(10);
    expect(first.hidden).toBeGreaterThan(10);
    expect(first.above).toBe(0);
    for (const heading of await page.locator('[data-reveal="heading"]').all()) {
      await heading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      const settled = await heading.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.opacity, new DOMMatrix(style.transform).m42];
      });
      expect(settled).toEqual(['1', 0]);
    }
    await close();
  });

  it('lets the reveal finish before it measures contrast, in both colour modes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { page, close } = await visitHuman({ colorScheme: scheme });
      await page.locator('[data-motion="ok"]').waitFor({ state: 'attached' });
      await page.evaluate(async () => {
        for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        window.scrollTo(0, 0);
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((violation: Result) => violation.id),
        scheme,
      ).toEqual([]);
      await close();
    }
  });

  it('releases items that were scrolled past in one jump', async () => {
    const { page, close } = await visitHuman({ viewport: { width: 1280, height: 800 } });
    await page.locator('[data-motion="ok"]').waitFor({ state: 'attached' });
    expect(await page.locator('[data-pending]').count()).toBeGreaterThan(10);
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(1500);
    expect(await page.locator('[data-pending]').count()).toBe(0);
    await close();
  });

  it('plays the sign-in scene in order, rests for about three seconds, then loops', async () => {
    const { page, close } = await visit(
      { viewport: { width: 1280, height: 800 } },
      async (target) => {
        await target.clock.install();
      },
    );
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    const step = async (): Promise<string> =>
      (await page.locator('[data-flow]').getAttribute('data-step')) ?? '';
    await page.locator('[data-flow][data-step="1"]').waitFor();
    const seen: string[] = [];
    for (const beat of BEATS) {
      seen.push(await step());
      await page.clock.runFor(beat.ms);
    }
    seen.push(await step());
    await page.clock.runFor(2900);
    seen.push(await step());
    await page.clock.runFor(200);
    seen.push(await step());
    expect(seen).toEqual(['1', '2', '3', '4', '5', '6', '7', '0', '0', '1']);
    await close();
  });

  it('eases the highlights, draws the routes and slides one marker, each defined in the CSS', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 800 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    const styles = await page.evaluate(() => {
      const read = (selector: string): { property: string; duration: string; ease: string } => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`no ${selector}`);
        const style = getComputedStyle(element);
        return {
          property: style.transitionProperty,
          duration: style.transitionDuration,
          ease: style.transitionTimingFunction,
        };
      };
      return {
        halo: read('svg[data-layout="wide"] [class*="halo"]'),
        signed: read('svg[data-layout="wide"] [class*="signed"]'),
        node: read('svg[data-layout="wide"] [class*="node"]'),
        route: read('svg[data-layout="wide"] [data-route-reveal]'),
        pill: read('[data-pill]'),
        button: read('[data-flow] [role="group"] button'),
      };
    });
    expect(styles.halo).toMatchObject({ property: 'opacity', duration: '0.4s', ease: SCENE_EASE });
    expect(styles.signed.duration).toBe('0.4s');
    expect(styles.node).toMatchObject({ property: 'transform', duration: '0.4s' });
    expect(styles.route).toMatchObject({
      property: 'stroke-dashoffset',
      duration: '0.7s',
      ease: SCENE_EASE,
    });
    expect(styles.pill.property).toContain('transform');
    expect(styles.pill.duration).toContain('0.4s');
    expect(styles.button.duration, 'label colour stays put under the marker').toBe('0s');
    await close();
  });

  it('has no transition and no animation under reduced motion, with the full scene and caption shown', async () => {
    const { page, close } = await visit({
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 800 },
    });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.getByRole('button', { name: /Back with a signed/u }).click();
    await page.getByRole('button', { name: /Already signed in/u }).click();
    const result = await page.evaluate(() => {
      const scope =
        'svg[data-layout="wide"] *, [data-flow] [role="group"] *, [data-live] *, [data-pill]';
      const timed = [...document.querySelectorAll(scope)].filter((element) => {
        const style = getComputedStyle(element);
        const moving = style.transitionDuration.split(',').some((value) => parseFloat(value) > 0);
        return moving || (style.animationName !== 'none' && style.display !== 'none');
      });
      const out = document.querySelector('[data-caption="out"]');
      const inside = document.querySelector('[data-caption="in"]');
      return {
        timed: timed.map((element) => element.getAttribute('class') ?? element.tagName),
        pillStill: [...document.querySelectorAll('[data-pill], [data-pill] *')].every((element) => {
          const style = getComputedStyle(element);
          return (
            style.transitionDuration.split(',').every((value) => parseFloat(value) === 0) &&
            (style.animationName === 'none' || style.display === 'none')
          );
        }),
        outHidden: out === null || getComputedStyle(out).display === 'none',
        caption: inside === null ? '' : getComputedStyle(inside).opacity,
        running: document
          .getAnimations()
          .filter(
            (animation) => animation instanceof CSSTransition && animation.playState === 'running',
          ).length,
      };
    });
    expect(result.timed.filter((name) => !/dot|ring|ticket|chipOn/u.test(name))).toEqual([]);
    expect(result.outHidden).toBe(true);
    expect(result.pillStill).toBe(true);
    expect(result.caption).toBe('1');
    expect(result.running).toBe(0);
    await close();
  });

  it('keeps the caption box one height across the steps, with room for its text, at every width', async () => {
    for (const width of [375, 768, 899, 900, 1000, 1099, 1280]) {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      await page.locator('[data-flow] [role="group"]').waitFor();
      const heights = new Set<number>();
      for (const beat of BEATS) {
        await page.getByRole('button', { name: new RegExp(beat.label, 'u') }).click();
        await page.waitForTimeout(950);
        const sizes = await page.evaluate(() => {
          const box = document.querySelector('[data-live]');
          const text = document.querySelector('[data-caption="in"]');
          const next = document.querySelector('[data-flow] > p');
          if (box === null || text === null || next === null) throw new Error('no caption box');
          return {
            box: box.getBoundingClientRect().height,
            text: text.getBoundingClientRect().height,
            gap: next.getBoundingClientRect().top - box.getBoundingClientRect().bottom,
          };
        });
        heights.add(sizes.box);
        expect(sizes.text, `${beat.label} at ${String(width)}`).toBeLessThanOrEqual(
          sizes.box + 0.5,
        );
        expect(sizes.gap, `${beat.label} at ${String(width)}`).toBeGreaterThanOrEqual(0);
      }
      expect([...heights], `at ${String(width)}`).toHaveLength(1);
      await close();
    }
  });

  it('keeps room for the caption under the text-spacing overrides a reader may apply', async () => {
    const spacing =
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }';
    for (const width of [375, 900, 1280]) {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      await page.addStyleTag({ content: spacing });
      await page.locator('[data-flow] [role="group"]').waitFor();
      const heights = new Set<number>();
      for (const beat of BEATS) {
        await page.getByRole('button', { name: new RegExp(beat.label, 'u') }).click();
        await page.waitForTimeout(950);
        const sizes = await page.evaluate(() => {
          const box = document.querySelector('[data-live]');
          const text = document.querySelector('[data-caption="in"]');
          const next = document.querySelector('[data-flow] > p');
          if (box === null || text === null || next === null) throw new Error('no caption box');
          return {
            box: box.getBoundingClientRect().height,
            text: text.getBoundingClientRect().height,
            gap: next.getBoundingClientRect().top - box.getBoundingClientRect().bottom,
          };
        });
        heights.add(sizes.box);
        expect(sizes.text, `${beat.label} at ${String(width)}`).toBeLessThanOrEqual(
          sizes.box + 0.5,
        );
        expect(sizes.gap, `${beat.label} at ${String(width)}`).toBeGreaterThanOrEqual(0);
      }
      expect([...heights], `at ${String(width)}`).toHaveLength(1);
      await close();
    }
  });

  it('shows each step on one line where the stepper has labels, and names it in full everywhere', async () => {
    for (const width of [900, 1000, 1099, 1100, 1200, 1280]) {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      await page.locator('[data-flow] [role="group"]').waitFor();
      const report = await page.evaluate(() => {
        const group = document.querySelector('[data-flow] [role="group"]');
        if (group === null) throw new Error('no stepper');
        const buttons = [...group.querySelectorAll('button')];
        return {
          height: group.getBoundingClientRect().height,
          names: buttons.map((button) => button.getAttribute('aria-label')),
          clipped: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).length,
          lines: buttons.map((button) => button.getBoundingClientRect().height),
        };
      });
      expect(report.names, `at ${String(width)}`).toEqual(BEATS.map((beat) => beat.label));
      expect(report.clipped, `at ${String(width)}`).toBe(0);
      expect(Math.max(...report.lines), `at ${String(width)}`).toBeLessThan(48);
      expect(report.height, `at ${String(width)}`).toBeLessThan(48);
      await close();
    }
  });

  it('samples the middle of a route draw, the marker slide and the caption hand-over', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 1100 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.getByRole('button', { name: /Sign in once/u }).click();
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-flow] [role="group"] button')];
      return {
        three: buttons[2]?.getBoundingClientRect().left,
        four: buttons[3]?.getBoundingClientRect().left,
      };
    });
    await page.getByRole('button', { name: /Back with a signed/u }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    const at = (
      time: number,
    ): Promise<{
      dash: number;
      pill: number;
      out: number;
      inside: number;
    }> =>
      page.evaluate((moment) => {
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = moment;
        }
        const reveal = document.querySelector('svg[data-layout="wide"] [data-route-reveal="ha"]');
        const pill = document.querySelector('[data-pill]');
        const out = document.querySelector('[data-caption="out"]');
        const inside = document.querySelector('[data-caption="in"]');
        if (reveal === null || pill === null || out === null || inside === null) {
          throw new Error('nothing to sample');
        }
        return {
          dash: Number.parseFloat(getComputedStyle(reveal).strokeDashoffset),
          pill: pill.getBoundingClientRect().left,
          out: Number(getComputedStyle(out).opacity),
          inside: Number(getComputedStyle(inside).opacity),
        };
      }, time);
    const start = await at(0);
    const middle = await at(230);
    const drawing = await at(500);
    const end = await at(1400);
    expect(start.dash).toBeCloseTo(1, 1);
    expect(drawing.dash).toBeGreaterThan(0.2);
    expect(drawing.dash).toBeLessThan(0.8);
    expect(end.dash).toBeCloseTo(0, 1);
    expect(start.pill).toBeCloseTo(before.three ?? 0, 0);
    expect(middle.pill).toBeGreaterThan((before.three ?? 0) + 1);
    expect(middle.pill).toBeLessThan((before.four ?? 0) - 1);
    expect(end.pill).toBeCloseTo(before.four ?? 0, 0);
    expect(start.out).toBe(1);
    expect(middle.out).toBeLessThan(0.5);
    expect(start.inside).toBe(0);
    expect(middle.inside).toBeGreaterThan(0.1);
    expect(middle.inside).toBeLessThan(0.95);
    expect(end.inside).toBe(1);
    await close();
  });

  it('shows a clicked caption within about 120 ms of the click, a timed one after the scene moves', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 1100 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.getByRole('button', { name: /Sign in once/u }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Back with a signed/u }).click();
    const delays = await page.evaluate(() => {
      const animations = document.querySelector('[data-caption="in"]')?.getAnimations() ?? [];
      return animations.map((animation) => animation.effect?.getTiming().delay);
    });
    expect(delays).toEqual([80]);
    await close();
  });

  it('drops the caption that left from the page, and lets none that was never shown leave', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 1100 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.getByRole('button', { name: /Sign in once/u }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Back with a signed/u }).click();
    expect(await page.locator('[data-caption="out"]').count()).toBe(1);
    await page.waitForTimeout(1200);
    expect(await page.locator('[data-caption="out"]').count()).toBe(0);
    expect(await page.getByText(/Step 3 of 7/u).count()).toBe(0);
    await page.getByRole('button', { name: /Open a second app/u }).click();
    await page.getByRole('button', { name: /Already signed in/u }).click();
    expect(await page.locator('[data-caption="out"]').count(), 'a caption still rising').toBe(0);
    await close();
  });

  it('keeps the marker on the last step when the scene returns to rest', async () => {
    const { page, close } = await visit(
      { viewport: { width: 1280, height: 1100 } },
      async (target) => {
        await target.clock.install();
      },
    );
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-flow][data-step="1"]').waitFor();
    for (const beat of BEATS) await page.clock.runFor(beat.ms);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('0');
    await page.waitForTimeout(700);
    const place = await page.evaluate(() => {
      const pill = document.querySelector('[data-pill]');
      const buttons = [...document.querySelectorAll('[data-flow] [role="group"] button')];
      const last = buttons[buttons.length - 1];
      if (pill === null || last === undefined) throw new Error('no marker');
      return {
        gap: Math.abs(pill.getBoundingClientRect().left - last.getBoundingClientRect().left),
        opacity: Number(getComputedStyle(pill).opacity),
      };
    });
    expect(place.gap).toBeLessThan(1.5);
    expect(place.opacity).toBe(0);
    await close();
  });

  it('stops playing when reduced motion is turned on while the scene plays', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 1100 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-flow][data-step="1"]').waitFor();
    expect(await page.getByRole('button', { name: 'Pause autoplay' }).count()).toBe(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Play autoplay' }).waitFor();
    const step = await page.locator('[data-flow]').getAttribute('data-step');
    await page.waitForTimeout(3200);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe(step);
    await close();
  });

  it('sits the one marker under the chosen step and fills it over the step clock', async () => {
    for (const width of [375, 1280]) {
      const { page, close } = await visit({ viewport: { width, height: 900 } });
      await page.locator('[data-flow] [role="group"]').waitFor();
      await page.evaluate(() => {
        document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
      });
      await page.locator('[data-flow][data-step="1"]').waitFor();
      expect(await page.locator('[data-pill]').count()).toBe(1);
      expect(await page.locator('[data-fill]').count()).toBe(1);
      const fill = await page.evaluate(() => {
        const animation = document.querySelector('[data-fill]')?.getAnimations()[0];
        return {
          duration: animation?.effect?.getTiming().duration,
          name: animation instanceof CSSAnimation ? animation.animationName : '',
        };
      });
      expect(fill.duration).toBe(BEATS[0]?.ms);
      expect(fill.name).toMatch(/^fill/u);
      for (const index of [2, 5, 7]) {
        const label = BEATS[index - 1]?.label ?? '';
        await page.getByRole('button', { name: new RegExp(label, 'u') }).click();
        await page.waitForTimeout(700);
        const place = await page.evaluate((position) => {
          const pill = document.querySelector('[data-pill]')?.getBoundingClientRect();
          const buttons = [...document.querySelectorAll('[data-flow] [role="group"] button')];
          const button = buttons[position - 1]?.getBoundingClientRect();
          if (pill === undefined || button === undefined) throw new Error('no marker');
          return { left: pill.left - button.left, width: pill.width - button.width };
        }, index);
        expect(Math.abs(place.left), `step ${String(index)} at ${String(width)}`).toBeLessThan(1.5);
        expect(Math.abs(place.width)).toBeLessThan(1.5);
        expect(await page.locator('[data-fill]').count(), 'a chosen step does not play').toBe(0);
      }
      await close();
    }
  });

  it('restarts the fill from the start when playing resumes on the same beat', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 800 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-flow][data-step="2"]').waitFor();
    const progress = (): Promise<number> =>
      page.evaluate(() => {
        const animation = document.querySelector('[data-fill]')?.getAnimations()[0];
        return Number(animation?.currentTime ?? -1);
      });
    const early = await progress();
    expect(early).toBeGreaterThanOrEqual(0);
    expect(early).toBeLessThan(BEATS[1]?.ms ?? 0);
    await page.getByRole('button', { name: /Pause autoplay/u }).click();
    expect(await page.locator('[data-fill]').count()).toBe(0);
    await page.getByRole('button', { name: /Play autoplay/u }).click();
    expect(await progress()).toBeLessThan(500);
    await close();
  });

  it('hands the caption over: the old drifts out, the new rises in, and nothing below shifts', async () => {
    const { page, close } = await visit({ viewport: { width: 1280, height: 800 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    const more = page.locator('[data-flow] p', { hasText: 'The ideas are in' });
    await page.getByRole('button', { name: /Sign in once/u }).click();
    await page.waitForTimeout(900);
    const below = await more.evaluate((element) => element.getBoundingClientRect().top);
    await page.getByRole('button', { name: /Back with a signed/u }).click();
    const seen = await page.evaluate(
      () =>
        new Promise<{ out: string; inside: string; outText: string }>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const out = document.querySelector('[data-caption="out"]');
              const inside = document.querySelector('[data-caption="in"]');
              resolve({
                out: out === null ? '' : getComputedStyle(out).animationName,
                inside: inside === null ? '' : getComputedStyle(inside).animationName,
                outText: out?.textContent ?? '',
              });
            });
          });
        }),
    );
    expect(seen.out).toContain('drift-out');
    expect(seen.inside).toContain('rise-in');
    expect(seen.outText).toContain('Step 3 of 7');
    await page.waitForTimeout(900);
    expect(await more.evaluate((element) => element.getBoundingClientRect().top)).toBe(below);
    await close();
  });

  it('pauses when the scene leaves the screen and resumes on the same beat', async () => {
    const { page, close } = await visit(
      { viewport: { width: 1280, height: 800 } },
      async (target) => {
        await target.clock.install();
      },
    );
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-flow][data-step="1"]').waitFor();
    await page.clock.runFor((BEATS[0]?.ms ?? 0) + 100);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('2');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
    await page.clock.runFor(60_000);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('2');
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    await page.clock.runFor((BEATS[1]?.ms ?? 0) + 100);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('3');
    await close();
  });

  it('pauses on a step that was chosen, and the toggle works from the keyboard', async () => {
    const { page, close } = await visit(
      { viewport: { width: 1280, height: 800 } },
      async (target) => {
        await target.clock.install();
      },
    );
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-flow][data-step="1"]').waitFor();
    const order = await page
      .locator('[data-flow] button')
      .evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).innerText.trim()));
    expect(order[0]).toBe('Pause');
    await page.getByRole('button', { name: /Sign in once/u }).click();
    await page.clock.runFor(BEATS.reduce((sum, beat) => sum + beat.ms, 0) * 2);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('3');
    const toggle = page.getByRole('button', { name: /autoplay$/u });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await page.clock.runFor((BEATS[2]?.ms ?? 0) + 50);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('4');
    await page.keyboard.press('Space');
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    expect(await page.locator('[data-flow] [role="status"]').getAttribute('aria-live')).toBe(
      'polite',
    );
    await close();
  });

  it('does not autoplay under reduced motion, but can be stepped by hand and played on request', async () => {
    const { page, close } = await visit({
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 800 },
    });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(2500);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('0');
    expect(await page.locator('[data-flow-captions] > li').count()).toBe(7);
    await page.getByRole('button', { name: /Already signed in/u }).click();
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('6');
    expect(await page.getByRole('button', { name: 'Play autoplay' }).count()).toBe(1);
    await close();
  });

  it('starts the scene on a short landscape screen', async () => {
    const { page, close } = await visit({ viewport: { width: 740, height: 390 } });
    await page.locator('[data-flow] [role="group"]').waitFor();
    await page.evaluate(() => {
      document.querySelector('[data-flow]')?.scrollIntoView({ block: 'start' });
    });
    await page.locator('[data-flow][data-step="1"]').waitFor({ timeout: 5000 });
    await close();
  });

  it('shows the composed scene and all seven captions with JavaScript disabled', async () => {
    const { page, close } = await visit({
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: false,
    });
    expect(await page.locator('[data-flow] [role="group"]').isVisible()).toBe(false);
    expect(await page.locator('[data-flow]').getAttribute('data-step')).toBe('0');
    const captions = page.locator('[data-flow-captions] > li');
    expect(await captions.count()).toBe(7);
    for (let index = 0; index < 7; index += 1) {
      expect(await captions.nth(index).isVisible()).toBe(true);
    }
    expect(await page.locator('svg[data-layout="wide"]').isVisible()).toBe(true);
    await close();
  });

  it('hydrates without a console error, so the server markup is kept', async () => {
    const errors: string[] = [];
    const { page, close } = await visit({}, (target) => {
      target.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      target.on('pageerror', (error) => {
        errors.push(String(error));
      });
      return Promise.resolve();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const detached = await page.evaluate(() => document.querySelector('[data-flow]')?.isConnected);
    expect(errors).toEqual([]);
    expect(detached).toBe(true);
    await close();
  });

  it('loads no script, font or other file from another origin', async () => {
    const hosts = new Set<string>();
    const { page, close } = await visit({}, (target) => {
      target.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith('http')) hosts.add(url.host);
      });
      return Promise.resolve();
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect([...hosts]).toEqual([new URL(origin).host]);
    await close();
  });

  it('keeps first-load JavaScript under 184 KB gzip', async () => {
    const { page, close } = await visit({}, async (target) => {
      const client = await target.context().newCDPSession(target);
      await client.send('Network.enable');
      const scripts = new Set<string>();
      let bytes = 0;
      client.on('Network.responseReceived', (event) => {
        if (event.type === 'Script') scripts.add(event.requestId);
      });
      client.on('Network.loadingFinished', (event) => {
        if (scripts.has(event.requestId)) bytes += event.encodedDataLength;
      });
      await target.exposeFunction('scriptBytes', () => bytes);
    });
    await page.waitForLoadState('networkidle');
    const bytes = await page.evaluate(() =>
      (window as unknown as { scriptBytes(): Promise<number> }).scriptBytes(),
    );
    expect(bytes).toBeGreaterThan(50_000);
    // The route registry in the main chunk grows with every page; 184 KB leaves the headroom 180 KB had.
    expect(bytes).toBeLessThan(184 * 1024);
    await close();
  });

  for (const width of [320, 375, 390, 768, 1280]) {
    it(`shifts almost nothing when the fonts arrive late, at ${String(width)} px`, async () => {
      if (browser === undefined) throw new Error('the browser did not launch');
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      await slowCpu(page);
      await page.route('**/*.woff2', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.addInitScript(() => {
        const holder = window as unknown as { shift: number; seen: string[] };
        holder.shift = 0;
        holder.seen = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const record = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources: { node: Node | null }[];
            };
            if (record.hadRecentInput) continue;
            holder.shift += record.value;
            holder.seen.push(
              `${record.value.toFixed(4)} ${record.sources.map((source) => source.node?.parentElement?.className ?? '').join(' ')}`,
            );
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      // Stop at the first byte: the page is drawn in the fallback faces, and the
      // swap to Plex happens when the delayed files arrive.
      await page.goto(home(), { waitUntil: 'commit' });
      await page.waitForFunction(
        () =>
          [...document.fonts].some(
            (face) => face.family === 'IBM Plex Sans' && face.status === 'loaded',
          ),
        undefined,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(700);
      const result = await page.evaluate(() => {
        const holder = window as unknown as { shift: number; seen: string[] };
        return { shift: holder.shift, seen: holder.seen };
      });
      expect(result.shift, result.seen.join(' | ')).toBeLessThan(0.02);
      await context.close();
    });
  }
});
