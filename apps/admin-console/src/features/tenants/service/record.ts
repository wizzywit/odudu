import { blockedChanges, lacking, type Change } from '#/shared/service/access.ts';
import { administratorNeeds } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT, type AdminCapability, type Authority } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export const TENANT_TABS = ['general', 'administrators', 'export'] as const;

export type TenantTab = (typeof TENANT_TABS)[number];

// The record's name among the drafts and caches it keeps.
export function tenantRecord(name: string): string {
  return `tenants/${name}`;
}

export interface TenantRecordAccess {
  // What reading the record needs that whoami says is missing.
  readNeeds: readonly AdminCapability[];
  // What adding an administrator needs that whoami says is missing.
  addNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  blocked: Change | null;
}

// A tenant's record is read with manage-tenant, which the System area's own
// manage-tenants does not carry.
export function tenantRecordAccess(
  authority: Authority | undefined,
  name: string,
): TenantRecordAccess {
  const adding = administratorNeeds(name, { subjectId: null, granted: false });
  return {
    readNeeds: lacking(authority, ['manage-tenant']),
    addNeeds: lacking(authority, adding),
    blocked: blockedChanges(authority, [{ change: 'add their administrators', needs: adding }]),
  };
}

const SYSTEM_FIXED =
  'system cannot be disabled: it is the tenant every cross-tenant administrator signs in to.';

// Why a tenant cannot be enabled or disabled, shown as fixed text.
export function disableFixed(name: string): string | null {
  return name === SYSTEM_TENANT ? SYSTEM_FIXED : null;
}

export function tenantChangeFailure(name: string, failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not confirm the change to ${name}. It has not been sent again; check its status before trying again.`;
    case 'problem':
      if (failure.problem.status === 412) {
        return `${name} changed elsewhere since you opened it. It has been read again; look at it before trying again.`;
      }
      if (failure.problem.status === 403) return 'This needs the manage-tenant capability.';
      return failure.problem.detail ?? failure.problem.title;
    case 'schema':
    case 'defect':
      return 'The console could not make the change. This is a fault in the console, not something you did.';
  }
}
