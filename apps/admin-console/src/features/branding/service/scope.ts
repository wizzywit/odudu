import type { ThemeView } from '@odudu/contracts/admin';

// Whose theme a call is about: the tenant's own, or one client's. `below` is
// what the tenant's published theme supplies, as the client's own read says;
// it only words what a piece hides, and takes no part in what is requested.
export type ThemeScope =
  { kind: 'tenant' } | { kind: 'client'; id: string; below?: ThemeView['sources'] };

export const TENANT_SCOPE: ThemeScope = { kind: 'tenant' };

export function clientScope(id: string): ThemeScope {
  return { kind: 'client', id };
}

// Where the scope's theme sits under the tenant in the admin API.
export function themeParts(scope: ThemeScope): readonly string[] {
  return scope.kind === 'tenant' ? ['theme'] : ['clients', scope.id, 'theme'];
}

// The record the console caches the theme under, and its sections' drafts.
export function themeRecord(scope: ThemeScope): string {
  return themeParts(scope).join('/');
}

// The part of a theme write's key for writes that belong to no one scope.
export const TENANT_WIDE_WRITES = 'tenant-wide';

export function scopeKeyPart(scope: ThemeScope): string {
  return scope.kind === 'tenant' ? 'tenant' : `client:${scope.id}`;
}

// The tag a theme with no draft is held under: the server sends none, and a
// first save must then carry no If-Match at all.
export const NO_DRAFT_TAG = '"no-draft"';

export function ifMatchOf(tag: string): string | undefined {
  return tag === NO_DRAFT_TAG ? undefined : tag;
}

export function tagOf(etag: string | null): string {
  return etag ?? NO_DRAFT_TAG;
}

// The scope with what lies under it, where the read says: a client's view does.
export function placedOver(scope: ThemeScope, view: ThemeView | undefined): ThemeScope {
  const below = view?.tenant_sources;
  if (scope.kind === 'tenant' || below === undefined || below === null) return scope;
  return { ...scope, below };
}
