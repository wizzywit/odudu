import { useScopeList } from '#/pages/scopes/repository/useScopeList';
import { type Scope, newScopeHref, scopeHref } from '#/entities/scope';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type ScopesList = ListPageState<Scope>;

export function useScopesList(tenant: string): ScopesList {
  return useListPage(useScopeList(tenant), newScopeHref(tenant), (id) => scopeHref(tenant, id));
}
