import { type Held, type Holding, TENANT_ADMIN } from '#/shared/services/capabilities';
import { type Loaded } from '#/shared/services/read';

// What else, beyond the boxes, keeps the counted capability with them. Full
// counts too when a group or another role carries it, since the box only
// takes away what is assigned here.
export function keptOtherwise(held: ReadonlyMap<Holding, Held>, counted: Holding): boolean {
  return (
    (held.get(counted)?.through ?? []).some((path) => path !== `within ${TENANT_ADMIN}`) ||
    (counted !== TENANT_ADMIN && (held.get(TENANT_ADMIN)?.through.length ?? 0) > 0)
  );
}

// The one holding whose removal would leave the tenant with no enabled
// holder of what the last-administrator guard counts; null when none.
export function onlyHolder({
  enabled,
  held,
  counted,
  holders,
  keptOtherwise: kept,
  chosen,
}: {
  enabled: boolean;
  held: ReadonlyMap<Holding, Held>;
  counted: Holding;
  holders: Loaded<{ count: number; capped: boolean }>;
  keptOtherwise: boolean;
  chosen: readonly string[];
}): Holding | null {
  const carriers = [...new Set<Holding>([TENANT_ADMIN, counted])].filter((holding) =>
    chosen.includes(holding),
  );
  const only =
    enabled &&
    held.has(counted) &&
    holders.status === 'ready' &&
    !holders.data.capped &&
    holders.data.count === 1 &&
    !kept &&
    carriers.length === 1;
  return only ? (carriers[0] ?? null) : null;
}
