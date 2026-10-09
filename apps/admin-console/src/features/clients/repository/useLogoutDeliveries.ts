import { readLogoutDeliveries } from '#/features/clients/adapter/operations.ts';
import { useListPages } from '#/shared/repository/useResourceList.ts';

// The deliveries of one status, or of any, a page at a time; the list reads
// again when the status changes, since a cursor is bound to its filter.
export function useLogoutDeliveries(tenant: string, clientDbId: string, status: string | null) {
  return useListPages({
    key: ['deliveries', tenant, clientDbId],
    query: new URLSearchParams(status === null ? {} : { status }),
    cursor: undefined,
    read: (gateway, query) => readLogoutDeliveries(gateway, tenant, clientDbId, query),
  });
}
