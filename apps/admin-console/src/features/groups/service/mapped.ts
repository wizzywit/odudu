import type { Role, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { sortedIds } from '#/shared/service/ids.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import { roleUnavailable } from '#/features/groups/service/blocks.ts';

export interface Mapped {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  description: string | null;
}

type MappedItem = SetGroupRolesResponse['items'][number];

// The mapped roles, which carry no description, and then the picker's roles,
// which do and so win.
export function roleIndex(
  items: readonly MappedItem[],
  options: readonly Role[],
): ReadonlyMap<string, Mapped> {
  const entry = (role: MappedItem | Role, description: string | null): [string, Mapped] => [
    role.id,
    {
      id: role.id,
      name: role.name,
      client_id: role.client_id,
      client_key: role.client_key,
      description,
    },
  ];
  return new Map([
    ...items.map((role) => entry(role, null)),
    ...options.map((role) => entry(role, role.description)),
  ]);
}

export function mappedRoles(ids: readonly string[], index: ReadonlyMap<string, Mapped>): Mapped[] {
  return ids.map(
    (id) => index.get(id) ?? { id, name: id, client_id: null, client_key: null, description: null },
  );
}

// A role mapped here that the caller could not give is one it cannot take.
export function keptRoles(
  items: readonly MappedItem[],
  caller: readonly AdminCapability[],
  tenant: string,
): string[] {
  return items
    .filter((role) => roleUnavailable(role, caller, null, tenant) !== null)
    .map((role) => role.id);
}

export function reachOfRoles(items: readonly MappedItem[], ids: readonly string[]): string[] {
  return ids.flatMap((id) => items.find((role) => role.id === id)?.admin_reach ?? []);
}

export function withKept(ids: readonly string[], kept: readonly string[]): string[] {
  return sortedIds([...new Set([...ids, ...kept])]);
}
