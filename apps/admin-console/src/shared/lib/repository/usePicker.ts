import { useState } from 'react';
import { pickerKey } from '#/shared/lib/repository/queryKeys';
import { useListPages, type ReadPage } from '#/shared/lib/repository/useResourceList';
import type { PickerState } from '#/shared/lib/services/picker';

// A picker's search is a prefix of one field, kept in its own state: the
// page it sits on already owns the address.
export function usePicker<T>({
  tenant,
  resource,
  field = 'name',
  fixed = {},
  enabled = true,
  read,
}: {
  tenant: string;
  resource: string;
  field?: string;
  fixed?: Readonly<Record<string, string>>;
  // Left unread until the caller may read it, so no refusal is asked for.
  enabled?: boolean;
  read: ReadPage<T>;
}): PickerState<T> {
  const [query, setQuery] = useState('');
  const params = new URLSearchParams();
  if (query !== '') params.set(field, query);
  for (const [name, value] of Object.entries(fixed)) params.set(name, value);
  const pages = useListPages({
    key: pickerKey(tenant, resource),
    query: params,
    cursor: undefined,
    read,
    enabled,
  });
  return {
    status: pages.status,
    options: pages.rows,
    query,
    search: setQuery,
    more: pages.next !== null,
    loadingMore: pages.loadingMore,
    loadLimited: pages.loadLimited,
    loadMore: pages.loadMore,
    retry: pages.retry,
  };
}
