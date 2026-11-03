import { useState } from 'react';
import { useMail } from '#/pages/email/repository/useMail';
import {
  anyMasked,
  mailRows,
  oldestWaiting,
  type MailRow,
} from '#/pages/email/services/mailDelivery';
import { MAIL_WORDS, mailTableLabel, type MailWords } from '#/pages/email/services/mailWording';
import { ANY_STATUS, statusFilter } from '#/shared/lib/services/filters';
import type { ListStatus } from '#/shared/lib/services/resourceList';

export interface MailDelivery {
  status: string;
  setStatus: (status: string) => void;
  list: {
    status: ListStatus;
    rows: readonly MailRow[];
    more: boolean;
    loadingMore: boolean;
    loadLimited: boolean;
    loadMoreFailed: boolean;
    loadMore: () => void;
    refresh: () => void;
  };
  oldestWaiting: string | null;
  masked: boolean;
  words: MailWords;
  tableLabel: string;
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
      rows: mailRows(pages.rows),
      more,
      loadingMore: pages.loadingMore,
      loadLimited: pages.loadLimited,
      loadMoreFailed: pages.loadMoreFailed,
      loadMore: pages.loadMore,
      refresh: pages.retry,
    },
    oldestWaiting: oldestWaiting(pages.rows, more, status),
    masked: anyMasked(pages.rows),
    words: MAIL_WORDS,
    tableLabel: mailTableLabel(tenant),
  };
}
