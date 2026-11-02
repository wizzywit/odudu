import { isTenantName } from '@odudu/contracts';
import { type Tenant } from '@odudu/contracts/admin';
import { TENANT_NAME_RULE_TEXT } from '#/shared/services/labels';

export type { Tenant };

export function nameProblem(name: string): string | null {
  if (name === '') return 'Enter a name for the tenant.';
  return isTenantName(name) ? null : TENANT_NAME_RULE_TEXT;
}

const SYSTEM_ISSUER_TAIL = '/tenants/system';

// Every tenant's issuer is the public base's `/tenants/<name>`, so the one
// the console can read, the system tenant's, shows where a new one will be.
export function issuerPreview(systemIssuer: string | undefined, name: string): string | null {
  if (systemIssuer?.endsWith(SYSTEM_ISSUER_TAIL) !== true || !isTenantName(name)) return null;
  return `${systemIssuer.slice(0, -SYSTEM_ISSUER_TAIL.length)}/tenants/${name}`;
}

// What a save of the general section sends: only the fields that changed.
export function generalPatch(changes: { display_name?: string }): { display_name?: string } {
  return changes.display_name === undefined ? {} : { display_name: changes.display_name };
}
