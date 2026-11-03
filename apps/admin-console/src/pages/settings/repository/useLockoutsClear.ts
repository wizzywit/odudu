import type { ClearLockoutsResponse } from '#/pages/settings/types/lockouts';
import { clearTenantLockouts } from '#/pages/settings/adapter/lockouts';
import { listKey } from '#/shared/lib/repository/queryKeys';
import { subjectReadKey } from '#/entities/subject';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { GatewayResult } from '#/shared/lib/services/result';

// A clear changes what every subject's lockout read says, and is itself
// recorded in the tenant's audit trail.
export function useLockoutsClear(
  tenant: string,
): Write<void, GatewayResult<ClearLockoutsResponse>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: (gateway) => clearTenantLockouts(gateway, tenant),
    onSettled: () => {
      invalidate(subjectReadKey('lockout', tenant), listKey(tenant, 'audit'));
    },
  });
}
