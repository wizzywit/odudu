import { SYSTEM_TENANT } from '#/shared/services/principal';
import type { Creation, CreationFlow } from '#/features/tenants/services/creation';

export const FRESH_CREATION: Creation = { step: 'tenant', name: '', displayName: '' };

export function administratorOf(
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): Creation {
  return {
    step: 'administrator',
    tenant,
    origin,
    username: '',
    email: '',
    subjectId: null,
    granted: false,
    holdings: ['tenant-admin'],
  };
}

// Creating a tenant, adding an administrator to one existing tenant, and
// adding one of system's own: each flow keeps its own progress, so a page

export function flowOf(tenant: string): CreationFlow {
  return tenant === SYSTEM_TENANT ? 'system-administrator' : `administrator/${tenant}`;
}

function tenantOf(flow: CreationFlow): string | null {
  if (flow === 'tenant') return null;
  return flow === 'system-administrator' ? SYSTEM_TENANT : flow.slice('administrator/'.length);
}

export function freshCreation(flow: CreationFlow): Creation {
  const tenant = tenantOf(flow);
  return tenant === null ? FRESH_CREATION : administratorOf(tenant, 'existing');
}

// A tenant's creation carries on into the administrator of the tenant it created.
export function belongsTo(flow: CreationFlow, creation: Creation): boolean {
  const tenant = tenantOf(flow);
  if (creation.step === 'tenant') return tenant === null;
  if (tenant !== null) return creation.tenant === tenant;
  return (
    creation.tenant !== SYSTEM_TENANT && (creation.step === 'done' || creation.origin === 'created')
  );
}

// Whether the step is the first administrator of a tenant just made, or a

// Resumed when the subject was already created, since a retry would find its
// username taken and leave it without a role.
export function resumesAdministrator(stored: Creation | null): boolean {
  return stored?.step === 'administrator' && stored.subjectId !== null;
}
