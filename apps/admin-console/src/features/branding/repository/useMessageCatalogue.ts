import type { MessageCatalogueResponse } from '@odudu/contracts/admin';
import { readMessageCatalogue } from '#/features/branding/adapter/overrides';
import { messageCatalogueKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';

// Part of the build and the same for every call, so read once and kept.
export function useMessageCatalogue(tenant: string, asked = true): Read<MessageCatalogueResponse> {
  const { gateway } = useTransport();
  return useRead(messageCatalogueKey(tenant), asked, () => readMessageCatalogue(gateway, tenant), {
    immutable: true,
  });
}
