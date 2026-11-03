import {
  holdingLabel,
  holdingOptions,
  grantableIn,
  isHolding,
  type Held,
  type Holding,
  type HoldingOption,
  onlyHolderText,
} from '#/shared/services/capabilities';
import { listOrNone } from '#/shared/services/format';
import { type AdminCapability } from '#/shared/services/principal';
import type { Choice } from '#/shared/services/choice';

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

export function describeHoldings(value: unknown): string {
  const named = Array.isArray(value) ? value.map(String).filter(isHolding) : [];
  return listOrNone(named.map(holdingLabel), { join: 'comma' });
}

export function holderFilterOptions(tenant: string): Choice[] {
  return [
    { id: 'any', label: 'Any capability' },
    { id: 'tenant-admin', label: 'Full (tenant-admin)' },
    ...grantableIn(tenant).map((capability) => ({ id: capability, label: capability })),
  ];
}
