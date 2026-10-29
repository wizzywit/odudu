import type { MailBrandingView, ThemePreviewInfo } from '@odudu/contracts/admin';
import { image, json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { C, clientRoutes } from '#/testing/clientsFixtures';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';

export const TH = `${ACME_ADMIN}/theme`;

export const EMPTY = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

const LIGHT = {
  surfacePage: '#ffffff',
  surfacePanel: '#ffffff',
  surfaceSunken: '#f3f5f4',
  inkPrimary: '#161b1a',
  inkMuted: '#56605d',
  signalActive: '#dcf0e6',
  signalActiveInk: '#0a6344',
  signalDanger: '#fae3d7',
  signalDangerInk: '#9c3a0e',
  borderStrong: '#6b7370',
  focusRing: '#0a7c55',
};

export const OWN_LIGHT = LIGHT;

export const LOGO_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

// A PNG signature and a few bytes that are not text, enough for a thumbnail.
export const LOGO_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);

// The route that answers an uploaded image's bytes.
export function assetContent(assetId: string): string {
  return `GET ${ACME_ADMIN}/theme/assets/${assetId}/content`;
}

// A tenant with nothing set: Instrument's own pages, and no draft.
export function themeView(changes: Record<string, unknown> = {}) {
  return {
    scope: 'tenant',
    draft: null,
    published: null,
    sources: {},
    draft_sources: null,
    tenant_sources: null,
    changed: [],
    ...changes,
  };
}

// A tenant whose draft sets the light colours and a logo, published once with
// the colours only.
export function draftedView(moreAssets: Record<string, unknown> = {}) {
  const draft = {
    ...EMPTY,
    tokens: { light: LIGHT },
    assets: { logo: { assetId: LOGO_ID, alt: 'Acme' }, ...moreAssets },
  };
  return themeView({
    draft,
    published: {
      id: 'v1',
      version: 1,
      published_at: '2026-10-20T09:00:00.000Z',
      body: { ...EMPTY, tokens: { light: LIGHT } },
    },
    sources: { 'tokens.light': 'tenant', 'assets.logo': 'default' },
    draft_sources: { 'tokens.light': 'tenant', 'assets.logo': 'tenant' },
    changed: ['assets'],
  });
}

export function themeAnswer(view: Record<string, unknown> = themeView(), etag?: string): Answer {
  return json(view, 200, etag === undefined ? {} : { etag });
}

export function versionsAnswer(items: readonly Record<string, unknown>[] = []): Answer {
  return json({ items });
}

export const VERSION_2 = {
  id: 'v2',
  version: 2,
  state: 'published',
  created_at: '2026-10-22T09:00:00.000Z',
  published_at: '2026-10-22T09:00:00.000Z',
};

export const VERSION_1 = {
  id: 'v1',
  version: 1,
  state: 'archived',
  created_at: '2026-10-20T09:00:00.000Z',
  published_at: '2026-10-20T09:00:00.000Z',
};

