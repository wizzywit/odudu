import type { SigningKey } from '#/entities/signing-key';
import type { PublishedLane } from '#/entities/signing-key';
import type { Authority } from '#/shared/lib/services/principal';
import { laneText } from '#/pages/overview/services/panelText';
import { rawJson } from '#/pages/overview/services/discovery';
import type { EntityRules } from '#/pages/overview/services/entityRules';
import { type CapabilityOf, gate } from '#/pages/overview/services/readGate';
import { mapOverviewRead } from '#/pages/overview/services/readState';
import type { Jwks, OverviewRead, OverviewReads } from '#/pages/overview/types/overviewReads';

export interface PublishedKey {
  // Its place in the set: a kid is optional, so it cannot key a row.
  row: string;
  kid: string | null;
  kty: string;
  alg: string | null;
  use: string | null;
  lane: PublishedLane;
  laneLabel: string;
}

export function publishedKeys(
  jwks: Jwks,
  keys: readonly SigningKey[] | undefined,
  laneOf: EntityRules['publishedLane'],
): readonly PublishedKey[] {
  return jwks.keys.map((key, index) => {
    const kid = key.kid ?? null;
    const listed = keys?.find((k) => k.kid === kid);
    const lane = laneOf(listed?.status, keys !== undefined);
    return {
      row: String(index),
      kid,
      kty: key.kty,
      alg: key.alg ?? null,
      use: key.use ?? null,
      lane,
      laneLabel: laneText(lane),
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
  rules: EntityRules,
): OverviewRead<KeysView> {
  const keys = gate(reads.keys, authority, areaOf('keys').capability);
  const listed = keys.status === 'ready' ? keys.data : undefined;
  return mapOverviewRead(reads.jwks, (jwks) => ({
    rows: publishedKeys(jwks, listed, rules.publishedLane),
    raw: rawJson(jwks),
    lanesNeed: keys.status === 'needs' ? keys.capability : null,
  }));
}
