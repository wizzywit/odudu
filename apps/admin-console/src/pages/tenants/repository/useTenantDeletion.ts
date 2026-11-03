import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { deleteTenant } from '#/pages/tenants/adapter/tenants';
import { heldForTenant, settledDeletion } from '#/pages/tenants/services/deletion';
import { tenantRecord } from '#/pages/tenants/services/tenantRecordTabs';
import {
  countKey,
  listKey,
  overviewKey,
  RECORD_KIND,
  recordKey,
} from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import type { GatewayResult } from '#/shared/services/result';

// The lists of tenants, their count and the system trail that records the
// deletion are read again at once. The deleted tenant's own entries go when
// the page is left: removing them while its page is mounted would read each
// again and find nothing.
export function useTenantDeletion(name: string): Write<void, GatewayResult<undefined>> {
  const client = useQueryClient();
  const { invalidate, invalidateExact } = useInvalidate();
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    if (!deleted) return undefined;
    return () => {
      client.removeQueries({
        predicate: ({ queryKey }) => heldForTenant(queryKey, name, RECORD_KIND),
      });
    };
  }, [client, deleted, name]);
  return useWrite({
    send: async (gateway) => settledDeletion(await deleteTenant(gateway, name)),
    onSuccess: (result) => {
      if (!result.ok) {
        // A refusal may mean the tenant's state moved, as an enabled flag did.
        invalidateExact(recordKey(SYSTEM_TENANT, tenantRecord(name)));
        return;
      }
      setDeleted(true);
      invalidate(
        listKey(SYSTEM_TENANT, 'tenants'),
        countKey(SYSTEM_TENANT, 'tenants'),
        listKey(SYSTEM_TENANT, 'audit'),
        overviewKey(SYSTEM_TENANT),
      );
    },
  });
}
