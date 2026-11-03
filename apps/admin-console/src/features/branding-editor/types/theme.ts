import type { PALETTE_KEYS, THEME_PAGE_KINDS } from '@odudu/contracts';

export type { PutThemeRequest } from '@odudu/contracts/admin';
export type { ThemeBodyRequest } from '@odudu/contracts';

export type FontChoice = 'IBM Plex Sans' | 'IBM Plex Mono';

export type ThemePageKind = (typeof THEME_PAGE_KINDS)[number];

// The colours of one scheme, named after the custom properties the pages read.
export type ThemePalette = Record<(typeof PALETTE_KEYS)[number], string>;

export interface ThemeLogo {
  assetId: string;
  alt: string;
}

export interface ThemeImage {
  assetId: string;
}

// A stored theme: every part present.
export interface ThemeBody {
  tokens: {
    light?: ThemePalette | undefined;
    dark?: ThemePalette | undefined;
    font?: FontChoice | undefined;
  };
  stylesheet: string | null;
  templates: Partial<Record<ThemePageKind, string>>;
  assets: {
    logo?: ThemeLogo | undefined;
    darkLogo?: ThemeLogo | undefined;
    favicon?: ThemeImage | undefined;
    background?: ThemeImage | undefined;
  };
}

export type ThemeSource = 'client' | 'tenant' | 'default';

// Which layer supplies each piece, by the piece's name (`tokens.light`).
export type ThemeSources = Record<string, ThemeSource>;

export type ThemePiece = 'tokens' | 'assets' | 'stylesheet' | 'templates';

export interface PublishedTheme {
  id: string;
  version: number;
  published_at: string | null;
  body: ThemeBody;
}

export interface ThemeView {
  scope: 'tenant' | 'client';
  draft: ThemeBody | null;
  published: PublishedTheme | null;
  sources: ThemeSources;
  draft_sources: ThemeSources | null;
  // A client's view only: what the tenant's published theme supplies.
  tenant_sources: ThemeSources | null;
  // The parts of the draft that differ from this scope's own published theme.
  changed: ThemePiece[];
}

export interface ThemeWarning {
  piece: string;
  code: 'stylesheet-unverified' | 'template-unverified';
  message: string;
}

export interface PublishThemeResponse extends ThemeView {
  warnings: ThemeWarning[];
}

type PreviewLayer = 'client' | 'tenant';

// What the preview of one page shows and why.
export interface ThemePreviewInfo {
  kind: ThemePageKind;
  from: 'draft' | 'published' | 'none';
  shown: ThemeSource;
  faults: { layer: PreviewLayer; code: 'invalid_body' | 'image_gone' | 'stylesheet_refused' }[];
  refused: { layer: PreviewLayer; codes: string[] }[];
  unfilled: boolean;
}

// What a tenant stylesheet's selectors and values may name, with the version
// of the list.
export interface StylesheetHooksResponse {
  version: number;
  classes: string[];
  page_kind_classes: string[];
  elements: string[];
  pseudo_classes: string[];
  pseudo_elements: string[];
  tokens: string[];
}
