import { dataOf } from '#/shared/services/settled';
import { isUnknownTenant } from '#/shared/services/failure';
import type { Authority } from '#/shared/services/principal';
import type { GatewayResult } from '#/shared/services/result';

// What whoami granted, nothing until it has answered or when it refused.
export function authorityOf(read: GatewayResult<Authority> | undefined): Authority | undefined {
  return dataOf(read);
}

// Whether the tenant is one the admin API does not know; unknown until answered.
export function refusedUnknownOf(read: GatewayResult<Authority> | undefined): boolean | undefined {
  return read === undefined ? undefined : isUnknownTenant(read);
}
