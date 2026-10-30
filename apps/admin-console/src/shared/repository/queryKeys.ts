// Every cache key a read or an invalidation names for more than one hook.
// A hook builds its key here and a change elsewhere invalidates it from the
// same function, so the shape has one author.

export function listKey(tenant: string, ...resource: readonly string[]) {
  return ['list', tenant, ...resource] as const;
}

// One list read, from `cursor` onwards, under the list's own key.
export function pageKey(
  key: readonly unknown[],
  query: URLSearchParams,
  cursor: string | undefined,
) {
  return [...key, query.toString(), cursor ?? ''] as const;
}

export function countKey(tenant: string, ...resource: readonly string[]) {
  return ['count', tenant, ...resource] as const;
}

export function pickerKey(tenant: string, resource: string) {
  return ['picker', tenant, resource] as const;
}

// The kind of a record entry, which a change reads again by its path prefix.
export const RECORD_KIND = 'record';

export function recordKey(tenant: string, record: string) {
  return [RECORD_KIND, tenant, record] as const;
}

// The kind of a read of one group, which a change to groups reads again.
export const GROUP_KIND = 'group';

export function groupKey(tenant: string, id: string | null) {
  return [GROUP_KIND, tenant, id] as const;
}

export function holdersKey(tenant: string, ...rest: readonly string[]) {
  return ['holders', tenant, ...rest] as const;
}

export function heldCapabilitiesKey(tenant: string, ...subject: readonly string[]) {
  return ['held-capabilities', tenant, ...subject] as const;
}

export function membershipsKey(tenant: string, subject: string) {
  return ['memberships', tenant, subject] as const;
}

export function scopeClientsKey(tenant: string, ...scope: readonly string[]) {
  return ['scope-clients', tenant, ...scope] as const;
}

// What deleting one scope would take with it, read again each time it is asked.
export function scopeImpactKey(tenant: string, scope: string) {
  return ['scope-impact', tenant, scope] as const;
}

// Which built-in scopes a tenant has, read again each time the restore is asked.
export function builtinScopesKey(tenant: string) {
  return ['builtin-scopes', tenant] as const;
}

export function evaluateKey(
  tenant: string,
  client: string,
  ...asked: readonly (string | number)[]
) {
  return ['evaluate', tenant, client, ...asked] as const;
}

export function deliveriesKey(tenant: string, client: string) {
  return ['deliveries', tenant, client] as const;
}

export function copyKey(tenant: string, ...source: readonly (string | null)[]) {
  return ['copy', tenant, ...source] as const;
}

export function systemIssuerKey() {
  return ['system-issuer'] as const;
}

export function installationKey(tenant: string, client: string) {
  return ['installation', tenant, client] as const;
}

export function adminRolesKey(tenant: string) {
  return ['admin-roles', tenant] as const;
}

export function usernamePolicyKey(tenant: string) {
  return ['username-policy', tenant] as const;
}

export function authorityKey(tenant: string, subject: string | null) {
  return ['authority', tenant, subject] as const;
}

// What is found, whichever kind of thing and wherever, read once and dropped.
export function findKey(...what: readonly string[]) {
  return ['find', ...what] as const;
}

// The reads of one subject's sign-in state, each made stale by its own change.
export function subjectReadKey(
  read: 'credentials' | 'lockout',
  tenant: string,
  ...id: readonly string[]
) {
  return [read, tenant, ...id] as const;
}

// The ETag a copy's write waits on, read once and dropped.
export function copyEtagKey(tenant: string, id: string, part: string) {
  return ['copy-etag', tenant, id, part] as const;
}

export function exportKey(tenant: string, includeSubjects: boolean) {
  return ['export', tenant, includeSubjects] as const;
}

export function auditExportKey(tenant: string, query: string) {
  return ['audit-export', tenant, query] as const;
}

export function sessionKey() {
  return ['session'] as const;
}

export function overviewKey(tenant: string, ...read: readonly string[]) {
  return ['overview', tenant, ...read] as const;
}

// The published and archived versions of one scope's theme.
export function themeVersionsKey(tenant: string, scope: string) {
  return ['theme-versions', tenant, scope] as const;
}

// A write to one scope's theme while it runs, so a page can tell which one
// is in flight whichever of its parts started it.
export function themeWriteKey(tenant: string, scope: string, write: string) {
  return ['theme-write', tenant, scope, write] as const;
}

// Every write to a tenant's theme while it runs, whichever scope or part.
export function themeWritesKey(tenant: string) {
  return ['theme-write', tenant] as const;
}

// What a tenant's mail inherits from its published theme, read again once
// a newer version is published.
// A client's own mail is a different read; an empty `client` is the tenant's.
export function mailBrandingKey(tenant: string, publishedVersion: number, client = '') {
  return ['mail-branding', tenant, publishedVersion, client] as const;
}

// The messages a tenant's pages are filled from: the same for every tenant and
// fixed for a build, so it is read once.
export function messageCatalogueKey(tenant: string) {
  return ['message-catalogue', tenant] as const;
}

// What a tenant's stylesheets may name: the same for every tenant and fixed
// for a build, so it is read once.
export function stylesheetHooksKey(tenant: string) {
  return ['stylesheet-hooks', tenant] as const;
}

// An uploaded image's bytes as a data address. An image's content never
// changes under its id, so a read of it is kept (`freshness(true)`).
export function assetImageKey(tenant: string, assetId: string) {
  return ['asset-image', tenant, assetId] as const;
}

// What the preview of one page of a scope shows and why, read again whenever
// the frame is reloaded (`frame` is the frame's own key).
export function previewInfoKey(tenant: string, scope: string, frame: string) {
  return ['preview-info', tenant, scope, frame] as const;
}
