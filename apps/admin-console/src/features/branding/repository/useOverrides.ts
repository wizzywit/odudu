import type { MessageOverride } from '@odudu/contracts/admin';
import {
  deleteOverride,
  putOverride,
  readOverride,
  readOverridePage,
} from '#/features/branding/adapter/overrides';
import { PAGE_SIZE } from '#/features/branding/service';
import { listKey, overrideReadKey, themeWriteKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useListPages } from '#/shared/repository/useResourceList';
import { useFreshRead } from '#/shared/repository/useFreshRead';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import { useTransport } from '#/shared/transport/useTransport';
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
  put: Write<
    { locale: string; key: string; message: string; etag: string | null },
    GatewayResult<MessageOverride>
  >;
  remove: Write<{ locale: string; key: string; etag: string }, GatewayResult<undefined>>;
  // One override as the server holds it now, for the side of a conflict that
  // is not the person's own; null when it holds none.
  current: (input: {
    locale: string;
    key: string;
  }) => Promise<GatewayResult<MessageOverride | null>>;
}

// Whatever the answer, the list is read again: it may be stale.
export function useOverrideWrites(tenant: string): OverrideWrites {
  const { invalidate } = useInvalidate();
  const { gateway } = useTransport();
  const fresh = useFreshRead();
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
    current: (input) =>
      fresh.read(overrideReadKey(tenant, input.locale, input.key), () =>
        readOverride(gateway, tenant, input),
      ),
  };
}
