import { uploadThemeAssetQuerySchema, type UploadThemeAssetQuery } from '@odudu/contracts/admin';
import { ASSET_LIMITS } from '@odudu/domain-theme';

// The most an upload of the kind the query names may carry; null for a query
// that names none, which the route refuses before it reads a body.
export function uploadLimitFor(query: unknown): number | null {
  const parsed = uploadThemeAssetQuerySchema.safeParse(query);
  return parsed.success ? ASSET_LIMITS[parsed.data.kind].maxBytes : null;
}

export interface UploadLimits {
  readonly bytes: string;
  readonly side: number;
}

// A kind's limits in the words a refusal uses.
export function uploadLimitsFor(kind: UploadThemeAssetQuery['kind']): UploadLimits {
  const limits = ASSET_LIMITS[kind];
  const kib = limits.maxBytes / 1024;
  return {
    bytes: kib >= 1024 ? `${String(kib / 1024)} MiB` : `${String(kib)} KiB`,
    side: limits.maxSide,
  };
}

// What `Retry-After` tells a caller refused because every decode slot is taken.
export const BUSY_RETRY_SECONDS = 2;
