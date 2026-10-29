import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, expectFitsViewport, signIn, test } from './fixtures';
import { seeded } from './stack';

const { branding } = seeded().config;

const FRAME = 'iframe[title="Preview of the page"]';
const MAIL_FRAME = 'iframe[title="Preview of the verification mail"]';
const TABS = ['Theme', 'Pages', 'Mail', 'Languages'] as const;

const WIDTHS = [
  ['a small phone', { width: 320, height: 640 }],
  ['a phone', { width: 375, height: 812 }],
  ['a tablet', { width: 768, height: 1024 }],
] as const;

async function openTab(page: Page, tab: string): Promise<void> {
  await page.goto(`/console/${branding.layout.tenant}/branding`);
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function openClientBranding(page: Page): Promise<void> {
  const { client } = branding;
  await page.goto(`/console/${client.tenant}/clients`);
  await page
    .getByRole('grid', { name: 'Clients' })
    .getByRole('row', { name: /brand-app/u })
    .click();
  await page.getByRole('tab', { name: 'Branding' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toBeVisible();
}

const strip = (page: Page): Locator => page.getByRole('region', { name: 'Preview', exact: true });

for (const [name, viewport] of WIDTHS) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport });

    test('every tab fits the screen, with no sideways scroll of the page', async ({ page }) => {
      test.slow();
      await signIn(page, branding.layout);
      for (const tab of TABS) {
        await openTab(page, tab);
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        await expectFitsViewport(page, tab);
      }
      await openClientBranding(page);
      await expectFitsViewport(page, 'a client’s Branding tab');
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the preview is a strip pinned at the bottom of the screen, a miniature of the sandboxed page', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    const pane = strip(page);
    await expect(pane.getByRole('button', { name: 'Open preview' })).toBeVisible();
    await expect(pane.getByText('Sign in · Light')).toBeVisible();
    const frame = pane.locator(FRAME);
    await expect(frame).toHaveAttribute('sandbox', '');

    // A fifth of a phone's page, drawn in a clip of 72 by 88 pixels.
    const clip = await frame.locator('xpath=..').boundingBox();
    expect(clip?.width).toBeCloseTo(72, 0);
    expect(clip?.height).toBeCloseTo(88, 0);

    // Pinned to the bottom edge while the editor is above it, wherever it is scrolled to.
    for (const to of [0, 600, 1500]) {
      await page.evaluate((y) => {
        window.scrollTo(0, y);
      }, to);
      const box = await pane.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.y + box.height).toBeLessThanOrEqual(812 + 1);
      expect(box.y + box.height).toBeGreaterThan(812 - 40);
      expect(box.height).toBeLessThan(140);
    }
  });

  test('Open raises a named sheet with the page at real proportions, and closing returns to the same place', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    await page.evaluate(() => {
      window.scrollTo(0, 700);
    });
    const before = await page.evaluate(() => window.scrollY);
    const open = strip(page).getByRole('button', { name: 'Open preview' });
    await open.click();

    const sheet = page.getByRole('dialog', { name: 'Page preview' });
    await expect(sheet).toBeVisible();
    const frame = sheet.locator(FRAME);
    await expect(frame).toHaveAttribute('sandbox', '');
    const box = await frame.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(340);
    expect(box?.height ?? 0).toBeGreaterThan(300);
    await expect(frame.contentFrame().getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Focus is inside it and stays inside.
    await expect(sheet).toContainText('Colour scheme');
    for (let tab = 0; tab < 8; tab += 1) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }

    // The switches are the phone's own selects, and the frame follows them.
    await sheet.getByRole('combobox', { name: 'Colour scheme' }).selectOption('dark');
    await expect(frame).toHaveAttribute('src', /scheme=dark/u);
    await sheet.getByRole('combobox', { name: 'Page' }).selectOption('registration');
    await expect(frame).toHaveAttribute('src', /kind=registration/u);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await expect(strip(page).getByText('Registration · Dark')).toBeVisible();
  });

  test('the Mail tab’s preview is a strip and a sheet too', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Mail');
    const pane = strip(page);
    await expect(pane.getByText('Email · Light · The tenant’s default')).toBeVisible();
    await pane.getByRole('button', { name: 'Open preview' }).click();
    const sheet = page.getByRole('dialog', { name: 'Page preview' });
    await expect(sheet.locator(MAIL_FRAME)).toHaveAttribute('sandbox', '');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('the publication bar is one row: Publish stays, the rest is under a menu', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Pages');
    const bar = page.getByRole('region', { name: 'Publish', exact: true });
    await expect(bar.getByRole('button', { name: 'Publish the draft' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Discard draft…' })).toBeHidden();
    const box = await bar.boundingBox();
    expect(box?.height ?? 999).toBeLessThan(120);

    await bar.getByRole('button', { name: 'More publishing actions' }).click();
    const menu = page.getByRole('menu', { name: 'More publishing actions' });
    await expect(
      menu.getByRole('menuitem', { name: /Revert this tab to published/u }),
    ).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Discard draft…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(bar.getByRole('button', { name: 'More publishing actions' })).toBeFocused();

    // The tab's own Revert panel is not repeated below.
    await expect(page.getByRole('region', { name: 'Revert to published' })).toBeHidden();
  });

  test('the palettes are folds, and the open tab is brought into view', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    const section = page.getByRole('region', { name: 'Colours and font' });
    const light = section.getByRole('button', { name: 'Light colours' });
    await expect(light).toHaveAttribute('aria-expanded', 'false');
    await expect(section.getByRole('switch', { name: 'Use my own light colours' })).toBeHidden();
    await light.click();
    await expect(light).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByRole('switch', { name: 'Use my own light colours' })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/console/${branding.layout.tenant}/branding?tab=languages`);
    const selected = page.getByRole('tab', { name: 'Languages', exact: true });
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    const list = page.getByRole('tablist');
    await expect
      .poll(async () => {
        const [tab, row] = await Promise.all([selected.boundingBox(), list.boundingBox()]);
        if (tab === null || row === null) return false;
        return tab.x >= row.x - 1 && tab.x + tab.width <= row.x + row.width + 1;
      })
      .toBe(true);
  });

  test('the Pages picker is the phone’s own select, and a code field can wrap', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Pages');
    const templates = page.getByRole('region', { name: 'Page templates' });
    await expect(templates.getByRole('combobox', { name: 'Page' })).toBeVisible();
    const editor = templates.getByRole('textbox', { name: /template$/u });
    await editor.fill(`<main>${'long '.repeat(60)}</main>`);
    const wrap = templates.getByRole('button', { name: 'Wrap lines' });
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    const scrolls = (): Promise<number> =>
      editor.evaluate((area) => {
        const scroller = area.closest('[data-code-scroller]');
        return (scroller?.scrollWidth ?? 0) - (scroller?.clientWidth ?? 0);
      });
    expect(await scrolls()).toBeGreaterThan(100);
    await wrap.click();
    expect(await scrolls()).toBeLessThanOrEqual(1);
    await expectFitsViewport(page);
  });

  test('controls are 44 pixels or more, and inputs are not set below 16', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    for (const tab of TABS) {
      await openTab(page, tab);
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      const found = await page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll(
            'main button, main select, main input:not([type=hidden]), main [role=tab], main [role=switch], main [role=checkbox]',
          ),
        ];
        const small: string[] = [];
        const type: string[] = [];
        for (const node of controls) {
          const box = node.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          // The select a custom one keeps for forms, which is not what is pressed.
          if (node.closest('[aria-hidden=true]') !== null) continue;
          const name = `${node.tagName.toLowerCase()} "${(node.getAttribute('aria-label') ?? node.textContent).trim().slice(0, 30)}"`;
          if (box.height < 43.5) small.push(`${name} ${String(Math.round(box.height))}px`);
          if (/^(INPUT|SELECT|TEXTAREA)$/u.test(node.tagName)) {
            const size = Number.parseFloat(getComputedStyle(node).fontSize);
            if (size < 16) type.push(`${name} ${String(size)}px`);
          }
        }
        for (const area of document.querySelectorAll('main textarea')) {
          const size = Number.parseFloat(getComputedStyle(area).fontSize);
          if (size < 16) type.push(`textarea ${String(size)}px`);
        }
        return { small, type };
      });
      expect(found, tab).toEqual({ small: [], type: [] });
    }
  });

  test('has nothing axe can find, with the sheet open', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    await expectAccessible(page, { exclude: [FRAME] });
    await strip(page).getByRole('button', { name: 'Open preview' }).click();
    await expect(page.getByRole('dialog', { name: 'Page preview' })).toBeVisible();
    await expectAccessible(page, { exclude: [FRAME] });
  });
});
