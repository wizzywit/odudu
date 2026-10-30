import { z } from 'zod';

// The mails a tenant's theme dresses and the preview can show.
export const MAIL_PREVIEW_KINDS = ['verify-email'] as const;

// The languages a build holds a mail catalogue for; a test holds the list
// equal to the i18n package's SHIPPED_LOCALES.
export const MAIL_PREVIEW_LOCALES = ['en', 'ar'] as const;

// A kind left out is `verify-email`; a locale left out is the tenant's default.
export const previewMailQuerySchema = z.strictObject({
  kind: z.enum(MAIL_PREVIEW_KINDS).optional(),
  scheme: z.enum(['light', 'dark']).optional(),
  locale: z.enum(MAIL_PREVIEW_LOCALES).optional(),
});
export type PreviewMailQuery = z.infer<typeof previewMailQuerySchema>;

export const mailColoursSchema = z.object({
  page: z.string(),
  panel: z.string(),
  sunken: z.string(),
  border: z.string(),
  ink: z.string(),
  muted: z.string(),
  link: z.string(),
  button: z.string(),
  button_ink: z.string(),
});
export type MailColoursView = z.infer<typeof mailColoursSchema>;

export const mailSchemeSchema = z.object({
  // `client` only on a client's own mail view: the client's published theme
  // sets that scheme's palette.
  source: z.enum(['client', 'tenant', 'default']),
  colours: mailColoursSchema,
});

export const mailLogoSchema = z.object({
  src: z.string(),
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});

export const mailBrandingViewSchema = z.object({
  light: mailSchemeSchema,
  dark: mailSchemeSchema,
  logo: mailLogoSchema.nullable(),
  dark_logo: mailLogoSchema.nullable(),
});
export type MailBrandingView = z.infer<typeof mailBrandingViewSchema>;
