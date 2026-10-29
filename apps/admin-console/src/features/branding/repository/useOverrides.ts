import type { MessageOverride } from '@odudu/contracts/admin';
import {
  deleteOverride,
  putOverride,
  readOverridePage,
} from '#/features/branding/adapter/overrides';
import { PAGE_SIZE } from '#/features/branding/service';
import { listKey, themeWriteKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useListPages } from '#/shared/repository/useResourceList';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/transport/gateway';

const RESOURCE = 'message-overrides';

// A language's overrides, a page at a time, appended by "Load more".
export function useOverrideList(tenant: string, locale: string) {
  return useListPages<MessageOverride>({
    key: listKey(tenant, RESOURCE, locale),
    query: new URLSearchParams({ locale, limit: String(PAGE_SIZE) }),
    cursor: undefined,
    read: (gateway, query) => readOverridePage(gateway, tenant, query),
  });
}

export interface OverrideWrites {
  put: Write<{ locale: string; key: string; message: string }, GatewayResult<MessageOverride>>;
  remove: Write<{ locale: string; key: string }, GatewayResult<undefined>>;
}

// Whatever the answer, the list is read again: it may be stale.
export function useOverrideWrites(tenant: string): OverrideWrites {
  const { invalidate } = useInvalidate();
  const reread = (): void => {
    invalidate(listKey(tenant, RESOURCE));
  };
  return {
    put: useGatewayWrite({
      mutationKey: themeWriteKey(tenant, 'tenant-wide', 'override'),
      send: (gateway, input) => putOverride(gateway, tenant, input),
      onSettled: reread,
    }),
    remove: useGatewayWrite({
      mutationKey: themeWriteKey(tenant, 'tenant-wide', 'override-remove'),
      send: (gateway, input) => deleteOverride(gateway, tenant, input),
      onSettled: reread,
    }),
  };
}
