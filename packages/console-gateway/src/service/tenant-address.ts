import { baseIsTls } from '@odudu/domain-tenant';
import { domainAddress, pathAddress, type TenantAddress } from '@odudu/kernel';

// Where the console reaches a tenant's OIDC endpoints and sends the browser to
// sign in: the root of its canonical domain when it has one, else its path on
// the public base. The address a tenant left no longer serves sign-in.
export function consoleAddressOf(
  base: URL,
  tenant: string,
  canonicalHost: string | null,
): TenantAddress {
  return canonicalHost === null
    ? pathAddress(base.origin, tenant)
    : domainAddress(canonicalHost, baseIsTls(base.origin));
}
