import { z } from 'zod';

// The shape of a theme, shared by the admin API that saves one and the
// renderer that reads one back. Written without transforms or defaults so it
// converts to JSON Schema for the request validator; the domain package
// lowercases the colours and ids and fills the absent parts.

// The families Instrument serves itself; a theme names one, never a URL.
export const FONT_CHOICES = ['IBM Plex Sans', 'IBM Plex Mono'] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

export const MAX_TEMPLATE_BYTES = 64 * 1024;
export const MAX_STYLESHEET_BYTES = 128 * 1024;
export const MAX_ALT_LENGTH = 200;

// Every page kind a theme may carry a template for; the kernel's page
// manifest holds the same list, and a test in the theme package keeps the two
// equal.
export const THEME_PAGE_KINDS = [
  'sign-in',
  'consent',
  'select-account',
  'logout-confirm',
  'totp-enrolment',
  'passkey-enrolment',
  'recovery-codes',
  'update-password',
  'required-action',
  'registration',
  'reset',
  'verification',
  'required-actions',
  'authorize-error',
  'email-unverified',
  'logged-out',
  'notice',
] as const;

// The colours of one scheme, named after the custom properties the pages read.
export const PALETTE_KEYS = [
  'surfacePage',
  'surfacePanel',
  'surfaceSunken',
  'inkPrimary',
  'inkMuted',
  'signalActive',
  'signalActiveInk',
  'signalDanger',
  'signalDangerInk',
  'borderStrong',
  'focusRing',
] as const;

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

// The byte bound is a refinement, which JSON Schema cannot carry: the request
// validator passes a long text and the theme package refuses it by path.
function boundedText(maxBytes: number): z.ZodType<string> {
  return z.string().superRefine((text, ctx) => {
    if (byteLength(text) > maxBytes) {
      ctx.addIssue({ code: 'too_big', origin: 'string', maximum: maxBytes, inclusive: true });
    }
  });
}

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const paletteSchema = z.strictObject({
  surfacePage: colour,
  surfacePanel: colour,
  surfaceSunken: colour,
  inkPrimary: colour,
  inkMuted: colour,
  signalActive: colour,
  signalActiveInk: colour,
  signalDanger: colour,
  signalDangerInk: colour,
  borderStrong: colour,
  focusRing: colour,
});

const assetId = z.uuid();
const alt = z
  .string()
  .max(MAX_ALT_LENGTH)
  .refine((value) => value.trim() !== '');

export const themeTokensSchema = z.strictObject({
  light: paletteSchema.optional(),
  dark: paletteSchema.optional(),
  font: z.enum(FONT_CHOICES).optional(),
});

export const themeLogoSchema = z.strictObject({ assetId, alt });
export const themeImageSchema = z.strictObject({ assetId });

export const themeAssetsSchema = z.strictObject({
  logo: themeLogoSchema.optional(),
  darkLogo: themeLogoSchema.optional(),
  favicon: themeImageSchema.optional(),
  background: themeImageSchema.optional(),
});

export const themeTemplatesSchema = z.partialRecord(
  z.enum(THEME_PAGE_KINDS),
  boundedText(MAX_TEMPLATE_BYTES),
);

export const themeStylesheetSchema = boundedText(MAX_STYLESHEET_BYTES).nullable();

// What a request names: any part may be left out and is then absent.
export const themeBodyRequestSchema = z.strictObject({
  tokens: themeTokensSchema.optional(),
  stylesheet: themeStylesheetSchema.optional(),
  templates: themeTemplatesSchema.optional(),
  assets: themeAssetsSchema.optional(),
});
export type ThemeBodyRequest = z.infer<typeof themeBodyRequestSchema>;

// What a stored theme answers: every part present.
export const themeBodySchema = z.strictObject({
  tokens: themeTokensSchema,
  stylesheet: themeStylesheetSchema,
  templates: themeTemplatesSchema,
  assets: themeAssetsSchema,
});
export type ThemeBodyWire = z.infer<typeof themeBodySchema>;
