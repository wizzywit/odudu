import { useState } from 'react';
import { useListPages, type ReadPage } from '#/shared/repository/useResourceList.ts';
import type { PickerState } from '#/shared/service/picker.ts';

// A picker's search is the name prefix, kept in its own state: the page it
// sits on already owns the address.
export function usePicker<T>({
  tenant,
  resource,
  fixed = {},
  read,
}: {
  readonly tenant: string;
  readonly resource: string;
  readonly fixed?: Readonly<Record<string, string>>;
  readonly read: ReadPage<T>;
}): PickerState<T> {
  const [query, setQuery] = useState('');
  const params = new URLSearchParams();
  if (query !== '') params.set('name', query);
  for (const [name, value] of Object.entries(fixed)) params.set(name, value);
  const pages = useListPages({
    key: ['picker', tenant, resource],
    query: params,
    cursor: undefined,
    read,
  });
  return {
    status: pages.status,
    options: pages.rows,
    query,
    search: setQuery,
    more: pages.next !== null,
    loadingMore: pages.loadingMore,
    loadMore: pages.loadMore,
    retry: pages.retry,
  };
}
