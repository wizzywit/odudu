import type { Page } from '@playwright/test';
import {
  BRAND_CLIENT,
  BRAND_TENANT,
  LOGO_DARK,
  LOGO_LIGHT,
  adminApi,
  backgroundPng,
  freshBrandTenant,
  publishDraft,
  removeBrandTenant,
  saveDraft,
  uploadImage,
} from './brand-stack.ts';
import type { Context, Screen } from './screen.ts';

const WIDE = { width: 1440, height: 960 } as const;
const PHONE = { width: 375, height: 812 } as const;

const PAGE_FRAME = 'iframe[title="Preview of the page"]';
const MAIL_FRAME = 'iframe[title="Preview of the verification mail"]';

// The tenant's own palette: warm paper, brown ink, a rust accent.
const LIGHT = {
  surfacePage: '#fbeee2',
  surfacePanel: '#fffaf5',
  surfaceSunken: '#f6e8db',
  inkPrimary: '#2b1a12',
  inkMuted: '#6b5448',
  signalActive: '#f3d9c4',
  signalActiveInk: '#7a2d0a',
  signalDanger: '#fde0d0',
  signalDangerInk: '#802000',
  borderStrong: '#8a7365',
  focusRing: '#8a2d00',
};
const DARK = {
  surfacePage: '#1d130e',
  surfacePanel: '#2b1d15',
  surfaceSunken: '#241810',
  inkPrimary: '#f6e8db',
  inkMuted: '#c7ad9a',
  signalActive: '#5a2a12',
  signalActiveInk: '#ffd9bf',
  signalDanger: '#5c1a0e',
  signalDangerInk: '#ffd2c4',
  borderStrong: '#b79a85',
  focusRing: '#ffb98a',
};
// The client's own: a cooler look, so what it replaces is easy to see.
const CLIENT_LIGHT = {
  surfacePage: '#e6eefb',
  surfacePanel: '#ffffff',
  surfaceSunken: '#eef3fb',
  inkPrimary: '#0f2147',
  inkMuted: '#46557a',
  signalActive: '#d6e4ff',
  signalActiveInk: '#0b2f78',
  signalDanger: '#fde0d0',
  signalDangerInk: '#802000',
  borderStrong: '#5a6b91',
  focusRing: '#1747b8',
};

const STYLESHEET =
  '.page-sign-in h1 {\n  letter-spacing: 0.04em;\n  border-top: 4px solid var(--focus-ring);\n  padding-top: var(--space-3);\n}\n';

const TEMPLATE = [
  '<h1>{{t "login.title"}}</h1>',
  '{{error}}',
  '{{form.open}}',
  '  {{fields}}',
  '  {{submit}}',
  '{{form.close}}',
  '<p class="help"><small>Need help? <a href="https://acme.example/help" rel="noopener noreferrer">Ask the help desk</a></small></p>',
  '',
].join('\n');

// The client's id as the admin API knows it, kept from the pass's first screen.
let clientId = '';
let logoId = '';
let backgroundId = '';

async function ready(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1, name: 'Branding' }).waitFor();
  await page.getByRole('region', { name: 'Publish', exact: true }).waitFor();
  await page
    .getByRole('progressbar')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
}

async function framesDrawn(page: Page, frame = PAGE_FRAME): Promise<void> {
  await page.frameLocator(frame).locator('body').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
}

async function openBranding(
  page: Page,
  context: Context,
  tab: 'theme' | 'pages' | 'mail' | 'languages' = 'theme',
): Promise<void> {
  const query = tab === 'theme' ? '' : `?tab=${tab}`;
  await page.goto(`${context.base}/console/${BRAND_TENANT}/branding${query}`);
  await ready(page);
  if (tab === 'theme' || tab === 'pages') await framesDrawn(page);
}

async function openClientBranding(page: Page, context: Context): Promise<void> {
  await page.goto(`${context.base}/console/${BRAND_TENANT}/clients`);
  await page
    .getByRole('grid', { name: 'Clients' })
    .getByRole('row', { name: new RegExp(BRAND_CLIENT, 'u') })
    .click();
  await page.getByRole('tab', { name: 'Branding' }).click();
  await page.getByRole('region', { name: 'Publish', exact: true }).waitFor();
  await framesDrawn(page);
}

