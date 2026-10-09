export interface Row {
  id: string;
  tags: readonly string[];
  pairs: ReadonlyArray<string>;
  point: readonly [number, number];
  byId: ReadonlyMap<string, Row>;
  seen: ReadonlySet<string>;
}

export type Answer = { ok: true; rows: readonly Row[] } | { ok: false };

export type Frozen = Readonly<Record<string, string>>;

export const LIMITS = { page: 50 } as const;
