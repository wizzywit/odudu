import type { ClientScope } from '@odudu/contracts/admin';
import { useScopeList } from '#/features/scopes/repository/useScopeList';
import { newScopeHref, scopeHref } from '#/features/scopes/services/address';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type ScopesList = ListPageState<ClientScope>;

export function useScopesList(tenant: string): ScopesList {
  return useListPage(useScopeList(tenant), newScopeHref(tenant), (id) => scopeHref(tenant, id));
}
