import {
  TENANT_ADMIN,
  TENANT_ROLE_TEXT,
  isAdminRole,
  isHolding,
  type Holding,
} from '#/shared/services/capabilities';
import { loadedData, type Loaded } from '#/shared/services/read';

interface Assigned {
  id: string;
  name: string;
  client_key: string | null;
}

export interface SplitRoles {
  roleIds: string[];
  adminIds: string[];
  // The admin capabilities assigned, Full first, in the order they are offered.
  holdings: Holding[];
}

// One assignment list holds both: the admin capabilities are edited on their
// own, and every save sends the other part back as it was.
export function splitRoles(items: readonly Assigned[]): SplitRoles {
  const admin = items.filter((role) => isAdminRole(role));
  const holdings = admin.map((role) => role.name).filter((name) => isHolding(name));
  return {
    roleIds: items.filter((role) => !isAdminRole(role)).map((role) => role.id),
    adminIds: admin.map((role) => role.id),
    holdings: [
      ...holdings.filter((name) => name === TENANT_ADMIN),
      ...holdings.filter((name) => name !== TENANT_ADMIN),
    ],
  };
}

export function roleUnavailableHere(role: {
  name: string;
  client_key: string | null;
}): string | null {
  return isAdminRole(role) ? 'an admin capability: set it under Admin capabilities' : null;
}

export function roleOwnerOf(client: string | null): string {
  return client === null ? TENANT_ROLE_TEXT : `client ${client}`;
}

export function roleIdsOf(
  holdings: readonly Holding[],
  read: Loaded<ReadonlyMap<Holding, string>>,
): { ids: string[] } | { missing: Holding[] } {
  const adminRoles = loadedData(read);
  if (adminRoles === undefined) return { missing: [...holdings] };
  const missing = holdings.filter((holding) => !adminRoles.has(holding));
  if (missing.length > 0) return { missing };
  return { ids: holdings.flatMap((holding) => adminRoles.get(holding) ?? []) };
}
