import type { SigningKey } from '@odudu/contracts/admin';
import type { Authority } from '#/shared/services/principal';
import { type Jwks, rawJson } from '#/features/overview/services/discovery';
import {
  type CapabilityOf,
  type OverviewReads,
  type OverviewRead,
  gate,
  mapOverviewRead,
} from '#/features/overview/services/reads';

// `unlisted` is published but absent from the key list; `unknown` is a list
// that could not be read.
export type KeyLane = SigningKey['status'] | 'unlisted' | 'unknown';

export interface PublishedKey {
  // Its place in the set: a kid is optional, so it cannot key a row.
  row: string;
  kid: string | null;
  kty: string;
  alg: string | null;
  use: string | null;
  lane: KeyLane;
}

export function publishedKeys(
  jwks: Jwks,
  keys: readonly SigningKey[] | undefined,
): readonly PublishedKey[] {
  return jwks.keys.map((key, index) => {
    const kid = key.kid ?? null;
    const listed = keys?.find((k) => k.kid === kid);
    let lane: KeyLane = 'unknown';
    if (keys !== undefined) lane = listed?.status ?? 'unlisted';
    return {
      row: String(index),
      kid,
      kty: key.kty,
      alg: key.alg ?? null,
      use: key.use ?? null,
      lane,
    };
  });
}

export interface KeysView {
  rows: readonly PublishedKey[];
  raw: string;
  // The capability the keys' lanes need, when it is not held.
  lanesNeed: string | null;
}

export function keysView(
  reads: OverviewReads,
  authority: Authority | undefined,
  areaOf: CapabilityOf,
): OverviewRead<KeysView> {
  const keys = gate(reads.keys, authority, areaOf('keys').capability);
  const listed = keys.status === 'ready' ? keys.data : undefined;
  return mapOverviewRead(reads.jwks, (jwks) => ({
    rows: publishedKeys(jwks, listed),
    raw: rawJson(jwks),
    lanesNeed: keys.status === 'needs' ? keys.capability : null,
  }));
}
