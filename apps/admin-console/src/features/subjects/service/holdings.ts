import { type HeldAdminCapability } from '@odudu/contracts/admin';
import { MANAGE_TENANTS, TENANT_ADMIN } from '#/shared/service/administrators.ts';
import {
  holdingLabel,
  holdingOptions,
  grantableIn,
  includedBy,
  isHolding,
  type Held,
  type Holding,
  type HoldingOption,
} from '#/shared/service/capabilities.ts';
import { andList } from '#/shared/service/format.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import { type Loaded } from '#/features/subjects/service/create.ts';
import { onlyHolderText } from '#/features/subjects/service/access.ts';

// What else, beyond the boxes, keeps the counted capability with them. Full
// counts too when a group or another role carries it, since the box only
// takes away what is assigned here.
export function keptOtherwise(held: ReadonlyMap<Holding, Held>, counted: Holding): boolean {
  return (
    (held.get(counted)?.through ?? []).some((path) => path !== `within ${TENANT_ADMIN}`) ||
    (counted !== TENANT_ADMIN && (held.get(TENANT_ADMIN)?.through.length ?? 0) > 0)
  );
}

export function capabilitiesRemoveTenants(
  tenant: string,
  base: readonly string[],
  chosen: readonly string[],
  kept: boolean,
): boolean {
  const reaches = (holdings: readonly string[]): boolean =>
    holdings.some((holding) => holding === TENANT_ADMIN || holding === MANAGE_TENANTS);
  return tenant === SYSTEM_TENANT && reaches(base) && !reaches(chosen) && !kept;
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

export function capabilityOptions({
  tenant,
  name,
  chosen,
  caller,
  held,
  guarded,
  counted,
}: {
  tenant: string;
  name: string;
  chosen: readonly string[];
  caller: readonly AdminCapability[] | undefined;
  held: ReadonlyMap<Holding, Held>;
  guarded: Holding | null;
  counted: string;
}): HoldingOption[] {
  return holdingOptions(tenant, chosen, caller, {
    held,
    guard: (holding) => (holding === guarded ? onlyHolderText(name, tenant, counted) : null),
  });
}

export interface HeldElsewhere {
  label: string;
  through: string;
}

// A holding the subject has only through a group or a role that nests it,
// which only that group or role can take away.
export function heldElsewhere(
  held: ReadonlyMap<Holding, Held>,
  chosen: readonly string[],
): HeldElsewhere[] {
  return [...held]
    .filter(([holding, how]) => {
      if (how.direct || includedBy(holding, chosen) !== null) return false;
      return how.through.some((path) => !path.startsWith('within '));
    })
    .map(([holding, how]) => ({ label: holdingLabel(holding), through: how.through.join(', ') }));
}

export function elsewhereText(name: string, elsewhere: readonly HeldElsewhere[]): string {
  const held = andList(elsewhere.map((each) => `${each.label} ${each.through}`));
  return `${held}: only that group or role takes it away, on ${name}’s `;
}

export function describeHoldings(value: unknown): string {
  const named = Array.isArray(value) ? value.map(String).filter(isHolding) : [];
  return named.length === 0 ? 'none' : named.map(holdingLabel).join(', ');
}

export function adminRolesBlocked(
  status: 'loading' | 'ready' | 'failed',
  blocked: string | undefined,
): string | undefined {
  if (status === 'loading') return 'The admin roles are still being read.';
  if (status === 'failed') return 'The admin roles could not be read, so nothing can be saved.';
  return blocked;
}

// manage-tenants, which in system reaches every other tenant.
export function reachesEveryTenant(
  tenant: string,
  held: readonly Pick<HeldAdminCapability, 'name'>[],
): boolean {
  return (
    tenant === SYSTEM_TENANT &&
    held.some((each) => each.name === MANAGE_TENANTS || each.name === TENANT_ADMIN)
  );
}

export function holderFilterOptions(tenant: string): { id: string; label: string }[] {
  return [
    { id: 'any', label: 'Any capability' },
    { id: 'tenant-admin', label: 'Full (tenant-admin)' },
    ...grantableIn(tenant).map((capability) => ({ id: capability, label: capability })),
  ];
}
