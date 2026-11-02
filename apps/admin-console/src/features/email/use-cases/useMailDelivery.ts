import type { MailMessage } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useMail } from '#/features/email/repository/useMail';
import { anyMasked, oldestWaiting } from '#/features/email/services/mail';
import { ANY_STATUS, statusFilter } from '#/shared/services/filters';
import type { ListStatus } from '#/shared/services/resourceList';

export interface MailDelivery {
  status: string;
  setStatus: (status: string) => void;
  list: {
    status: ListStatus;
    rows: readonly MailMessage[];
    more: boolean;
    loadingMore: boolean;
    loadLimited: boolean;
    loadMoreFailed: boolean;
    loadMore: () => void;
    refresh: () => void;
  };
  oldestWaiting: string | null;
  masked: boolean;
}

export function useMailDelivery(tenant: string): MailDelivery {
  const [status, setStatus] = useState(ANY_STATUS);
  const pages = useMail(tenant, statusFilter(status));
  const more = pages.next !== null;
  return {
    status,
    setStatus,
    list: {
      status: pages.status,
      rows: pages.rows,
      more,
      loadingMore: pages.loadingMore,
      loadLimited: pages.loadLimited,
      loadMoreFailed: pages.loadMoreFailed,
      loadMore: pages.loadMore,
      refresh: pages.retry,
    },
    oldestWaiting: oldestWaiting(pages.rows, more, status),
    masked: anyMasked(pages.rows),
  };
}
