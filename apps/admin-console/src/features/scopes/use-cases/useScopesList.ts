import type { Scope } from '#/entities/scope';
import { useScopeList } from '#/features/scopes/repository/useScopeList';
import { newScopeHref, scopeHref } from '#/features/scopes/services/address';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type ScopesList = ListPageState<Scope>;

export function useScopesList(tenant: string): ScopesList {
  return useListPage(useScopeList(tenant), newScopeHref(tenant), (id) => scopeHref(tenant, id));
}
