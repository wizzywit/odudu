import { isTenantName, TENANT_NAME_RULE } from '@odudu/contracts';
import { type Tenant } from '@odudu/contracts/admin';

export type { Tenant };

export const NAME_RULE = `${TENANT_NAME_RULE.charAt(0).toUpperCase()}${TENANT_NAME_RULE.slice(1)}.`;

export function nameProblem(name: string): string | null {
  if (name === '') return 'Enter a name for the tenant.';
  return isTenantName(name) ? null : NAME_RULE;
}

const SYSTEM_ISSUER_TAIL = '/tenants/system';

// Every tenant's issuer is the public base's `/tenants/<name>`, so the one
// the console can read, the system tenant's, shows where a new one will be.
export function issuerPreview(systemIssuer: string | undefined, name: string): string | null {
  if (systemIssuer?.endsWith(SYSTEM_ISSUER_TAIL) !== true || !isTenantName(name)) return null;
  return `${systemIssuer.slice(0, -SYSTEM_ISSUER_TAIL.length)}/tenants/${name}`;
}
