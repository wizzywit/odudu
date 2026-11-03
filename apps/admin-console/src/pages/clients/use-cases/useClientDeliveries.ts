import type { Client } from '#/entities/client';
import {
  DELIVERIES_HEADING,
  DELIVERIES_RULE,
  deliveryRow,
  NO_DELIVERIES,
  STATUS_OPTIONS,
  type DeliveryRow,
} from '#/pages/clients/services/deliveries';
import { useState } from 'react';
import { useLogoutDeliveries } from '#/pages/clients/repository/useLogoutDeliveries';
import { ANY_STATUS, statusFilter } from '#/shared/services/filters';
import type { Choice } from '#/shared/services/choice';
import type { ListStatus } from '#/shared/services/resourceList';

export interface ClientDeliveries {
  heading: string;
  rule: string;
  empty: string;
  statusOptions: readonly Choice[];
  status: string;
  setStatus: (status: string) => void;
  list: {
    status: ListStatus;
    rows: readonly DeliveryRow[];
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
    heading: DELIVERIES_HEADING,
    rule: DELIVERIES_RULE,
    empty: NO_DELIVERIES,
    statusOptions: STATUS_OPTIONS,
    status,
    setStatus,
    list: {
      status: pages.status,
      rows: pages.rows.map(deliveryRow),
      more: pages.next !== null,
      loadingMore: pages.loadingMore,
      loadLimited: pages.loadLimited,
      loadMore: pages.loadMore,
      retry: pages.retry,
    },
  };
}
