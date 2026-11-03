import { TENANT_NAME_RULE_TEXT } from '#/shared/services/principal';
import { isTenantName, SYSTEM_TENANT } from '#/shared/services/principal';
import { type Principal } from '#/entities/session/types/principal';

// The tenant this browser last signed in to is only a fallback: a tenant
// the URL names, or a live session, always comes first.
export function remembers(named: string | null, signedIn: boolean): boolean {
  return named === null && !signedIn;
}

// Whether the tenant in the address exists, as far as whoami can say:
// undefined until it answers. Only a system administrator reaches a tenant
// other than their own, so only their 401 can mean that none has the name.
export function tenantMissing(
  principal: Principal | null,
  tenant: string,
  refusedUnknown: boolean | undefined,
): boolean | undefined {
  if (principal?.tenant !== SYSTEM_TENANT || tenant === SYSTEM_TENANT) {
    return refusedUnknown === undefined ? undefined : false;
  }
  return refusedUnknown;
}

export function namedTenant(asked: string | null): string | null {
  return asked !== null && isTenantName(asked) ? asked : null;
}

export function tenantProblem(tenant: string): string | undefined {
  return isTenantName(tenant) ? undefined : TENANT_NAME_RULE_TEXT;
}
