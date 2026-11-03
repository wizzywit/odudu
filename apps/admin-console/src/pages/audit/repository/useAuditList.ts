import type { AuditEvent } from '#/entities/audit-event';
import { readAuditPage } from '#/entities/audit-event';
import { listKey } from '#/shared/repository/queryKeys';
import { useListPages } from '#/shared/repository/useResourceList';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { isTooBroad } from '#/pages/audit/services/tooBroad';
import { auditQuery, filtersToSearch, readFilters } from '#/pages/audit/services/auditAddress';
import { type AuditFilters } from '#/pages/audit/services/auditFilters';
import {
  currentCursor,
  trailFromSearch,
  trailToSearch,
  type CursorTrail,
} from '#/shared/services/cursorTrail';
import type { ListStatus } from '#/shared/services/resourceList';

export interface AuditList {
  status: ListStatus;
  rows: readonly AuditEvent[];
  // The filters the address holds that the trail can read, and what it
  // held that it could not.
  filters: AuditFilters;
  ignored: readonly string[];
  trail: CursorTrail;
  next: string | null;
  // The page asked for was a place in the trail that is no longer valid.
  staleCursor: boolean;
  // The server stopped the read at its time bound.
  tooBroad: boolean;
  loadingMore: boolean;
  loadLimited: boolean;
  loadMoreFailed: boolean;
  setTrail: (trail: CursorTrail) => void;
  loadMore: () => void;
  retry: () => void;
  apply: (filters: AuditFilters) => void;
  startAgain: () => void;
}

// The audit trail of a tenant, narrowed by the filters in the address. Each
// is read from the address and checked against what the API takes, so a
// reload or a shared link shows the same page and a bad value is left out.
export function useAuditList(tenant: string): AuditList {
  const { params, go } = useUrlSearch();
  const { filters, ignored } = readFilters(params);
  const trail = trailFromSearch(params);
  const pages = useListPages({
    key: listKey(tenant, 'audit'),
    query: auditQuery(filters),
    cursor: currentCursor(trail),
    read: (gateway, query) => readAuditPage(gateway, tenant, query),
  });
  return {
    status: pages.status,
    rows: pages.rows,
    filters,
    ignored,
    trail,
    next: pages.next,
    staleCursor: pages.staleCursor,
    tooBroad: isTooBroad(pages.failure),
    loadingMore: pages.loadingMore,
    loadLimited: pages.loadLimited,
    loadMoreFailed: pages.loadMoreFailed,
    setTrail: (next) => {
      go(trailToSearch(next, params));
    },
    loadMore: pages.loadMore,
    retry: pages.retry,
    apply: (next) => {
      go(filtersToSearch(params, next));
    },
    startAgain: () => {
      go(trailToSearch([], params));
    },
  };
}
