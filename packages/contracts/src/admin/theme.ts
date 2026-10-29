import { z } from 'zod';
import { dateTimeSchema, idSchema } from '#/admin/shared';
import { THEME_PAGE_KINDS, themeBodyRequestSchema, themeBodySchema } from '#/theme-body';

// The most a theme write may carry: the largest theme (a template for each of
// the seventeen page kinds and a stylesheet) with room for JSON escaping.
// Fastify refuses a larger body before it reads it.
export const THEME_BODY_LIMIT = 4 * 1024 * 1024;

// The versions a scope keeps, published and archived together.
export const THEME_VERSIONS_LIMIT = 20;

export const putThemeRequestSchema = themeBodyRequestSchema;
export type PutThemeRequest = z.infer<typeof putThemeRequestSchema>;

// Which layer supplies a piece. The names of the pieces are the theme
// package's own (`tokens.light`, `templates.sign-in`, `assets.logo`), so they
// are not restated here.
export const themeSourceSchema = z.enum(['client', 'tenant', 'default']);
export const themeSourcesSchema = z.record(z.string(), themeSourceSchema);

export const publishedThemeSchema = z.object({
  id: idSchema,
  version: z.number().int(),
  published_at: dateTimeSchema.nullable(),
  body: themeBodySchema,
});

// The parts of a theme a draft can differ in; the theme package keeps the same
// list, and a test holds the two equal.
export const THEME_DIFF_PIECES = ['tokens', 'assets', 'stylesheet', 'templates'] as const;

export const themeViewSchema = z.object({
  scope: z.enum(['tenant', 'client']),
  draft: themeBodySchema.nullable(),
  published: publishedThemeSchema.nullable(),
  sources: themeSourcesSchema,
  draft_sources: themeSourcesSchema.nullable(),
  // A client's view only: what the tenant's published theme supplies, so each
  // piece the client sets can say which of the tenant's it hides.
  tenant_sources: themeSourcesSchema.nullable(),
  // The parts of the draft that differ from this scope's own published theme,
  // computed by the server; empty without a draft. Nothing published compares
  // as the empty theme.
  changed: z.array(z.enum(THEME_DIFF_PIECES)),
});
export type ThemeView = z.infer<typeof themeViewSchema>;

export const themeWarningSchema = z.object({
  piece: z.string(),
  code: z.enum(['stylesheet-unverified', 'template-unverified']),
  message: z.string(),
});

export const publishThemeResponseSchema = themeViewSchema.extend({
  warnings: z.array(themeWarningSchema),
});
export type PublishThemeResponse = z.infer<typeof publishThemeResponseSchema>;

export const themeVersionSchema = z.object({
  id: idSchema,
  version: z.number().int(),
  state: z.enum(['published', 'archived']),
  created_at: dateTimeSchema,
  published_at: dateTimeSchema.nullable(),
});

export const listThemeVersionsResponseSchema = z.object({
  items: z.array(themeVersionSchema),
});
export type ListThemeVersionsResponse = z.infer<typeof listThemeVersionsResponseSchema>;

// What the preview renders: one page kind, in the light or dark scheme (the
// operating system's when none is asked for). A kind left out is `sign-in`.
export const previewThemeQuerySchema = z.strictObject({
  kind: z.enum(THEME_PAGE_KINDS).optional(),
  scheme: z.enum(['light', 'dark']).optional(),
});
export type PreviewThemeQuery = z.infer<typeof previewThemeQuerySchema>;

// What the preview of one page shows and why, for a console that frames the
// preview and so cannot read its headers.
export const PREVIEW_FAULT_CODES = ['invalid_body', 'image_gone', 'stylesheet_refused'] as const;

export const themePreviewFaultSchema = z.object({
  layer: z.enum(['client', 'tenant']),
  code: z.enum(PREVIEW_FAULT_CODES),
});

export const themePreviewRefusedSchema = z.object({
  layer: z.enum(['client', 'tenant']),
  codes: z.array(z.string()),
});

export const themePreviewInfoSchema = z.object({
  kind: z.enum(THEME_PAGE_KINDS),
  from: z.enum(['draft', 'published', 'none']),
  shown: z.enum(['client', 'tenant', 'default']),
  faults: z.array(themePreviewFaultSchema),
  refused: z.array(themePreviewRefusedSchema),
  unfilled: z.boolean(),
});
export type ThemePreviewInfo = z.infer<typeof themePreviewInfoSchema>;

// What a tenant stylesheet's selectors and values may name, as the checker
// accepts them, with the version of the list.
export const stylesheetHooksResponseSchema = z.object({
  version: z.number().int().positive(),
  classes: z.array(z.string()),
  page_kind_classes: z.array(z.string()),
  elements: z.array(z.string()),
  pseudo_classes: z.array(z.string()),
  pseudo_elements: z.array(z.string()),
  tokens: z.array(z.string()),
});
export type StylesheetHooksResponse = z.infer<typeof stylesheetHooksResponseSchema>;

// The slots an uploaded image may fill; the theme package keeps each one's
// limits, and a test holds the two lists equal.
export const THEME_ASSET_KINDS = ['logo', 'darkLogo', 'favicon', 'background'] as const;
export const themeAssetKindSchema = z.enum(THEME_ASSET_KINDS);

export const uploadThemeAssetQuerySchema = z.strictObject({ kind: themeAssetKindSchema });
export type UploadThemeAssetQuery = z.infer<typeof uploadThemeAssetQuerySchema>;

// The largest image any kind accepts, which is what Fastify refuses a larger
// upload at before reading it; the smaller kinds are refused at their own.
export const THEME_ASSET_BODY_LIMIT = 1024 * 1024;

export const themeAssetSchema = z.object({
  id: idSchema,
  sha256: z.string(),
  mime: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  kind: themeAssetKindSchema,
});
export type ThemeAsset = z.infer<typeof themeAssetSchema>;
