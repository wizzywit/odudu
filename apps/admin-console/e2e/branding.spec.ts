import type { Browser, FrameLocator, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  test,
  LAPTOP,
  PHONE,
} from './fixtures';
import { FRAME, MAIL_FRAME } from './branding-frames';
import { authorize } from './page-flows';
import { seeded } from './stack';

const { branding } = seeded().config;
const TABLET = { width: 768, height: 1024 };

// A 1 x 1 PNG, which is all a logo needs to be to be stored.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Tab until `target` has focus. A code field indents on Tab, so a keyboard
// user leaves it with Escape first, which is what this does there.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let pressed = 0; pressed < 120; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    const inCode = await page.evaluate(
      () => document.activeElement?.getAttribute('wrap') === 'off',
    );
    if (inCode) await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openBranding(page: Page, tenant: string): Promise<void> {
  await page.goto(`/console/${tenant}/branding`);
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Colours and font' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

function preview(page: Page): FrameLocator {
  return page.frameLocator(FRAME);
}

async function customiseLight(page: Page, background: string): Promise<Locator> {
  const section = page.getByRole('region', { name: 'Colours and font' });
  // Narrow, each palette is folded under its legend.
  const fold = section.getByRole('button', { name: 'Light colours' });
  if ((await fold.isVisible()) && (await fold.getAttribute('aria-expanded')) === 'false') {
    await fold.click();
  }
  await section.getByText('Use my own light colours', { exact: true }).click();
  await section
    .getByRole('textbox', { name: 'Light page background', exact: true })
    .fill(background);
  return section;
}

async function save(section: Locator): Promise<void> {
  await section.getByRole('button', { name: /^Save/u }).click();
  await expect(section.getByRole('button', { name: /^Save/u })).toBeHidden();
}

// What the real sign-in page of the tenant's application looks like to a
// visitor who has never been to the console.
async function visit(
  browser: Browser,
  tenant: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(authorize(tenant, 'brand-app'));
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  return { page, close: () => context.close() };
}

const surface = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('a sandboxed preview is drawn styled, and a published theme changes the real sign-in page', async ({
  page,
  browser,
}) => {
  test.slow();
  const { publish } = branding;
  await signIn(page, publish);
  await openBranding(page, publish.tenant);

  const frame = page.locator(FRAME);
  await expect(frame).toHaveAttribute('sandbox', '');
  await expect(preview(page).getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  const section = await customiseLight(page, '#ffe8d6');
  await save(section);
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Changed: Colours and font',
  );
  const body = preview(page).locator('body');
  await expect
    .poll(() => body.evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe('rgb(255, 232, 214)');

  // The frame has no origin of its own, and Instrument's stylesheet and its
  // fonts still arrive in it.
  const fonts = await body.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family);
  });
  expect(fonts.length).toBeGreaterThan(0);
  expect(await body.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
    'IBM Plex',
  );

  const before = await visit(browser, publish.tenant);
  expect(await surface(before.page)).not.toBe('rgb(255, 232, 214)');
  await before.close();

  await page.getByRole('button', { name: 'Publish the draft' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Version 1 is published.',
  );
  const after = await visit(browser, publish.tenant);
  expect(await surface(after.page)).toBe('rgb(255, 232, 214)');
  await after.close();
});

test('uploads a logo, requires its alt text, and says why a file was refused', async ({
  page,
  problems,
}) => {
  test.slow();
  const { upload } = branding;
  await signIn(page, upload);
  await openBranding(page, upload.tenant);
  const images = page.getByRole('region', { name: 'Images' });

  await images
    .getByRole('group', { name: 'Logo', exact: true })
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'forged.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    });
  await expect(images.getByText('That is not a PNG, a JPEG or a WebP.')).toBeVisible();
  forgive(problems, '/theme/assets?kind=logo');

  await images
    .getByRole('group', { name: 'Logo', exact: true })
    .locator('input[type="file"]')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(images.getByText(/^An image is set \(/u)).toBeVisible();
  await expect(images.getByRole('button', { name: /^Save/u })).toBeDisabled();
  await images.getByRole('textbox', { name: 'Logo: alt text', exact: true }).fill('Acme');
  await save(images);

  await expect(preview(page).getByRole('img', { name: 'Acme' })).toBeVisible();
  await expectAccessible(page, { exclude: [FRAME] });
});

test('a failing contrast pair blocks publishing, and the server is not asked', async ({ page }) => {
  test.slow();
  const { contrast } = branding;
  await signIn(page, contrast);
  await openBranding(page, contrast.tenant);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/theme/publish')) requests.push(request.url());
  });

  const section = page.getByRole('region', { name: 'Colours and font' });
  await section.getByText('Use my own light colours', { exact: true }).click();
  await section.getByRole('textbox', { name: 'Light text', exact: true }).fill('#e0e0e0');
  const panel = page.getByRole('region', { name: 'Contrast' });
  await expect(panel.getByRole('status')).toContainText(/fail/u);
  await save(section);

  const publish = page.getByRole('region', { name: 'Publish', exact: true });
  await expect(publish.getByRole('button', { name: 'Publish the draft' })).toBeDisabled();
  await expect(publish.getByRole('note')).toContainText(
    'Fix the contrast before publishing: Light: Text on page',
  );
  expect(requests).toEqual([]);
});

