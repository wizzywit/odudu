import type { Client, LogoutDelivery } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useLogoutDeliveries } from '#/features/clients/repository/useLogoutDeliveries.ts';
import { ANY_STATUS, statusFilter } from '#/features/clients/service';
import type { ListStatus } from '#/shared/service/resourceList.ts';

export interface ClientDeliveries {
  status: string;
  setStatus: (status: string) => void;
  list: {
    status: ListStatus;
    rows: readonly LogoutDelivery[];
    more: boolean;
    loadingMore: boolean;
    loadMore: () => void;
    retry: () => void;
  };
}

export function useClientDeliveries(tenant: string, client: Client): ClientDeliveries {
  const [status, setStatus] = useState(ANY_STATUS);
  const pages = useLogoutDeliveries(tenant, client.id, statusFilter(status));
  return {
    status,
    setStatus,
    list: {
      status: pages.status,
      rows: pages.rows,
      more: pages.next !== null,
      loadingMore: pages.loadingMore,
      loadMore: pages.loadMore,
      retry: pages.retry,
    },
  };
}
