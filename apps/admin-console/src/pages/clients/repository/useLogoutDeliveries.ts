import { readLogoutDeliveries } from '#/pages/clients/adapter/operations';
import { deliveriesKey } from '#/shared/lib/repository/queryKeys';
import { optionalFilter } from '#/shared/lib/services/filters';
import { useListPages } from '#/shared/lib/repository/useResourceList';

// The deliveries of one status, or of any, a page at a time; the list reads
// again when the status changes, since a cursor is bound to its filter.
export function useLogoutDeliveries(tenant: string, clientDbId: string, status: string | null) {
  return useListPages({
    key: deliveriesKey(tenant, clientDbId),
    query: new URLSearchParams(optionalFilter('status', status)),
    cursor: undefined,
    read: (gateway, query) => readLogoutDeliveries(gateway, tenant, clientDbId, query),
  });
}