async function toTop(locator: ReturnType<Page['locator']>, gap = 56): Promise<void> {
  await locator.evaluate((element, offset) => {
    element.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -offset);
  }, gap);
}

async function putOverride(
  page: Page,
  locale: string,
  key: string,
  message: string,
): Promise<void> {
  const current = await adminApi(
    page,
    'GET',
    `tenants/${BRAND_TENANT}/message-overrides?locale=${locale}`,
  );
  const items = (current.body as { items?: { key: string; locale: string; etag?: string }[] })
    .items;
  const existing = items?.find((item) => item.key === key && item.locale === locale);
  const headers: Record<string, string> =
    existing?.etag === undefined ? { 'if-none-match': '*' } : { 'if-match': existing.etag };
  const answer = await adminApi(
    page,
    'PUT',
    `tenants/${BRAND_TENANT}/message-overrides/${locale}/${key}`,
    { json: { message }, headers },
  );
  if (answer.status >= 400) throw new Error(`override answered ${String(answer.status)}`);
}

// The alert and status lines each picture is allowed to show, kept as the console words them.
const CONTRAST_OK = 'Contrast passes.';
const SCHEME_LIGHT = 'Sign in · Light';
const NOT_SAVED = 'Sign in · Light · not the saved draft';
const NO_DRAFT_AT_ALL =
  'There is no saved draft or published theme, so the preview shows Instrument’s default look.';
const NO_DRAFT = 'There is no saved draft, so the preview shows the published theme.';
const PUBLISHED_WITH_WARNING =
  'Published, with a warning A stylesheet or a template cannot be proven accessible. Published anyway; check the pages yourself. stylesheet: A stylesheet can change any colour or hide any element, so its contrast and legibility are not checked; keeping it accessible is the tenant’s responsibility. templates.sign-in: A template places the page’s parts as its author chose, so its reading order and layout are not checked; keeping it accessible is the tenant’s responsibility.';
const SOMEBODY_SAVED =
  'Somebody saved the draft after you opened it. The page now shows their version: look it over, then revert if you still want to.';
const UPDATED_SINCE =
  'Updated since you opened it. Fields you have not changed show the new values; fields you changed keep yours.';
const CLIENT_NO_DRAFT = 'This client has no saved draft, so the preview shows its published theme.';

