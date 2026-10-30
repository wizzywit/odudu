import { etagMatches } from '@odudu/kernel';
import { type PublishedIdentity } from '#/repository/published-themes';
import { type PublishedLayers } from '#/service/record';
import { createBrandingCache, type BrandingCache } from '#/service/branding-cache';
import { buildBranding } from '#/service/build-branding';
import { assetExtension, isClientRowId, parseBrandFile, sha256Hex } from '#/service/branding-urls';

// What a built stylesheet is remembered as, by the published versions it was
// built from. ADR 0041: at most 1,000 entries and 16 MiB of css, least
// recently used out; the key is database state, so a publish makes a new key
// and the old one ages out, and no entry depends on another process.
export const BRAND_MEMO = { maxEntries: 1000, maxBytes: 16 * 1024 * 1024 } as const;
// Builds in flight at once that share a result; past it a miss builds alone.
export const MAX_BRAND_BUILDS_IN_FLIGHT = 256;

export interface BuiltSheet {
  // Null when the layers set no css or are not used.
  hash: string | null;
  css: string;
}

export type BrandMemo = BrandingCache<BuiltSheet>;

export function createBrandMemo(now: () => number): BrandMemo {
  return createBrandingCache<BuiltSheet>({
    now,
    maxEntries: BRAND_MEMO.maxEntries,
    maxBytes: BRAND_MEMO.maxBytes,
    ttlMs: Number.POSITIVE_INFINITY,
  });
}

export interface ServeBrandDeps {
  // The origin pages are served from; a theme is only applied under one, so
  // without it no stylesheet is served.
  origin: string | undefined;
  findTenant(name: string): Promise<{ id: string; name: string } | null>;
  readAsset(tenantId: string, sha256: string): Promise<{ mime: string; bytes: Buffer } | null>;
  // The asset's type without its bytes.
  readAssetMime(tenantId: string, sha256: string): Promise<string | null>;
  // Which published versions a scope resolves to; no bodies.
  readIdentity(tenantId: string, clientRowId: string | null): Promise<PublishedIdentity>;
  readPublished(tenantId: string, clientRowId: string | null): Promise<PublishedLayers>;
  memo: BrandMemo;
  inflight: Map<string, Promise<BuiltSheet>>;
}

export interface BrandRequest {
  tenant: string;
  // The client row id segment of a hashed stylesheet's URL, if the URL had one.
  client: string | null;
  // The last path segment: a hash and an extension.
  file: string;
  // The request's If-None-Match, so a revalidation is answered from metadata.
  ifNoneMatch?: string | undefined;
}

export type BrandAnswer =
  | {
      kind: 'content';
      contentType: string;
      bytes: Buffer;
      // Strong and quoted; the hash the URL names.
      etag: string;
    }
  | { kind: 'unchanged'; etag: string };

async function buildSheet(
  deps: ServeBrandDeps,
  tenant: { id: string; name: string },
  client: string | null,
  origin: string,
  key: string,
  identity: PublishedIdentity,
): Promise<BuiltSheet> {
  const layers = await deps.readPublished(tenant.id, client);
  const built = buildBranding({
    tenantName: tenant.name,
    origin,
    layers: [
      ...(layers.client === null ? [] : [{ name: 'client' as const, layer: layers.client }]),
      ...(layers.tenant === null ? [] : [{ name: 'tenant' as const, layer: layers.tenant }]),
    ],
  });
  const sheet: BuiltSheet =
    built.css === '' ? { hash: null, css: '' } : { hash: sha256Hex(built.css), css: built.css };
  // Remembered only when the layers read are the ones the key names; a
  // publish between the two reads leaves the answer to the next request.
  const same =
    layers.tenant?.versionId === identity.tenant?.versionId &&
    layers.client?.versionId === identity.client?.versionId;
  if (same) {
    deps.memo.set(
      key,
      tenant.id,
      sheet,
      2 * sheet.css.length + 256,
      deps.memo.generation(tenant.id),
    );
  }
  return sheet;
}

async function stylesheetFor(
  deps: ServeBrandDeps,
  tenant: { id: string; name: string },
  client: string | null,
  origin: string,
): Promise<BuiltSheet | null> {
  const identity = await deps.readIdentity(tenant.id, client);
  if (identity.tenant === null && identity.client === null) return null;
  // A client segment that resolves to no layer is no alias of the tenant's URL.
  if (client !== null && identity.client === null) return null;
  const key = [
    tenant.id,
    tenant.name,
    client ?? '',
    identity.tenant?.versionId ?? '',
    identity.client?.versionId ?? '',
  ].join('|');
  const held = deps.memo.get(key);
  if (held !== undefined) return held.value;
  const running = deps.inflight.get(key);
  if (running !== undefined) return running;
  const started = buildSheet(deps, tenant, client, origin, key, identity).finally(() => {
    if (deps.inflight.get(key) === started) deps.inflight.delete(key);
  });
  if (deps.inflight.size < MAX_BRAND_BUILDS_IN_FLIGHT) deps.inflight.set(key, started);
  return started;
}

// What a brand URL answers, or null for every reason it answers nothing, so
// a missing hash, another tenant's and an unpublished one look alike. A
// stylesheet is compared to the hash of what the published versions its URL
// names build to, remembered by those versions: a hash that is not theirs
// costs one small read when the build is remembered and the build itself
// when it is not (ADR 0046). The build checks it again.
export async function serveBrand(
  deps: ServeBrandDeps,
  request: BrandRequest,
): Promise<BrandAnswer | null> {
  const file = parseBrandFile(request.file);
  if (file === null) return null;
  if (request.client !== null && (file.kind !== 'css' || !isClientRowId(request.client))) {
    return null;
  }
  const tenant = await deps.findTenant(request.tenant);
  if (tenant === null) return null;
  const etag = `"${file.sha256}"`;
  const revalidating = etagMatches(request.ifNoneMatch, etag);

  if (file.kind === 'image') {
    if (revalidating) {
      const mime = await deps.readAssetMime(tenant.id, file.sha256);
      return mime !== null && assetExtension(mime) === file.extension
        ? { kind: 'unchanged', etag }
        : null;
    }
    const asset = await deps.readAsset(tenant.id, file.sha256);
    if (asset === null || assetExtension(asset.mime) !== file.extension) return null;
    return { kind: 'content', contentType: asset.mime, bytes: asset.bytes, etag };
  }

  if (deps.origin === undefined) return null;
  const sheet = await stylesheetFor(deps, tenant, request.client, deps.origin);
  if (sheet?.hash !== file.sha256) return null;
  if (revalidating) return { kind: 'unchanged', etag };
  return {
    kind: 'content',
    contentType: 'text/css; charset=utf-8',
    bytes: Buffer.from(sheet.css),
    etag,
  };
}
