import { holds } from '#/shared/lib/services/access';
import { SYSTEM_TENANT, type Authority } from '#/shared/lib/services/principal';
import type { Principal } from '#/entities/session';

export function showsSystemArea(
  principal: Principal,
  tenant: string,
  authority: Authority | undefined,
): boolean {
  return (
    principal.tenant === SYSTEM_TENANT &&
    tenant === SYSTEM_TENANT &&
    holds(authority, 'manage-tenants')
  );
}

// A system administrator inside any other tenant acts with system authority,
// and the bar saying so is shown from the first render: whoami can only
// confirm it, never be waited for.
export function actsWithSystemAuthority(
  principal: Principal,
  tenant: string,
  authority: Authority | undefined,
): boolean {
  if (principal.tenant !== SYSTEM_TENANT || tenant === SYSTEM_TENANT) return false;
  return authority?.crossTenant ?? true;
}
