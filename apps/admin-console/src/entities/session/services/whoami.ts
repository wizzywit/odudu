import { dataOf } from '#/shared/lib/services/settled';
import { isUnknownTenant } from '#/shared/lib/services/failure';
import type { Authority } from '#/shared/lib/services/principal';
import type { GatewayResult } from '#/shared/lib/services/result';

// What whoami granted, nothing until it has answered or when it refused.
export function authorityOf(read: GatewayResult<Authority> | undefined): Authority | undefined {
  return dataOf(read);
}

// Whether the tenant is one the admin API does not know; unknown until answered.
export function refusedUnknownOf(read: GatewayResult<Authority> | undefined): boolean | undefined {
  return read === undefined ? undefined : isUnknownTenant(read);
}