export const BRANDING_SCREENS: readonly Screen[] = [
  {
    name: 'branding-theme',
    alt: 'The Branding page of the acme tenant on its Theme tab, before anything is saved: the Publish bar says nothing is published and there is no draft, and under the tabs Colours and font holds both palettes switched off, beside a Preview of Instrument’s default sign-in page with a notice that no draft exists yet.',
    caption: 'A tenant that has never been branded: no draft, nothing published.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, NO_DRAFT_AT_ALL, NOT_SAVED],
    expect: [
      { heading: 'Branding' },
      { role: 'tab', name: 'Theme' },
      { role: 'button', name: 'Publish the draft' },
    ],
    open: async (page, context) => {
      clientId = await freshBrandTenant(page, context.base);
      await openBranding(page, context);
    },
  },
  {
    name: 'branding-colours',
    alt: 'The Colours and font section with Use my own light colours switched on and its colours filled in as hex values with a swatch beside each, warm paper and brown ink, beside the Preview that already draws the sign-in page in them.',
    caption:
      'Switching a palette on makes all eleven of its colours yours; the preview follows each save.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ label: 'Light page background' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', { tokens: { light: LIGHT, dark: DARK } });
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Colours and font' }), 160);
    },
  },
  {
    name: 'branding-contrast',
    alt: 'The Contrast panel after the light text colour was changed to a pale brown: it reads 3 pairs fail its requirement, and lists every pair with a fails or passes mark, the ratio it reaches and the ratio it needs; the three failing pairs are light text on the page, on the panel and on the field background. The Preview beside it draws the sign-in page with its text washed out.',
    caption:
      'A pair of colours that falls short of the contrast rule is named, with the ratio it needs.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: ['Contrast fails: see the pairs listed.', 'Sign in · Light'],
    expect: [{ heading: 'Contrast' }, { label: 'Light text' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', {
        tokens: { light: { ...LIGHT, inkPrimary: '#e0d4cc' }, dark: DARK },
      });
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Contrast' }), 120);
    },
  },
  {
    name: 'branding-publish-held',
    alt: 'The Publish bar while a contrast pair fails: Publish the draft is dimmed, Changed: Colours and font is listed, and a note says Fix the contrast before publishing and names the first failing pair, Light: Text on page.',
    caption: 'Publish is held while a pair falls short, and the bar says which.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: ['Contrast fails: see the pairs listed.', 'Sign in · Light'],
    expect: [{ heading: 'Publish' }, { role: 'button', name: 'Discard draft…' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Publish', exact: true }), 56);
    },
    leave: async (page) => {
      await saveDraft(page, 'tenant', { tokens: { light: LIGHT, dark: DARK } });
    },
  },
  {
    name: 'branding-images',
    alt: 'The Images section with a logo uploaded: the logo is drawn as a small thumbnail under its description, with its alt text filled in, a Replace button, Remove from theme and Delete image. The preview beside it shows the logo above the sign-in form and the background image around the panel.',
    caption:
      'An uploaded image is shown as a thumbnail, whether or not any published theme uses it.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ heading: 'Images' }, { label: 'Logo: alt text' }],
    open: async (page, context) => {
      logoId = await uploadImage(page, 'tenant', 'logo', LOGO_LIGHT);
      const darkId = await uploadImage(page, 'tenant', 'darkLogo', LOGO_DARK);
      backgroundId = await uploadImage(page, 'tenant', 'background', backgroundPng());
      await saveDraft(page, 'tenant', {
        assets: {
          logo: { assetId: logoId, alt: 'Acme' },
          darkLogo: { assetId: darkId, alt: 'Acme' },
          background: { assetId: backgroundId },
        },
      });
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Images' }), 56);
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'branding-bar',
    alt: 'The top of the Branding page after colours and images are saved: the Publish bar reads Nothing published yet and Changed: Colours and font, Images, and the Theme tab carries a dot. Beside the tabs the Preview shows the branded sign-in page with the logo and the background image around its panel.',
    caption:
      'The Publish bar says what the draft would change; a dot marks the tab that holds a change.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [
      { role: 'button', name: 'Publish the draft' },
      { role: 'button', name: 'Discard draft…' },
    ],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.evaluate(() => {
        window.scrollTo(0, 150);
      });
    },
  },
  {
    name: 'branding-stylesheet-refused',
    alt: 'The Stylesheet section with a rule typed in the editor whose third line, behavior: none, is marked, and under the editor the message Line 3: This property is not allowed, and The stylesheet was not saved.',
    caption: 'A refused rule is marked on the line it names and listed under the editor.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ heading: 'Stylesheet' }, { label: 'Stylesheet CSS' }],
    open: async (page, context) => {
      await openBranding(page, context);
      const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
      await section
        .getByRole('textbox', { name: 'Stylesheet CSS' })
        .fill('.page-sign-in h1 {\n  letter-spacing: 0.04em;\n  behavior: none;\n}\n');
      await section.getByRole('button', { name: /^Save/u }).click();
      await section.getByText('The stylesheet was not saved.').waitFor();
      await toTop(section, 56);
    },
    leave: async (page) => {
      const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
      await section.getByRole('button', { name: /^Discard/u }).click();
    },
  },
  {
    name: 'branding-selectors',
    alt: 'The Stylesheet section with the Selectors you can use list open after page- was typed: each entry that contains it is shown with a note of what it is, the first being .page-sign-in, the class of the sign-in page. Under it sit Design values you can use and the editor that holds the saved rule.',
    caption: 'The selectors list is the one the server checks against; typing narrows it.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ label: 'Selectors you can use' }, { label: 'Design values you can use' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', { stylesheet: STYLESHEET });
      await openBranding(page, context);
      const section = page.getByRole('region', { name: 'Stylesheet', exact: true });
      await toTop(section, 56);
      await section.getByRole('combobox', { name: 'Selectors you can use' }).fill('page-');
      await page.getByRole('listbox').first().waitFor();
    },
    leave: async (page) => {
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'branding-page-kind',
    alt: 'The Preview of the sign-in page after the rule .page-sign-in h1 is saved: the heading Sign in has a rust line above it and wider letter spacing, while the Stylesheet editor beside it holds the rule, with the border and padding values written as var() design values.',
    caption: 'One class per page kind lets a rule restyle the sign-in page alone.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ heading: 'Stylesheet' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Stylesheet', exact: true }), 56);
    },
  },
  {
    name: 'branding-pages',
    alt: 'The Pages tab with the Sign in template written in the editor, a heading, the error, the form parts and a help link, and the list of parts the page may use beside it. The Preview shows the page with the help line under the form.',
    caption: 'A template places the parts the server fills in and may add plain HTML.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [SCHEME_LIGHT],
    expect: [{ heading: 'Page templates' }, { label: 'Insert a message' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', { templates: { 'sign-in': TEMPLATE } });
      await openBranding(page, context, 'pages');
      await toTop(page.getByRole('region', { name: 'Page templates' }), 56);
    },
  },
  {
    name: 'branding-message-picker',
    alt: 'The Pages tab with the Insert a message list open and narrowed to messages that contain login, each key with its English text beside it, above the template editor.',
    caption: 'The message picker lists the keys a page can show, with their English text.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [SCHEME_LIGHT],
    expect: [{ label: 'Insert a message' }],
    open: async (page, context) => {
      await openBranding(page, context, 'pages');
      const templates = page.getByRole('region', { name: 'Page templates' });
      await toTop(templates, 56);
      await templates.getByRole('combobox', { name: 'Insert a message' }).fill('login');
      await page.getByRole('listbox').first().waitFor();
    },
    leave: async (page) => {
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'branding-template-refused',
    alt: 'The Pages tab after a template with an unknown part and no form was saved: the editor marks lines 3 and 4, and under it the messages say that the slot on line 4 is not a part of this page kind, that the fields sit outside the form, and that the template was not saved because required parts are missing.',
    caption: 'A refused template says what is wrong and marks where.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [SCHEME_LIGHT],
    expect: [{ heading: 'Page templates' }],
    open: async (page, context) => {
      await openBranding(page, context, 'pages');
      const templates = page.getByRole('region', { name: 'Page templates' });
      await templates
        .getByRole('textbox', { name: 'Sign in: template', exact: true })
        .fill('<h1>{{t "login.title"}}</h1>\n{{error}}\n{{fields}}\n{{unknown}}\n');
      await templates.getByRole('button', { name: /^Save/u }).click();
      await templates
        .getByText(/not saved/iu)
        .first()
        .waitFor();
      await toTop(templates, 56);
    },
    leave: async (page) => {
      const templates = page.getByRole('region', { name: 'Page templates' });
      await templates.getByRole('button', { name: /^Discard/u }).click();
    },
  },
  {
    name: 'branding-published',
    alt: 'The Publish bar just after Publish the draft: it reads Published, Version 1 is published, and No draft, with Publish the draft dimmed, and under it a notice, Published, with a warning, says a stylesheet or a template cannot be proven accessible and lists which.',
    caption:
      'Publishing makes the whole saved draft what people see; the bar then has nothing to publish.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [PUBLISHED_WITH_WARNING, CONTRAST_OK, NO_DRAFT, NOT_SAVED],
    expect: [{ heading: 'Publish' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.getByRole('button', { name: 'Publish the draft' }).click();
      await page
        .getByText(/Version 1 is published/u)
        .first()
        .waitFor();
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await toTop(page.getByRole('region', { name: 'Publish', exact: true }), 56);
    },
  },
  {
    name: 'branding-nothing-to-publish',
    alt: 'The Publish bar when the saved draft is the published theme again: it names Version 1, says the draft matches what people see, and a note reads Nothing to publish: the draft matches what people see, with Publish the draft dimmed and Discard draft ready.',
    caption: 'A draft that changes nothing is not published.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ heading: 'Publish' }, { role: 'button', name: 'Discard draft…' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', {});
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Publish', exact: true }), 56);
    },
    leave: async (page) => {
      await adminApi(page, 'DELETE', `tenants/${BRAND_TENANT}/theme/draft`, {
        headers: {
          'if-match': (await adminApi(page, 'GET', `tenants/${BRAND_TENANT}/theme`)).etag ?? '*',
        },
      });
    },
  },
  {
    name: 'branding-revert',
    alt: 'The Revert to published section of the Theme tab, with a draft that differs from what is published: it says that Revert this tab to published writes the colours and font, the images and the stylesheet back as published and leaves the other tabs alone, and the button is ready. The Versions list begins below it.',
    caption:
      'Revert this tab to published takes one tab’s parts back and leaves the other tab alone.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [
      { heading: 'Revert to published' },
      { role: 'button', name: 'Revert this tab to published' },
    ],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', {
        tokens: { light: { ...LIGHT, inkMuted: '#5a4439' }, dark: DARK },
      });
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Revert to published' }), 120);
    },
  },
  {
    name: 'branding-discard',
    alt: 'The confirmation that opens from Discard draft: a dialog saying the saved draft is deleted and what is published stays, with a Cancel button and a Discard draft button.',
    caption: 'Discarding deletes only the saved draft; what people see does not change.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ heading: 'Branding' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.getByRole('button', { name: 'Discard draft…' }).click();
      await page.getByRole('alertdialog').waitFor();
    },
    leave: async (page) => {
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    },
  },
  {
    name: 'branding-versions',
    alt: 'The Versions list after a second publish: Version 2 is the published one and Version 1 is listed beneath it with a Restore button.',
    caption:
      'Each publish keeps the version it replaces; Restore publishes a copy of an earlier one.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, NO_DRAFT, NOT_SAVED],
    expect: [{ heading: 'Versions' }],
    open: async (page, context) => {
      await publishDraft(page, 'tenant');
      await openBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Versions' }), 56);
    },
  },
  {
    name: 'branding-reset',
    alt: 'The confirmation that opens from Reset to default: a dialog saying it deletes the draft and unpublishes the theme, so people see Instrument’s own pages again, with Cancel and Reset to default buttons.',
    caption: 'Reset to default is the one step that changes what people see at once.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, NO_DRAFT, NOT_SAVED],
    expect: [{ heading: 'Branding' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.getByRole('button', { name: 'Reset to default…' }).click();
      await page.getByRole('alertdialog').waitFor();
    },
    leave: async (page) => {
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    },
  },
  {
    name: 'branding-mail',
    alt: 'The Mail tab: What the mail inherits lists the logo and the logo for the dark scheme with their sizes and addresses, and under them the light colours, each with its value and what it is used for. Beside it the Preview shows the verification mail as the published theme dresses it, with the tenant’s own wording of its heading, Confirm your Acme address, and its Verify email button.',
    caption: 'The verification mail wears the published theme.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: ['Email · Light · The tenant’s default'],
    expect: [{ heading: 'What the mail inherits' }],
    open: async (page, context) => {
      await putOverride(page, 'en', 'verify.heading', 'Confirm your Acme address');
      await openBranding(page, context, 'mail');
      await framesDrawn(page, MAIL_FRAME);
      await toTop(page.getByRole('region', { name: 'What the mail inherits' }), 56);
    },
  },
  {
    name: 'branding-mail-dark',
    alt: 'The Mail tab with the Colour scheme of the Preview set to Dark: the verification mail is drawn in the tenant’s dark palette, the dark logo above its card, with the Language and Preview as client choices above it.',
    caption: 'A mail client chooses light or dark by its own setting, so the preview shows each.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: ['Email · Dark · The tenant’s default'],
    expect: [{ heading: 'What the mail inherits' }],
    open: async (page, context) => {
      await openBranding(page, context, 'mail');
      await page.getByRole('button', { name: /Colour scheme/u }).click();
      await page.getByRole('option', { name: 'Dark' }).click();
      await framesDrawn(page, MAIL_FRAME);
      await toTop(page.getByRole('heading', { name: 'Preview' }).first(), 100);
    },
  },
  {
    name: 'branding-languages',
    alt: 'The Languages section of the Languages tab: Supported languages lists English and French ticked and Arabic not, with Add a language beneath, and Default language is left on The browser decides.',
    caption: 'The languages a tenant offers, and its own wording for single messages.',
    signedIn: true,
    viewport: WIDE,
    expect: [{ heading: 'Languages' }, { role: 'button', name: 'Add language' }],
    open: async (page, context) => {
      const settings = await adminApi(page, 'GET', `tenants/${BRAND_TENANT}/settings`);
      if (settings.etag !== null) {
        await adminApi(page, 'PATCH', `tenants/${BRAND_TENANT}/settings`, {
          json: { supported_locales: ['en', 'fr'] },
          headers: { 'if-match': settings.etag },
        });
      }
      await openBranding(page, context, 'languages');
      await page.getByRole('checkbox').first().waitFor();
      await toTop(page.getByRole('heading', { name: 'Languages', exact: true }).last(), 120);
    },
  },
  {
    name: 'branding-overrides',
    alt: 'The Message overrides section for English: the language and message key pickers, the text shown instead, a Save override button, and under them the one override held so far, verify.heading with its text, when it changed, and Edit and Remove buttons.',
    caption: 'An override replaces one message in one language, for pages and mail alike.',
    signedIn: true,
    viewport: WIDE,
    expect: [{ heading: 'Message overrides' }, { role: 'button', name: 'Save override' }],
    open: async (page, context) => {
      await openBranding(page, context, 'languages');
      await page.getByRole('checkbox').first().waitFor();
      const overrides = page.getByRole('region', { name: 'Message overrides' });
      await overrides.getByRole('button', { name: 'Edit' }).first().waitFor();
      await toTop(overrides, 56);
    },
  },
  {
    name: 'branding-override-conflict',
    alt: 'Message overrides after two administrators changed verify.heading: the text being edited reads Confirm your address with Acme, and under Save override a panel titled Changed in the en text for verify.heading since you opened it shows what theirs holds now, Please confirm your Acme address, beside yours, with Keep mine and Take theirs. The row below already shows their text.',
    caption:
      'Two administrators cannot overwrite each other unseen: the save shows both texts and asks.',
    signedIn: true,
    viewport: WIDE,
    expect: [{ heading: 'Message overrides' }],
    open: async (page, context) => {
      await openBranding(page, context, 'languages');
      await page.getByRole('checkbox').first().waitFor();
      const overrides = page.getByRole('region', { name: 'Message overrides' });
      await overrides.getByRole('button', { name: 'Edit' }).first().click();
      await putOverride(page, 'en', 'verify.heading', 'Please confirm your Acme address');
      const text = overrides.getByRole('textbox', { name: 'Text shown instead' });
      await text.fill('Confirm your address with Acme');
      await overrides.getByRole('button', { name: /^Save override/u }).click();
      await overrides.getByRole('button', { name: 'Take theirs' }).waitFor();
      await toTop(overrides, 56);
    },
  },
  {
    name: 'branding-revert-conflict',
    alt: 'The Revert to published section after another administrator saved the draft first: a message says somebody saved the draft after the page was opened, and a panel lists Colours and font with what theirs holds now, one group of colours (light), beside what yours held, two (light, dark), with Keep mine and Take theirs under it.',
    caption: 'A revert that meets a newer draft shows both and asks which to keep.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [UPDATED_SINCE, CONTRAST_OK, SOMEBODY_SAVED, SCHEME_LIGHT],
    expect: [{ heading: 'Revert to published' }],
    open: async (page, context) => {
      await saveDraft(page, 'tenant', {
        tokens: { light: { ...LIGHT, inkMuted: '#6e5043' }, dark: DARK },
      });
      await openBranding(page, context);
      await saveDraft(page, 'tenant', { tokens: { light: { ...LIGHT, inkMuted: '#7a5e50' } } });
      const revert = page.getByRole('region', { name: 'Revert to published' });
      await revert.getByRole('button', { name: 'Revert this tab to published' }).click();
      await revert.getByRole('button', { name: 'Take theirs' }).waitFor();
      await toTop(revert, 120);
    },
  },
  {
    name: 'branding-narrow-theme',
    alt: 'The Theme tab on a phone: the editor takes the whole width, the Publish bar is one row with Publish and More, the tabs scroll sideways, and a strip pinned to the bottom shows a miniature of the sign-in page with the words Sign in, Light and an Open preview button.',
    caption: 'On a phone the editor takes the width and the preview is a strip at the bottom.',
    signedIn: true,
    viewport: PHONE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [
      { role: 'button', name: 'Open preview' },
      { role: 'button', name: 'More publishing actions' },
    ],
    open: async (page, context) => {
      await openBranding(page, context);
    },
  },
  {
    name: 'branding-narrow-sheet',
    alt: 'The sheet Page preview raised by Open preview on a phone: the sign-in page across the full width at its real proportions, with the Page and Colour scheme menus above it and a Close preview button.',
    caption: 'Open preview raises the same page full width; Escape or Close preview puts it away.',
    signedIn: true,
    viewport: PHONE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ role: 'button', name: 'Close preview' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.getByRole('button', { name: 'Open preview' }).click();
      await page.getByRole('dialog', { name: 'Page preview' }).waitFor();
      await page.waitForTimeout(1200);
    },
    leave: async (page) => {
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'branding-narrow-bar',
    alt: 'The folded Publish bar on a phone with its More menu open: the menu lists Revert this tab to published and Discard draft, and Publish stays beside it.',
    caption: 'The bar folds to one row; what else it does is under More.',
    signedIn: true,
    viewport: PHONE,
    allowedStatus: [CONTRAST_OK, SCHEME_LIGHT],
    expect: [{ role: 'button', name: 'More publishing actions' }],
    open: async (page, context) => {
      await openBranding(page, context);
      await page.getByRole('button', { name: 'More publishing actions' }).click();
      await page.getByRole('menu', { name: 'More publishing actions' }).waitFor();
    },
    leave: async (page) => {
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'client-branding',
    alt: 'The Branding tab of the storefront client: a line says a piece set here replaces the tenant’s for sign-ins that start from this client, then the client’s own Publish bar names Version 1 as published, and below it the Theme and Pages tabs begin.',
    caption: 'A client has a publication of its own: its own draft, bar and versions.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, CLIENT_NO_DRAFT, NOT_SAVED],
    expect: [{ role: 'tab', name: 'Branding' }],
    open: async (page, context) => {
      const target = { client: clientId } as const;
      await saveDraft(page, target, { tokens: { light: CLIENT_LIGHT } });
      await publishDraft(page, target);
      await openClientBranding(page, context);
    },
  },
  {
    name: 'client-branding-colours',
    alt: 'The Colours and font section of the storefront client’s Branding tab: Light colours is switched on, the line under it reads Published: this client, Hides the tenant’s light colours, and the cooler blue colours replace the tenant’s warm ones in the Preview beside it, which draws the sign-in page for the client with the tenant’s logo and background.',
    caption:
      'A palette the client switches on replaces the tenant’s whole palette for its sign-in.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: [CONTRAST_OK, CLIENT_NO_DRAFT, NOT_SAVED],
    expect: [{ heading: 'Colours and font' }, { label: 'Light page background' }],
    open: async (page, context) => {
      await openClientBranding(page, context);
      await toTop(page.getByRole('region', { name: 'Colours and font' }), 120);
    },
  },
  {
    name: 'client-branding-narrow',
    alt: 'The storefront client’s Branding tab on a phone, with the folded Publish bar and the preview strip at the bottom.',
    caption: 'The client’s Branding tab folds the same way on a phone.',
    signedIn: true,
    viewport: PHONE,
    allowedStatus: [CONTRAST_OK, CLIENT_NO_DRAFT, NOT_SAVED],
    expect: [{ role: 'tab', name: 'Branding' }],
    open: async (page, context) => {
      await openClientBranding(page, context);
    },
  },
  {
    name: 'client-mail-preview',
    alt: 'The Mail tab with storefront chosen under Preview as client: What the mail inherits says that the client’s theme supplies the light colours, and the Preview shows the verification mail in the client’s cooler colours.',
    caption: 'Preview as client shows the mail a sign-in of that client sends.',
    signedIn: true,
    viewport: WIDE,
    allowedStatus: ['Email · Light · The tenant’s default · Storefront'],
    expect: [{ heading: 'What the mail inherits' }],
    open: async (page, context) => {
      await openBranding(page, context, 'mail');
      await page.getByText('Storefront').first().click();
      await framesDrawn(page, MAIL_FRAME);
      await page.waitForTimeout(1200);
      await toTop(page.getByRole('region', { name: 'What the mail inherits' }), 56);
    },
  },
  {
    name: 'email-send-as-client',
    alt: 'The Test message section of the Email page with Send as client open: the list of the tenant’s clients with storefront chosen, and the line under it saying the message will wear that client’s theme.',
    caption: 'A test message can be sent as a client, to see its look in a real mailbox.',
    signedIn: true,
    viewport: WIDE,
    expect: [{ heading: 'Email' }, { role: 'button', name: 'Send test message' }],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/${BRAND_TENANT}/email`);
      await page.getByRole('heading', { level: 1, name: 'Email' }).waitFor();
      await page.getByText('Storefront').first().click();
      await toTop(page.getByRole('heading', { name: 'Test message' }), 56);
    },
    leave: async (page, context) => {
      await removeBrandTenant(page, context.base);
    },
  },
];
