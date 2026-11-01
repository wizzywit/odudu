import { MAX_DECODED_PIXELS, type InspectLimits } from '#/service/image';

export type AssetKind = 'logo' | 'darkLogo' | 'favicon' | 'background';

export interface AssetLimits {
  // The upload's size, checked before anything is decoded. The re-encoded
  // file may be up to OUTPUT_GROWTH times this (see withinOutputLimit).
  maxBytes: number;
  maxSide: number;
}

const SMALL: AssetLimits = { maxBytes: 256 * 1024, maxSide: 1024 };

export const ASSET_LIMITS: Record<AssetKind, AssetLimits> = {
  logo: SMALL,
  darkLogo: SMALL,
  favicon: SMALL,
  background: { maxBytes: 1024 * 1024, maxSide: 2560 },
};

// What one tenant's stored images may total (ADR 0046).
export const TENANT_ASSET_CAP_BYTES = 8 * 1024 * 1024;

export function inspectLimitsFor(kind: AssetKind): InspectLimits {
  return { maxPixels: MAX_DECODED_PIXELS, maxSide: ASSET_LIMITS[kind].maxSide };
}

// A re-encode can come out a little larger than a well-compressed upload; a
// file under its limit is not refused for that unless it grows past this.
export const OUTPUT_GROWTH = 1.25;

// The most a stored image can weigh: the largest kind's upload limit, grown by
// what a re-encode may add. A read that returns bytes asks no more than this.
export const MAX_STORED_ASSET_BYTES = Math.floor(
  Math.max(...Object.values(ASSET_LIMITS).map((limits) => limits.maxBytes)) * OUTPUT_GROWTH,
);

export function withinOutputLimit(kind: AssetKind, length: number): boolean {
  return length <= Math.floor(ASSET_LIMITS[kind].maxBytes * OUTPUT_GROWTH);
}

export function withinByteLimit(kind: AssetKind, length: number): boolean {
  return length <= ASSET_LIMITS[kind].maxBytes;
}
