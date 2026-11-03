import { roleReachUnavailable } from '#/shared/lib/services/capabilities';
import { sortedIds } from '#/shared/lib/services/ids';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { MappedRole } from '#/entities/role/types/mappedRole';

export type IndexedRole = MappedRole & { admin_reach: readonly string[] };

interface Reaching {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  admin_reach: readonly string[];
}

// The mapped roles, which carry no description, and then the picker's roles,
// which do and so win.
export function roleIndex(
  items: readonly Reaching[],
  options: readonly (Reaching & { description: string | null })[],
): ReadonlyMap<string, IndexedRole> {
  const entry = (role: Reaching, description: string | null): [string, IndexedRole] => [
    role.id,
    {
      id: role.id,
      name: role.name,
      client_id: role.client_id,
      client_key: role.client_key,
      description,
      admin_reach: role.admin_reach,
    },
  ];
  return new Map([
    ...items.map((role) => entry(role, null)),
    ...options.map((role) => entry(role, role.description)),
  ]);
}

// A role with no record is named by its id, its owner unknown.
export function mappedRoles(
  ids: readonly string[],
  index: ReadonlyMap<string, IndexedRole>,
): MappedRole[] {
  return ids.map((id) => {
    const found = index.get(id);
    return found === undefined
      ? { id, name: id, client_id: null, client_key: null, description: null }
      : {
          id,
          name: found.name,
          client_id: found.client_id,
          client_key: found.client_key,
          description: found.description,
        };
  });
}

// A mapped role the caller could not give is one it cannot take. With a
// `lookup`, the reach is read from that index (a picker's entry may override
// the item's) and a role the index has no record of is not kept.
export function keptRoles(
  items: readonly {
    id: string;
    name: string;
    client_key: string | null;
    admin_reach: readonly string[];
  }[],
  caller: readonly AdminCapability[],
  tenant: string,
  lookup?: ReadonlyMap<string, IndexedRole>,
): string[] {
  return items
    .filter((role) => {
      const judged = lookup === undefined ? role : lookup.get(role.id);
      return judged !== undefined && roleReachUnavailable(judged, caller, tenant) !== null;
    })
    .map((role) => role.id);
}

// Where a mapped role's reach is read: from its own entry, or from the
// index, which a picker's record of the role may override.
export type ReachFrom = 'entry' | 'picker';

export function keptMapped(
  items: Parameters<typeof keptRoles>[0],
  caller: readonly AdminCapability[],
  tenant: string,
  index: ReadonlyMap<string, IndexedRole>,
  reachFrom: ReachFrom,
): string[] {
  return keptRoles(items, caller, tenant, reachFrom === 'picker' ? index : undefined);
}

export function withKept(ids: readonly string[], kept: readonly string[]): string[] {
  return sortedIds([...new Set([...ids, ...kept])]);
}

// A role as an assignment shows it: its name, and the client whose role it
// is by that client's key, or null for a tenant role.
export interface AssignedRole {
  id: string;
  name: string;
  client: string | null;
}

export function knownAssignments(
  ...lists: (readonly { id: string; name: string; client_key: string | null }[])[]
): ReadonlyMap<string, AssignedRole> {
  return new Map(
    lists
      .flat()
      .map((role) => [role.id, { id: role.id, name: role.name, client: role.client_key }]),
  );
}

// A role not known is named by its id.
export function assignmentsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, AssignedRole>,
): AssignedRole[] {
  return ids.map((id) => known.get(id) ?? { id, name: id, client: null });
}

export function byNameThenClient(roles: readonly AssignedRole[]): AssignedRole[] {
  return [...roles].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.client ?? '').localeCompare(b.client ?? ''),
  );
}

// The assignments shown for a client's service account: sorted, a role not
// known named by its id.
export function assignedRoles(
  ids: readonly string[],
  known: ReadonlyMap<string, AssignedRole>,
): AssignedRole[] {
  return byNameThenClient(assignmentsOf(ids, known));
}

export function roleNameOf(known: ReadonlyMap<string, { name: string }>): (id: string) => string {
  return (id) => known.get(id)?.name ?? id;
}
