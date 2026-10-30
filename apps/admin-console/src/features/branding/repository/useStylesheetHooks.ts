import type { StylesheetHooksResponse } from '@odudu/contracts/admin';
import { readStylesheetHooks } from '#/features/branding/adapter/theme';
import { stylesheetHooksKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';

export function useStylesheetHooks(tenant: string, asked = true): Read<StylesheetHooksResponse> {
  const { gateway } = useTransport();
  return useRead(stylesheetHooksKey(tenant), asked, () => readStylesheetHooks(gateway, tenant), {
    immutable: true,
  });
}
