import { readMailPage } from '#/features/email/adapter/mail';
import { mailQuery } from '#/features/email/services';
import { listKey } from '#/shared/repository/queryKeys';
import { useListPages } from '#/shared/repository/useResourceList';

// The mail of one status, or of any, a page at a time; the list reads again
// when the status changes, since a cursor is bound to its filter.
export function useMail(tenant: string, status: string | null) {
  return useListPages({
    key: listKey(tenant, 'mail'),
    query: new URLSearchParams(mailQuery(status)),
    cursor: undefined,
    read: (gateway, query) => readMailPage(gateway, tenant, query),
  });
}
