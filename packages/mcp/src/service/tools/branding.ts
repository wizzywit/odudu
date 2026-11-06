import {
  listMessageOverridesQuerySchema,
  listMessageOverridesResponseSchema,
  listThemeVersionsResponseSchema,
  mailBrandingViewSchema,
  messageCatalogueResponseSchema,
  previewThemeQuerySchema,
  stylesheetHooksResponseSchema,
  themePreviewInfoSchema,
  themeViewSchema,
} from '@odudu/contracts/admin';
import { pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

// A theme's stylesheet and its page templates are authored text, kept whole
// rather than cut at 1,000 characters, and they stay under `data` like every
// other string.
export const THEME_LONG_TEXT = [
  'draft.stylesheet',
  'draft.templates',
  'published.body.stylesheet',
  'published.body.templates',
] as const;

export const brandingTools = [
  valueTool({
    name: 'get_theme',
    description:
      "Reads the tenant's draft and published theme: colours, font, images, stylesheet and page " +
      'templates, which layer supplies each piece, and which parts of the draft differ from the ' +
      "published theme. The etag beside data is the draft's, when there is one. A theme too large " +
      'for one result is refused as mcp:result_too_large.',
    routeKey: tenantGet('/theme'),
    capability: 'manage-tenant',
    shape: {},
    response: themeViewSchema,
    etag: true,
    longText: THEME_LONG_TEXT,
  }),
  valueTool({
    name: 'list_theme_versions',
    description:
      "Lists the tenant's published theme version and the archived ones, newest first, at most 20, " +
      'without their bodies. Not paged.',
    routeKey: tenantGet('/theme/versions'),
    capability: 'manage-tenant',
    shape: {},
    response: listThemeVersionsResponseSchema,
  }),
  valueTool({
    name: 'get_theme_preview_info',
    description:
      'Says what the preview of one page kind in a scheme would show and why: whether the draft, ' +
      "the published theme or neither is the tenant's own layer, which layer the page is shown " +
      'from, what was left out and whether a template could not be filled. It reads no page.',
    routeKey: tenantGet('/theme/preview/info'),
    capability: 'manage-tenant',
    shape: previewThemeQuerySchema.shape,
    response: themePreviewInfoSchema,
  }),
  valueTool({
    name: 'get_stylesheet_hooks',
    description:
      'Reads what a stylesheet may name: the classes, page-kind classes, elements, pseudo-classes, ' +
      'pseudo-elements and design tokens the stylesheet check accepts, with the version of the ' +
      'list. The same for every tenant.',
    routeKey: tenantGet('/theme/stylesheet-hooks'),
    capability: 'manage-tenant',
    shape: {},
    response: stylesheetHooksResponseSchema,
  }),
  valueTool({
    name: 'get_mail_branding',
    description:
      "Reads the colours and logo the tenant's mail takes from its published theme, for each " +
      "scheme, and whether the theme or Odudu's default supplies each palette.",
    routeKey: tenantGet('/mail/branding'),
    capability: 'manage-tenant',
    shape: {},
    response: mailBrandingViewSchema,
  }),
  pageTool({
    name: 'list_message_overrides',
    description:
      "Lists the tenant's own wording for the messages its pages show, for one locale, in key " +
      'order, one page at a time. Each carries its etag.',
    routeKey: tenantGet('/message-overrides'),
    capability: 'manage-tenant',
    shape: { ...listMessageOverridesQuerySchema.shape, ...pageShape },
    response: listMessageOverridesResponseSchema,
  }),
  valueTool({
    name: 'get_message_catalogue',
    description:
      'Reads the messages the pages and mail are filled from: the keys a template may name and ' +
      'an override may be set under, each with its English text, in sections by page kind. The ' +
      'same for every tenant; not paged.',
    routeKey: tenantGet('/message-catalogue'),
    capability: 'manage-tenant',
    shape: {},
    response: messageCatalogueResponseSchema,
  }),
];
