import type { StylesheetHooksResponse } from '#/features/branding-editor/types/theme';
import { readStylesheetHooks } from '#/features/branding-editor/adapter/themePreview';
import { stylesheetHooksKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

export function useStylesheetHooks(tenant: string, asked = true): Read<StylesheetHooksResponse> {
  const { gateway } = useTransport();
  return useRead(stylesheetHooksKey(tenant), asked, () => readStylesheetHooks(gateway, tenant), {
    immutable: true,
  });
}
