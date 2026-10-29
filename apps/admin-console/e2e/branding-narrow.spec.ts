import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, expectFitsViewport, signIn, test } from './fixtures';
import { FRAME, MAIL_SHEET_FRAME, SHEET_FRAME } from './branding-frames';
import { seeded } from './stack';

const branding = seeded().config.branding;

const TABS = ['Theme', 'Pages', 'Mail', 'Languages'] as const;

const WIDTHS = [
  ['a small phone', { width: 320, height: 640 }],
  ['a phone', { width: 375, height: 812 }],
  ['a large phone', { width: 390, height: 844 }],
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
    });

    test('no two controls or lines of text overlap, and no text is cut off without a title', async ({
      page,
    }) => {
      test.slow();
      await signIn(page, branding.layout);
      for (const tab of TABS) {
        await openTab(page, tab);
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        const found = await page.evaluate(() => {
          const visible = (node: Element): boolean => {
            const box = node.getBoundingClientRect();
            return (
              box.width > 2 && box.height > 2 && getComputedStyle(node).visibility !== 'hidden'
            );
          };
          const inStrip = (node: Element): boolean => node.closest('[data-preview-strip]') !== null;
          // Things that are read or pressed: leaves of text, and the controls.
          const items = [
            ...document.querySelectorAll(
              'main button, main input, main select, main textarea, main [role=tab], main a, main :is(p, span, h1, h2, h3, li, label, legend, dt, dd, code):not(:has(*))',
            ),
          ].filter(
            (node) =>
              visible(node) &&
              node.closest('[aria-hidden=true]') === null &&
              (node.textContent.trim() !== '' ||
                !/^(P|SPAN|H\d|LI|LABEL|LEGEND|DT|DD|CODE)$/u.test(node.tagName)),
          );
          const overlaps: string[] = [];
          const name = (node: Element): string =>
            `<${node.tagName.toLowerCase()}> "${(node.getAttribute('aria-label') ?? node.textContent).trim().slice(0, 28)}"`;
          for (let a = 0; a < items.length; a += 1) {
            for (let b = a + 1; b < items.length; b += 1) {
              const [x, y] = [items[a], items[b]];
              if (x === undefined || y === undefined) continue;
              if (x.contains(y) || y.contains(x) || inStrip(x) !== inStrip(y)) continue;
              const p = x.getBoundingClientRect();
              const q = y.getBoundingClientRect();
              const wide = Math.min(p.right, q.right) - Math.max(p.left, q.left);
              const high = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
              if (wide > 3 && high > 3) overlaps.push(`${name(x)} over ${name(y)}`);
            }
          }
          const cut = items
            .filter((node) => {
              const style = getComputedStyle(node);
              const clips = style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
              return (
                clips &&
                node.scrollWidth > node.clientWidth + 1 &&
                !node.hasAttribute('title') &&
                node.closest('[title]') === null
              );
            })
            .map(name);
          return { overlaps, cut };
        });
        expect(found, tab).toEqual({ overlaps: [], cut: [] });
      }
    });

    test('a client’s Branding tab fits the screen too', async ({ page }) => {
      test.slow();
      await signIn(page, branding.client);
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
      expect(box.height).toBeLessThan(110);
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
    const frame = sheet.locator(SHEET_FRAME);
    await expect(frame).toHaveAttribute('sandbox', '');
    const box = await frame.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
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

  test('the strip never hides content: the last of each tab rests above it, and a focused field is cleared of it', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    for (const tab of ['Theme', 'Pages', 'Mail'] as const) {
      await openTab(page, tab);
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const clearance = await page.evaluate(() => {
        const pane = document.querySelector('[data-preview-strip]');
        if (pane === null) return -1;
        const top = pane.getBoundingClientRect().top;
        const lowest = [...document.querySelectorAll('main *')]
          .filter(
            (node) => !pane.contains(node) && !node.contains(pane) && node.children.length === 0,
          )
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .reduce((most, box) => Math.max(most, box.bottom), 0);
        return top - lowest;
      });
      expect(clearance, tab).toBeGreaterThanOrEqual(-1);
    }

    // Straight to the tab, so nothing moves focus after the field has it.
    await page.goto(`/console/${branding.layout.tenant}/branding?tab=pages`);
    await expect(page.getByRole('region', { name: 'Page templates' })).toBeVisible();
    const field = page.getByRole('combobox', { name: 'Insert a message' });
    await field.focus();
    const fieldBox = await field.boundingBox();
    const bottom = (fieldBox?.y ?? 0) + (fieldBox?.height ?? 0);
    // The strip lets go of the screen's edge while a field of the editor has focus.
    await expect
      .poll(async () => (await strip(page).boundingBox())?.y ?? 0)
      .toBeGreaterThanOrEqual(bottom);
  });

  test('the Mail tab’s preview is a strip and a sheet too', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Mail');
    const pane = strip(page);
    await expect(pane.getByText('Email · Light · The tenant’s default')).toBeVisible();
    await pane.getByRole('button', { name: 'Open preview' }).click();
    const sheet = page.getByRole('dialog', { name: 'Page preview' });
    await expect(sheet.locator(MAIL_SHEET_FRAME)).toHaveAttribute('sandbox', '');
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
    // Publish and the menu sit on one row.
    const publish = await bar.getByRole('button', { name: 'Publish the draft' }).boundingBox();
    const more = await bar.getByRole('button', { name: 'More publishing actions' }).boundingBox();
    expect(Math.abs((publish?.y ?? 0) - (more?.y ?? 999))).toBeLessThan(2);

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
          // A control inside a bordered group is as large as the group.
          const outer = node.parentElement?.getBoundingClientRect().height ?? 0;
          const height = outer - box.height < 6 ? Math.max(box.height, outer) : box.height;
          if (height < 43.5) small.push(`${name} ${String(Math.round(box.height))}px`);
          // What takes text, which a phone zooms to when it is under 16px; a
          // checkbox or a file chooser takes none.
          const takesText =
            node.tagName !== 'INPUT' ||
            /^(text|search|email|url|tel|number|password)?$/u.test(node.getAttribute('type') ?? '');
          if (/^(INPUT|SELECT|TEXTAREA)$/u.test(node.tagName) && takesText) {
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

  test('the sheet and the More menu, which are portals, keep 44 pixel targets and 16 pixel inputs', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Pages');
    await strip(page).getByRole('button', { name: 'Open preview' }).click();
    const sheet = page.getByRole('dialog', { name: 'Page preview' });
    await expect(sheet).toBeVisible();
    const inSheet = await sheet.evaluate((node) =>
      [...node.querySelectorAll('button, select, input')].map((control) => {
        const box = control.getBoundingClientRect();
        return {
          name: `${control.tagName.toLowerCase()} ${(control.getAttribute('aria-label') ?? control.textContent).trim().slice(0, 20)}`,
          height: box.height,
          font: Number.parseFloat(getComputedStyle(control).fontSize),
          field: control.tagName !== 'BUTTON',
        };
      }),
    );
    expect(inSheet.length).toBeGreaterThanOrEqual(2);
    for (const control of inSheet) {
      expect(control.height, control.name).toBeGreaterThanOrEqual(43.5);
      if (control.field) expect(control.font, control.name).toBeGreaterThanOrEqual(16);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    const bar = page.getByRole('region', { name: 'Publish', exact: true });
    await bar.getByRole('button', { name: 'More publishing actions' }).click();
    const items = await page
      .getByRole('menu', { name: 'More publishing actions' })
      .getByRole('menuitem')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(items.length).toBeGreaterThan(0);
    for (const height of items) expect(height).toBeGreaterThanOrEqual(43.5);
  });

  test('the miniature is not in the tab order, and the Pages parts list folds shut', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Pages');
    await expect(strip(page).locator(FRAME)).toHaveAttribute('tabindex', '-1');
    const fold = page.getByRole('button', { name: 'Parts of this page' });
    const parts = page.getByText('Required, each exactly once:');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(parts).toBeHidden();
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(parts).toBeVisible();
  });

  test('a confirmation, which is a portal, keeps 44 pixel buttons', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    await page.getByRole('button', { name: 'Reset to default…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const heights = await dialog
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(1);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(43.5);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('has nothing axe can find, with the sheet open', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    await expectAccessible(page, { exclude: [FRAME] });
    await strip(page).getByRole('button', { name: 'Open preview' }).click();
    await expect(page.getByRole('dialog', { name: 'Page preview' })).toBeVisible();
    await expectAccessible(page, { exclude: [FRAME, SHEET_FRAME] });
  });
});

// The bar folds when the editor under it is 48rem wide or less, and the editor's own
// Revert panel is put away at the same width, so at no width are both gone or both there.
for (const width of [1118, 1120, 1122, 1124, 1126, 639, 641, 767, 769]) {
  test.describe(`at ${String(width)} pixels`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('Revert is on the bar or on the tab, never on neither and never on both', async ({
      page,
    }) => {
      test.slow();
      await signIn(page, branding.layout);
      await openTab(page, 'Pages');
      const bar = page.getByRole('region', { name: 'Publish', exact: true });
      const folded = await bar.getByRole('button', { name: 'More publishing actions' }).isVisible();
      const panel = await page
        .getByRole('region', { name: 'Revert to published' })
        .getByRole('button', { name: 'Revert this tab to published' })
        .isVisible();
      expect(folded, `folded ${String(folded)}, panel ${String(panel)}`).toBe(!panel);
    });
  });
}

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the preview frame can be reached and scrolled by the keyboard', async ({ page }) => {
    test.slow();
    await signIn(page, branding.layout);
    await openTab(page, 'Theme');
    const frame = page.locator(FRAME);
    await expect(frame).not.toHaveAttribute('tabindex');
    let reached = false;
    for (let pressed = 0; pressed < 150 && !reached; pressed += 1) {
      // A code field indents on Tab, and lets go with Escape.
      const inCode = await page.evaluate(
        () => document.activeElement?.getAttribute('wrap') === 'off',
      );
      if (inCode) await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      reached = await frame.evaluate((node) => node === document.activeElement);
    }
    expect(reached).toBe(true);
  });
});
