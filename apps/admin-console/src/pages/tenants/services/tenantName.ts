import { isTenantName } from '@odudu/contracts';
import { requiredProblem } from '#/shared/services/fieldErrors';
import { TENANT_NAME_RULE_TEXT } from '#/shared/services/labels';

export function nameProblem(name: string): string | null {
  const missing = requiredProblem(name, 'Enter a name for the tenant.', { trim: false });
  if (missing !== null) return missing;
  return isTenantName(name) ? null : TENANT_NAME_RULE_TEXT;
}

const SYSTEM_ISSUER_TAIL = '/tenants/system';

// Every tenant's issuer is the public base's `/tenants/<name>`, so the one
// the console can read, the system tenant's, shows where a new one will be.
export function issuerPreview(systemIssuer: string | undefined, name: string): string | null {
  if (systemIssuer?.endsWith(SYSTEM_ISSUER_TAIL) !== true || !isTenantName(name)) return null;
  return `${systemIssuer.slice(0, -SYSTEM_ISSUER_TAIL.length)}/tenants/${name}`;
}
