import {
  FONT_CHOICES,
  MAX_ALT_LENGTH,
  MAX_STYLESHEET_BYTES,
  MAX_TEMPLATE_BYTES,
  PALETTE_KEYS,
  themeAssetsSchema,
  themeStylesheetSchema,
  themeTemplatesSchema,
  themeTokensSchema,
  type FontChoice,
} from '@odudu/contracts';
import { type PageKind } from '@odudu/kernel';
import { z } from 'zod';

// The shape is the admin API's contract, so a body that parses here is one
// the API accepts; only the defaults and the lower-casing live in this file.
export { FONT_CHOICES, MAX_ALT_LENGTH, MAX_STYLESHEET_BYTES, MAX_TEMPLATE_BYTES };
export type { FontChoice };

// Named after the custom properties the pages read. A group is complete or
// absent, so a client that overrides one replaces it whole. Not themeable,
// because they carry no text, surface or control relationship: the grid
// lines, hairline and label line (decoration), and the warning and system
// signals, which no server page reads.
export interface Palette {
  surfacePage: string;
  surfacePanel: string;
  surfaceSunken: string;
  inkPrimary: string;
  inkMuted: string;
  signalActive: string;
  signalActiveInk: string;
  signalDanger: string;
  signalDangerInk: string;
  borderStrong: string;
  focusRing: string;
}

export interface TokenGroups {
  light?: Palette | undefined;
  dark?: Palette | undefined;
  font?: FontChoice | undefined;
}

export interface LogoAsset {
  assetId: string;
  alt: string;
}

export interface ImageAsset {
  assetId: string;
}

export interface ThemeAssets {
  logo?: LogoAsset | undefined;
  darkLogo?: LogoAsset | undefined;
  favicon?: ImageAsset | undefined;
  background?: ImageAsset | undefined;
}

export interface ThemeBody {
  tokens: TokenGroups;
  stylesheet: string | null;
  templates: Partial<Record<PageKind, string>>;
  assets: ThemeAssets;
}

export type BodyIssueCode = 'type' | 'format' | 'required' | 'too_large' | 'unknown_key';

export interface BodyIssue {
  // A JSON pointer to the offending value; the empty string is the body.
  path: string;
  code: BodyIssueCode;
}

export type ParsedBody = { ok: true; body: ThemeBody } | { ok: false; issues: BodyIssue[] };

const bodySchema = z.strictObject({
  tokens: themeTokensSchema.default({}),
  stylesheet: themeStylesheetSchema.default(null),
  templates: themeTemplatesSchema.default({}),
  assets: themeAssetsSchema.default({}),
});

function codeOf(issue: z.core.$ZodIssue): BodyIssueCode {
  switch (issue.code) {
    case 'unrecognized_keys':
      return 'unknown_key';
    case 'too_big':
      return 'too_large';
    case 'too_small':
      return 'required';
    case 'invalid_format':
      return 'format';
    default:
      return 'type';
  }
}

const pointer = (segments: readonly PropertyKey[]): string =>
  segments.map((segment) => `/${String(segment)}`).join('');

function issuesOf(error: z.ZodError): BodyIssue[] {
  return error.issues.flatMap((issue) => {
    const code = codeOf(issue);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ path: pointer([...issue.path, key]), code }));
    }
    if (issue.code === 'invalid_key') {
      return [
        {
          path: pointer([...issue.path, ...issue.issues.flatMap((inner) => inner.path)]),
          code: 'unknown_key' as const,
        },
      ];
    }
    return [{ path: pointer(issue.path), code }];
  });
}

function lowerPalette(palette: z.infer<typeof bodySchema>['tokens']['light']): Palette | undefined {
  if (palette === undefined) return undefined;
  const lowered = { ...palette };
  for (const key of PALETTE_KEYS) lowered[key] = palette[key].toLowerCase();
  return lowered;
}

// Colours and ids compare as lower case everywhere downstream.
function normalise(parsed: z.infer<typeof bodySchema>): ThemeBody {
  const { tokens, assets } = parsed;
  const lowerAsset = <T extends { assetId: string }>(asset: T | undefined): T | undefined =>
    asset === undefined ? undefined : { ...asset, assetId: asset.assetId.toLowerCase() };
  return {
    ...parsed,
    tokens: {
      ...tokens,
      ...(tokens.light === undefined ? {} : { light: lowerPalette(tokens.light) }),
      ...(tokens.dark === undefined ? {} : { dark: lowerPalette(tokens.dark) }),
    },
    assets: {
      ...(assets.logo === undefined ? {} : { logo: lowerAsset(assets.logo) }),
      ...(assets.darkLogo === undefined ? {} : { darkLogo: lowerAsset(assets.darkLogo) }),
      ...(assets.favicon === undefined ? {} : { favicon: lowerAsset(assets.favicon) }),
      ...(assets.background === undefined ? {} : { background: lowerAsset(assets.background) }),
    },
  };
}

export function parseThemeBody(input: unknown): ParsedBody {
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, body: normalise(parsed.data) };
}

// Every asset the body names, once each.
export function assetIdsOf(assets: ThemeAssets): string[] {
  const slots = [assets.logo, assets.darkLogo, assets.favicon, assets.background];
  return [...new Set(slots.flatMap((slot) => (slot === undefined ? [] : [slot.assetId])))];
}
