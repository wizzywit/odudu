import type { StylesheetHooksResponse } from '#/features/branding-editor/types/theme';
import { readStylesheetHooks } from '#/features/branding-editor/adapter/themePreview';
import { stylesheetHooksKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import { useTransport } from '#/shared/transport/useTransport';

export function useStylesheetHooks(tenant: string, asked = true): Read<StylesheetHooksResponse> {
  const { gateway } = useTransport();
  return useRead(stylesheetHooksKey(tenant), asked, () => readStylesheetHooks(gateway, tenant), {
    immutable: true,
  });
}