test('reset asks first, then returns the tenant to Instrument’s own pages', async ({
  page,
  browser,
}) => {
  test.slow();
  const { reset } = branding;
  await signIn(page, reset);
  await openBranding(page, reset.tenant);
  const section = await customiseLight(page, '#d6f0ff');
  await save(section);
  await page.getByRole('button', { name: 'Publish the draft' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Version 1 is published.',
  );
  const themed = await visit(browser, reset.tenant);
  expect(await surface(themed.page)).toBe('rgb(214, 240, 255)');
  await themed.close();

  await page.getByRole('button', { name: 'Reset to default…' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Deletes the draft and unpublishes the theme');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Version 1 is published.',
  );

  await page.getByRole('button', { name: 'Reset to default…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Nothing published yet',
  );
  const plain = await visit(browser, reset.tenant);
  expect(await surface(plain.page)).not.toBe('rgb(214, 240, 255)');
  await plain.close();
});

test('works from the keyboard alone', async ({ page }) => {
  test.slow();
  const { keyed } = branding;
  await signIn(page, keyed);
  await openBranding(page, keyed.tenant);
  const section = page.getByRole('region', { name: 'Colours and font' });
  const light = section.getByRole('switch', { name: 'Use my own light colours' });
  await tabTo(page, light);
  await page.keyboard.press('Space');
  await expect(light).toBeChecked();
  const background = section.getByRole('textbox', { name: 'Light page background', exact: true });
  await tabTo(page, background);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('#fff0e0');
  await tabTo(page, section.getByRole('button', { name: /^Save/u }));
  await page.keyboard.press('Enter');
  await expect(section.getByRole('button', { name: /^Save/u })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Changed: Colours and font',
  );

  // The Pages tab, by arrow, then a page picked and a template written. The
  // way round passes the stylesheet editor, left with Escape.
  await tabTo(page, page.getByRole('tab', { name: 'Theme' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('region', { name: 'Page templates' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
});

for (const [name, viewport] of [
  ['a phone', PHONE],
  ['a tablet', TABLET],
  ['a laptop', LAPTOP],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport });

    test('both tabs fit, with a long list of refusals', async ({ page, problems }) => {
      test.slow();
      const { layout } = branding;
      await signIn(page, layout);
      await openBranding(page, layout.tenant);
      await expectFitsViewport(page);
      const section = await customiseLight(page, '#ffffff');
      await expectFitsViewport(page);
      await section.getByRole('button', { name: /^Discard/u }).click();

      await page.getByRole('tab', { name: 'Pages' }).click();
      const templates = page.getByRole('region', { name: 'Page templates' });
      await expect(templates).toBeVisible();
      const slots = Array.from({ length: 30 }, (_, index) => `{{unknown${String(index)}}}`).join(
        ' ',
      );
      await templates.getByRole('textbox', { name: 'Sign in: template', exact: true }).fill(slots);
      await templates.getByRole('button', { name: /^Save/u }).click();
      await expect(templates.getByText(/and \d+ more problems?/iu)).toBeVisible();
      forgive(problems, '/theme');
      await expectFitsViewport(page);
      await expectAccessible(page, { exclude: [FRAME] });
    });
  });
}

const STYLED = 'h1 {\n  color: #aa0000;\n}';

test('edits the stylesheet, meets a refusal on its line, and publishes it to the real sign-in page', async ({
  page,
  browser,
  problems,
}) => {
  test.slow();
  const { styled } = branding;
  await signIn(page, styled);
  await openBranding(page, styled.tenant);
  const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
  const editor = section.getByRole('textbox', { name: 'Stylesheet CSS' });

  // Tab indents and the browser's undo takes the indent back; Escape then Tab
  // lets go, onto the next control.
  await editor.click();
  await page.keyboard.type('h1');
  await page.keyboard.press('Tab');
  await expect(editor).toHaveValue('h1  ');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue('h1');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
  await expect(section.getByRole('button').and(page.locator(':focus'))).toHaveCount(1);
  await editor.fill('h1 {\n  behavior: none;\n}');

  await section.getByRole('button', { name: /^Save/u }).click();
  await expect(section.getByText('Line 2: This property is not allowed. (behavior)')).toBeVisible();
  await expect(section.getByText('The stylesheet was not saved.')).toBeVisible();
  forgive(problems, '/theme');
  await expectAccessible(page, { exclude: [FRAME] });

  await editor.fill(STYLED);
  await expect(section.getByText(/^Line 2:/u)).toBeHidden();
  await save(section);
  const heading = preview(page).getByRole('heading', { level: 1, name: 'Sign in' });
  await expect(heading).toHaveCSS('color', 'rgb(170, 0, 0)');

  const before = await visit(browser, styled.tenant);
  const colour = (visitor: Page): Promise<string> =>
    visitor
      .getByRole('heading', { level: 1, name: 'Sign in' })
      .evaluate((node) => getComputedStyle(node).color);
  expect(await colour(before.page)).not.toBe('rgb(170, 0, 0)');
  await before.close();

  await page.getByRole('button', { name: 'Publish the draft' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Version 1 is published.',
  );
  const after = await visit(browser, styled.tenant);
  expect(await colour(after.page)).toBe('rgb(170, 0, 0)');
  await after.close();
  await expectAccessible(page, { exclude: [FRAME] });
});

test('a long line keeps the text, the colour and the caret in one place', async ({ page }) => {
  test.slow();
  const { layout } = branding;
  await signIn(page, layout);
  await openBranding(page, layout.tenant);
  const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
  const editor = section.getByRole('textbox', { name: 'Stylesheet CSS' });
  await editor.fill(`.logo { content: "${'x'.repeat(600)}"; }\n.logo { opacity: 0.5 }`);
  const widths = await editor.evaluate((area) => {
    const layer = area.parentElement?.querySelector('pre');
    const scroller = area.closest('[data-code-scroller]');
    return {
      area: area.getBoundingClientRect().width,
      layer: layer?.getBoundingClientRect().width ?? 0,
      selfScroll: area.scrollWidth - area.clientWidth,
      scrollerScroll: (scroller?.scrollWidth ?? 0) - (scroller?.clientWidth ?? 0),
    };
  });
  expect(Math.abs(widths.area - widths.layer)).toBeLessThan(1.5);
  expect(widths.selfScroll).toBeLessThanOrEqual(1);
  expect(widths.scrollerScroll).toBeGreaterThan(100);
  await page.keyboard.press('ControlOrMeta+End');
  const caret = await editor.evaluate((area: HTMLTextAreaElement) => area.selectionStart);
  expect(caret).toBe((await editor.inputValue()).length);
  await expectFitsViewport(page);
});

test('undo and redo restore the text and the caret after typing, an indent, an outdent and a paste', async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { layout } = branding;
  await signIn(page, layout);
  await openBranding(page, layout.tenant);
  const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
  const editor = section.getByRole('textbox', { name: 'Stylesheet CSS' });
  const caret = (): Promise<number> =>
    editor.evaluate((a: HTMLTextAreaElement) => a.selectionStart);
  const undo = (): Promise<void> => page.keyboard.press('ControlOrMeta+z');
  const redo = (): Promise<void> => page.keyboard.press('ControlOrMeta+Shift+z');
  const at = async (value: string, position: number): Promise<void> => {
    await expect(editor).toHaveValue(value);
    expect(await caret()).toBe(position);
  };

  await editor.click();
  await page.keyboard.type('ab cd');
  await undo();
  await at('ab ', 3);
  await undo();
  await at('', 0);
  await redo();
  await at('ab ', 3);
  await redo();
  await at('ab cd', 5);

  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await at('ab cd\nx  ', 9);
  await undo();
  await at('ab cd\nx', 7);
  await redo();
  await at('ab cd\nx  ', 9);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await at('ab cd\nx  \n  ', 12);
  await page.keyboard.press('Shift+Tab');
  await at('ab cd\nx  \n', 10);
  await undo();
  await at('ab cd\nx  \n  ', 12);
  await redo();
  await at('ab cd\nx  \n', 10);

  await page.evaluate(() => navigator.clipboard.writeText('PASTE'));
  await page.keyboard.press('ControlOrMeta+v');
  await at('ab cd\nx  \nPASTE', 15);
  await undo();
  await at('ab cd\nx  \n', 10);
  await redo();
  await at('ab cd\nx  \nPASTE', 15);
});

test('undo, redo and an indent bring the caret back into view in a long stylesheet', async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { layout } = branding;
  await signIn(page, layout);
  await openBranding(page, layout.tenant);
  const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
  const editor = section.getByRole('textbox', { name: 'Stylesheet CSS' });
  const lines = Array.from(
    { length: 300 },
    (_, index) => `.logo { opacity: 0.${String(index % 10)} }`,
  );
  await editor.fill(lines.join('\n'));
  const place = (line: number): Promise<void> =>
    editor.evaluate((area: HTMLTextAreaElement, at) => {
      const offset = area.value.split('\n').slice(0, at).join('\n').length + (at > 0 ? 1 : 0);
      area.focus();
      area.setSelectionRange(offset, offset);
    }, line);
  const away = (): Promise<void> =>
    editor.evaluate((area) => {
      const scroller = area.closest('[data-code-scroller]');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  // Whether the caret's line sits inside what the scroller shows.
  const caretShows = (): Promise<boolean> =>
    editor.evaluate((area: HTMLTextAreaElement) => {
      const scroller = area.closest('[data-code-scroller]');
      if (!scroller) return false;
      const style = getComputedStyle(area);
      const line = area.value.slice(0, area.selectionEnd).split('\n').length - 1;
      const top =
        area.getBoundingClientRect().top +
        Number.parseFloat(style.paddingTop) +
        line * Number.parseFloat(style.lineHeight);
      const frame = scroller.getBoundingClientRect();
      return top >= frame.top - 2 && top + Number.parseFloat(style.lineHeight) <= frame.bottom + 2;
    });

  await place(150);
  await page.evaluate(() => navigator.clipboard.writeText('/* pasted */\n'.repeat(60)));
  await page.keyboard.press('ControlOrMeta+v');
  await away();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(caretShows).toBe(true);
  await away();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(caretShows).toBe(true);

  await place(100);
  await page.keyboard.press('Tab');
  await away();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(caretShows).toBe(true);
  await away();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(caretShows).toBe(true);
});

test('frames the verification mail without a script, in either scheme', async ({ page }) => {
  test.slow();
  const { mail } = branding;
  await signIn(page, mail);
  await page.goto(`/console/${mail.tenant}/branding?tab=mail`);
  const frame = page.locator(MAIL_FRAME);
  await expect(frame).toHaveAttribute('sandbox', '');
  const body = page.frameLocator(MAIL_FRAME);
  await expect(body.getByRole('heading', { name: 'Verify your email address' })).toBeVisible();
  const background = (): Promise<string> =>
    body.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor);
  const light = await background();

  await page.getByRole('button', { name: /Colour scheme/u }).click();
  await page.getByRole('option', { name: 'Dark' }).click();
  await expect(body.getByRole('heading', { name: 'Verify your email address' })).toBeVisible();
  await expect.poll(background).not.toBe(light);

  await expect(page.getByRole('region', { name: 'Light colours' })).toContainText(
    'Odudu’s default.',
  );
  await expectAccessible(page, { exclude: [MAIL_FRAME] });
});

test('sets a message override, refuses a key that is not a message, and removes it', async ({
  page,
  problems,
}) => {
  test.slow();
  const { languages } = branding;
  await signIn(page, languages);
  await page.goto(`/console/${languages.tenant}/branding?tab=languages`);
  const key = page.getByRole('combobox', { name: /Message key/u });
  const text = page.getByRole('textbox', { name: /Text shown instead/u });

  await key.fill('no.such.key');
  await text.fill('Hello');
  await page.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByText(/not the key of any page or mail message/u)).toBeVisible();
  forgive(problems, '/message-overrides/en/no.such.key');

  // The list offers the keys the pages hold, a bounded number at a time, each
  // with its English text; one is chosen by keyboard.
  await key.fill('');
  await page.getByRole('button', { name: /^Show Message key options/u }).click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeLessThanOrEqual(50);
  await page.keyboard.press('Escape');
  await key.fill('login.titl');
  await expect(options.first()).toContainText('login.title');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(key).toHaveValue('login.title');
  await text.fill('Welcome back');
  await page.getByRole('button', { name: 'Save override' }).click();
  const table = page.getByRole('grid', { name: 'Message overrides' });
  await expect(table.getByRole('row', { name: /login\.title/u })).toContainText('Welcome back');

  await page.getByRole('button', { name: 'Remove login.title' }).click();
  await page.getByRole('button', { name: 'Remove override' }).click();
  await expect(page.getByText('No overrides yet')).toBeVisible();
});

test('adds a language by its tag with Enter, marks the tab, saves it and keeps it', async ({
  page,
}) => {
  test.slow();
  const { languages } = branding;
  await signIn(page, languages);
  await page.goto(`/console/${languages.tenant}/branding?tab=languages`);
  const section = page.getByRole('region', { name: 'Languages', exact: true });
  const add = page.getByRole('combobox', { name: /Add a language/u });

  await add.fill('xx_YY');
  await page.getByRole('button', { name: 'Add language' }).click();
  await expect(page.getByText(/type a tag such as/u)).toBeVisible();

  await add.fill('pt-BR');
  await add.press('Enter');
  await expect(section.getByRole('checkbox', { name: /pt-BR/u })).toBeChecked();
  await expect(add).toHaveValue('');
  await expect(page.getByRole('tab', { name: /^Languages\s*, unsaved changes$/u })).toBeVisible();
  await expectAccessible(page);

  await save(section);
  await page.reload();
  await expect(section.getByRole('checkbox', { name: /pt-BR/u })).toBeChecked();
  await expect(page.getByRole('tab', { name: 'Languages', exact: true })).toBeVisible();
});

test('inserts a message from the list into a template, and says the preview shows no draft until there is one', async ({
  page,
}) => {
  test.slow();
  const { catalogue } = branding;
  await signIn(page, catalogue);
  await page.goto(`/console/${catalogue.tenant}/branding?tab=pages`);
  const section = page.getByRole('region', { name: 'Page templates' });
  const editor = section.getByRole('textbox', { name: 'Sign in: template' });
  const notice = page.getByRole('status', { name: 'What the preview shows' });
  await expect(notice).toContainText(
    'There is no saved draft or published theme, so the preview shows Instrument’s default look.',
  );

  await editor.fill('{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}<h2></h2>');
  await editor.press('ControlOrMeta+End');
  // The caret goes back before the closing tag, so the message lands in the heading.
  for (const key of Array.from('</h2>', () => 'ArrowLeft')) await editor.press(key);
  const picker = section.getByRole('combobox', { name: 'Insert a message' });
  await picker.fill('login.titl');
  const options = page.getByRole('option');
  await expect(options.first()).toContainText('login.title');
  expect(await options.count()).toBeLessThanOrEqual(50);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(/<h2>\{\{t "login\.title"\}\}<\/h2>$/u);
  await expect(editor).toBeFocused();
  await expectAccessible(page, { exclude: [FRAME] });

  await save(section);
  await expect(notice).toBeEmpty();
  await expect(preview(page).getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
});

test('inserts selectors from the list into the stylesheet, and the server accepts what it offered', async ({
  page,
  problems,
}) => {
  test.slow();
  const { selectors } = branding;
  await signIn(page, selectors);
  await openBranding(page, selectors.tenant);
  const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
  const editor = section.getByRole('textbox', { name: 'Stylesheet CSS' });
  const picker = section.getByRole('combobox', { name: 'Selectors you can use' });
  const choose = async (typed: string, name: RegExp): Promise<void> => {
    await picker.fill(typed);
    const options = page.getByRole('option');
    expect(await options.count()).toBeLessThanOrEqual(50);
    await options.filter({ hasText: name }).first().click();
  };

  await editor.fill('');
  await choose('page-sign', /\.page-sign-in/u);
  await expect(editor).toHaveValue('.page-sign-in');
  await expect(editor).toBeFocused();
  await page.keyboard.type(' button');
  await choose('hover', /:hover/u);
  await page.keyboard.type(' { opacity: 0.9; }');
  await expect(editor).toHaveValue('.page-sign-in button:hover { opacity: 0.9; }');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).not.toHaveValue('.page-sign-in button:hover { opacity: 0.9; }');
  await expectAccessible(page, { exclude: [FRAME] });

  await editor.fill('.page-sign-in button:hover { opacity: 0.9; }');
  await save(section);
  await expect(section.getByText('The stylesheet was not saved.')).toBeHidden();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Changed: Stylesheet',
  );
  await page.waitForLoadState('networkidle');

  await editor.fill('.nonesuch { opacity: 0.9; }');
  await section.getByRole('button', { name: /^Save/u }).click();
  await expect(section.getByText(/“Selectors you can use” above the editor lists/u)).toBeVisible();
  forgive(problems, '/theme');
});

test('a client has its own theme over the tenant’s, and a name in French', async ({
  page,
  browser,
}) => {
  test.slow();
  const { client } = branding;
  await signIn(page, client);
  await page.goto(`/console/${client.tenant}/clients`);
  await page
    .getByRole('grid', { name: 'Clients' })
    .getByRole('row', { name: /brand-app/u })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Brand App' })).toBeVisible();

  const translations = page.getByRole('region', { name: 'Translations' });
  const name = translations.getByRole('group', { name: 'Name' });
  await name.getByRole('tab', { name: 'French (fr)' }).click();
  await name
    .getByRole('textbox', { name: 'Translation into French (fr)' })
    .fill('Application Marque');
  await save(translations);
  await page.reload();
  await page
    .getByRole('region', { name: 'Translations' })
    .getByRole('group', { name: 'Name' })
    .getByRole('tab', { name: 'French (fr)' })
    .click();
  await expect(page.getByRole('textbox', { name: 'Translation into French (fr)' })).toHaveValue(
    'Application Marque',
  );

  await page.getByRole('tab', { name: 'Branding' }).click();
  const section = await customiseLight(page, '#ffe8d6');
  await expectAccessible(page, { exclude: [FRAME] });
  await save(section);
  await expect(section).toContainText(
    'The draft replaces Instrument’s default light colours once published',
  );
  const body = preview(page).locator('body');
  await expect
    .poll(() => body.evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe('rgb(255, 232, 214)');

  const before = await visit(browser, client.tenant);
  expect(await surface(before.page)).not.toBe('rgb(255, 232, 214)');
  await before.close();
  await page.getByRole('button', { name: 'Publish the draft' }).click();
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Version 1 is published.',
  );
  const after = await visit(browser, client.tenant);
  expect(await surface(after.page)).toBe('rgb(255, 232, 214)');
  await after.close();

  // The tenant's own theme is untouched by the client's.
  await page.goto(`/console/${client.tenant}/branding`);
  await expect(page.getByRole('region', { name: 'Publish', exact: true })).toContainText(
    'Nothing published yet',
  );
});

test('publishes from the Pages tab, reverts the tab to what is published, and discards the draft', async ({
  page,
}) => {
  test.slow();
  const { publication } = branding;
  await signIn(page, publication);
  await page.goto(`/console/${publication.tenant}/branding?tab=pages`);
  const section = page.getByRole('region', { name: 'Page templates' });
  const editor = section.getByRole('textbox', { name: 'Sign in: template' });
  const bar = page.getByRole('region', { name: 'Publish', exact: true });
  const publish = bar.getByRole('button', { name: 'Publish the draft' });
  const template = (heading: string): string =>
    `{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}<h2>${heading}</h2>`;

  await editor.fill(template('One'));
  await save(section);
  await expect(bar).toContainText('Changed: Page templates');
  await expect(page.getByRole('tab', { name: /^Pages\s*, changes to publish$/u })).toBeVisible();
  await expectAccessible(page, { exclude: [FRAME] });

  await publish.click();
  await expect(bar).toContainText('Version 1 is published.');
  await expect(bar).toContainText('No draft.');
  await expect(page.getByRole('tab', { name: 'Pages', exact: true })).toBeVisible();

  await editor.fill(template('Two'));
  await save(section);
  await expect(bar).toContainText('Changed: Page templates');
  const revert = page
    .getByRole('region', { name: 'Revert to published' })
    .getByRole('button', { name: 'Revert this tab to published' });
  await revert.click();
  await expect(bar).toContainText('The draft matches what people see.');
  await expect(editor).toHaveValue(template('One'));
  await expect(publish).toBeDisabled();
  await expect(bar.getByRole('note')).toContainText(
    'Nothing to publish: the draft matches what people see.',
  );
  await expect(revert).toBeDisabled();

  await bar.getByRole('button', { name: 'Discard draft…' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('nothing is unpublished');
  await dialog.getByRole('button', { name: 'Discard draft' }).click();
  await expect(bar).toContainText('No draft.');
  await expect(bar).toContainText('Version 1 is published.');
  await expect(bar.getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
  await expectAccessible(page, { exclude: [FRAME] });
});