// grace of acme holding the capabilities given, with a theme read as `theme`.
export function brandingRoutes(
  theme: Answer = themeAnswer(),
  extra: Record<string, Answer> = {},
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${TH}`]: theme,
      [`GET ${TH}/versions`]: versionsAnswer([VERSION_2, VERSION_1]),
      [`GET ${MC}`]: json(CATALOGUE),
      [`GET ${SH}`]: json(STYLESHEET_HOOKS),
      [`GET ${PI}`]: json(previewInfo()),
      [assetContent(LOGO_ID)]: image(LOGO_BYTES),
    },
    extra,
  );
}

export const ML = `${ACME_ADMIN}/mail/branding`;
export const MO = `${ACME_ADMIN}/message-overrides`;
export const MC = `${ACME_ADMIN}/message-catalogue`;
export const PI = `${TH}/preview/info`;

const MAIL_COLOURS = {
  page: '#e7eae9',
  panel: '#ffffff',
  sunken: '#f3f5f4',
  border: '#d4d9d7',
  ink: '#161b1a',
  muted: '#56605d',
  link: '#0a6344',
  button: '#161b1a',
  button_ink: '#ffffff',
};

// A tenant whose published theme sets the light colours and a logo, and
// leaves the dark colours to the default.
export function mailBranding(changes: Partial<MailBrandingView> = {}): MailBrandingView {
  return {
    light: { source: 'tenant', colours: { ...MAIL_COLOURS, panel: '#fafafa' } },
    dark: {
      source: 'default',
      colours: { ...MAIL_COLOURS, page: '#151a19', panel: '#1c2221', ink: '#e4e9e7' },
    },
    logo: { src: 'https://id.example/brand/a.png', alt: 'Acme logo', width: 160, height: 32 },
    dark_logo: null,
    ...changes,
  };
}

// The messages a sign-in page and a registration page are filled from.
export const CATALOGUE = {
  sections: [
    {
      kinds: ['sign-in', 'consent', 'select-account', 'logout-confirm'],
      messages: [
        { key: 'login.help', en: 'Ask your administrator' },
        { key: 'login.submit', en: 'Sign in' },
        { key: 'login.title', en: 'Sign in to your account' },
      ],
    },
    {
      kinds: ['registration', 'reset'],
      messages: [
        { key: 'register.title', en: 'Create an account' },
        { key: 'register.submit', en: 'Register' },
      ],
    },
  ],
};

export const SH = `${ACME_ADMIN}/theme/stylesheet-hooks`;

// What a stylesheet's rules may name: more entries in all than one list draws.
export const STYLESHEET_HOOKS = {
  version: 1,
  classes: ['alert', 'brand', 'logo', 'logo-dark', 'logo-light', 'page', 'tenant', 'wordmark'],
  page_kind_classes: ['page-sign-in', 'page-consent', 'page-registration', 'page-notice'],
  elements: ['main', 'h1', 'p', 'a', 'button', 'input'],
  pseudo_classes: ['hover', 'focus-visible', 'disabled'],
  pseudo_elements: ['before', 'after'],
  tokens: [
    '--ink-primary',
    '--surface-page',
    ...Array.from({ length: 40 }, (_, n) => `--space-${String(n + 10)}`),
  ],
};

// What the preview says of a draft that is shown as it is.
export function previewInfo(changes: Partial<ThemePreviewInfo> = {}): ThemePreviewInfo {
  return {
    kind: 'sign-in',
    from: 'draft',
    shown: 'tenant',
    faults: [],
    refused: [],
    unfilled: false,
    ...changes,
  };
}

export function override(key: string, message: string, locale = 'en') {
  return { locale, key, message, updated_at: '2026-10-20T09:00:00.000Z' };
}

export const TITLE_OVERRIDE = override('login.title', 'Welcome back');
export const HELP_OVERRIDE = override('login.help', 'Ask your administrator');

// grace of acme on the Mail and Languages tabs: settings, mail branding and
// two overrides in English.
export function languagesRoutes(
  extra: Record<string, Answer> = {},
  settings: Record<string, unknown> = { supported_locales: ['en', 'ar'] },
): Record<string, Answer> {
  return brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
    [`GET ${ST}`]: settingsAnswer(settings),
    [`GET ${MO}`]: json({ items: [TITLE_OVERRIDE, HELP_OVERRIDE] }),
    [`GET ${ML}`]: json(mailBranding()),
    ...extra,
  });
}

export const CTH = `${C}/c-bill/theme`;

// What the tenant's published theme supplies under a client: the light colours
// and a logo, which a client may hide.
export const TENANT_LAYER = {
  'tokens.light': 'tenant',
  'assets.logo': 'tenant',
  'tokens.dark': 'default',
  stylesheet: 'default',
};

// The theme of the client billing, which sets what `changes` names, over the tenant's.
export function clientView(changes: Record<string, unknown> = {}) {
  return themeView({ scope: 'client', tenant_sources: TENANT_LAYER, ...changes });
}

// grace of acme on billing's Branding tab: its theme read as `theme`, over the tenant's.
export function clientBrandingRoutes(
  theme: Answer = themeAnswer(clientView()),
  extra: Record<string, Answer> = {},
  capabilities?: readonly string[],
): Record<string, Answer> {
  return clientRoutes(capabilities, {
    [`GET ${CTH}`]: theme,
    [`GET ${CTH}/versions`]: versionsAnswer([]),
    [`GET ${CTH}/preview/info`]: json(previewInfo()),
    [`GET ${MC}`]: json(CATALOGUE),
    [`GET ${SH}`]: json(STYLESHEET_HOOKS),
    ...extra,
  });
}
