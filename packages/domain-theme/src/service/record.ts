import { type ThemeBody } from '#/service/body';

export interface ThemeScope {
  tenantId: string;
  clientId: string | null;
}

export type ThemeState = 'draft' | 'published' | 'archived';

export interface ThemeRecord {
  id: string;
  scope: ThemeScope;
  state: ThemeState;
  // Zero for a draft, which has not been published.
  version: number;
  // Derived from the stored body, so it changes exactly when the body does.
  etag: string;
  body: ThemeBody;
  publishedAt: Date | null;
}

// A published or archived version as a list shows it, with no body.
export interface ThemeVersionSummary {
  id: string;
  version: number;
  state: ThemeState;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface AssetRef {
  id: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
}

export interface AssetRecord extends AssetRef {
  tenantId: string;
  bytes: Buffer;
}

// The most versions (published and archived) a scope keeps.
export const THEME_VERSION_LIMIT = 20;

export interface PublishedAsset {
  id: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
}

// A published version as stored. `body` is whatever the row holds and is not
// trusted: the reader parses it before use.
export interface PublishedLayer {
  versionId: string;
  // The client's row id, null for the tenant's own theme.
  clientId: string | null;
  version: number;
  body: unknown;
  // The images the version names that still exist.
  assets: PublishedAsset[];
}

export interface PublishedLayers {
  tenant: PublishedLayer | null;
  client: PublishedLayer | null;
}
