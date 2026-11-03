import type { SigningKey, SigningKeyStatus } from '#/entities/signing-key';
import { readKeyPage } from '#/entities/signing-key';
import { listKey } from '#/shared/lib/repository/queryKeys';
import { useListPages } from '#/shared/lib/repository/useResourceList';
import type { ListStatus } from '#/shared/lib/services/resourceList';

export interface KeyLane {
  status: ListStatus;
  rows: readonly SigningKey[];
  next: string | null;
  loadingMore: boolean;
  loadLimited: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

// One lane is one status of the tenant's keys, read a page at a time.
export function useKeyLane(tenant: string, status: SigningKeyStatus, enabled = true): KeyLane {
  return useListPages({
    key: listKey(tenant, 'keys'),
    query: new URLSearchParams({ status }),
    cursor: undefined,
    read: (gateway, query) => readKeyPage(gateway, tenant, query),
    enabled,
  });
}
