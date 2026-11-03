import type { Client } from '#/entities/client';
import type { LogoutDelivery } from '#/features/clients/types/logoutDelivery';
import { useState } from 'react';
import { useLogoutDeliveries } from '#/features/clients/repository/useLogoutDeliveries';
import { ANY_STATUS, statusFilter } from '#/shared/services/filters';
import type { ListStatus } from '#/shared/services/resourceList';

export interface ClientDeliveries {
  status: string;
  setStatus: (status: string) => void;
  list: {
    status: ListStatus;
    rows: readonly LogoutDelivery[];
    more: boolean;
    loadingMore: boolean;
    loadLimited: boolean;
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
      loadLimited: pages.loadLimited,
      loadMore: pages.loadMore,
      retry: pages.retry,
    },
  };
}
