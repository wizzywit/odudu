import type { AuditEvent } from '#/entities/audit-event';
import { holds } from '#/shared/services/access';
import type { AdminCapability, Authority } from '#/shared/services/principal';
import type {
  Gated,
  OverviewAsks,
  OverviewRead,
  ReadName,
} from '#/features/overview/types/overviewReads';

// Before whoami answers a read is `off` and shows as loading; after, one
// whose capability is not held, or that the server refused, names it.
export function gate<T>(
  read: OverviewRead<T>,
  authority: Authority | undefined,
  capability: AdminCapability | null,
): Gated<T> {
  if (capability === null) return read;
  const refused = read.status === 'failed' && read.refused;
  if ((authority !== undefined && !holds(authority, capability)) || refused) {
    return { status: 'needs', capability };
  }
  return read;
}

// What an area says a read needs: the overview's `AreaOf` is one.
export type CapabilityOf = (path: string) => { capability: AdminCapability | null };

// The area each read belongs to, whose capability it needs; the tenant's
// public documents belong to none.
export const READ_AREA: Readonly<Record<ReadName, string | null>> = {
  discovery: null,
  jwks: null,
  subjects: 'subjects',
  clients: 'clients',
  groups: 'groups',
  roles: 'roles',
  scopes: 'scopes',
  settings: 'settings',
  smtp: 'email',
  keys: 'keys',
  audit: 'audit',
};

export function readCapability(name: ReadName, areaOf: CapabilityOf): AdminCapability | null {
  const area = READ_AREA[name];
  return area === null ? null : areaOf(area).capability;
}

// A read the capability allows, once whoami has said what is held; the
// public documents are asked for as soon as the tenant is known to exist.
export function overviewAsks(
  authority: Authority | undefined,
  tenantMissing: boolean | undefined,
  areaOf: CapabilityOf,
): OverviewAsks {
  const has = (name: ReadName): boolean => {
    const capability = readCapability(name, areaOf);
    return authority !== undefined && capability !== null && holds(authority, capability);
  };
  return {
    discovery: tenantMissing === false,
    subjects: has('subjects'),
    clients: has('clients'),
    groups: has('groups'),
    roles: has('roles'),
    scopes: has('scopes'),
    settings: has('settings'),
    smtp: has('smtp'),
    keys: has('keys'),
    audit: has('audit'),
  };
}

// The latest audit rows are left off the page when the area is not the
// caller's to read.
export function auditView(
  access: { kind: 'hidden' | 'checking' | 'refused' | 'open' },
  audit: OverviewRead<readonly AuditEvent[]>,
  authority: Authority | undefined,
  areaOf: CapabilityOf,
): Gated<readonly AuditEvent[]> | null {
  return access.kind === 'refused' ? null : gate(audit, authority, areaOf('audit').capability);
}
