import { useScopeList } from '#/pages/scopes/repository/useScopeList';
import { type Scope, newScopeHref, scopeHref } from '#/entities/scope';
import { NAME_SEARCH } from '#/shared/lib/services/filters';
import { useListPage, type ListPageState } from '#/shared/lib/use-cases/useListPage';

export interface ScopesList extends ListPageState<Scope> {
  searchFields: readonly { id: string; label: string }[];
}

export function useScopesList(tenant: string): ScopesList {
  const page = useListPage(useScopeList(tenant), newScopeHref(tenant), (id) =>
    scopeHref(tenant, id),
  );
  return {
    list: page.list,
    createHref: page.createHref,
    open: page.open,
    searchFields: NAME_SEARCH,
  };
}
