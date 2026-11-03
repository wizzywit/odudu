import type { ThemePreviewInfo } from '@odudu/contracts/admin';
import { readPreviewInfo } from '#/features/branding/adapter/theme';
import { type PreviewChoice } from '#/features/branding/services/preview';
import { scopeKeyPart, type ThemeScope } from '#/features/branding/services/themeScope';
import { previewInfoKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import { useTransport } from '#/shared/transport/useTransport';

// What the frame shows, asked when the frame is, and again whenever it
// reloads.
export function usePreviewInfo(
  tenant: string,
  scope: ThemeScope,
  choice: PreviewChoice,
  frame: string,
  asked: boolean,
): Read<ThemePreviewInfo> {
  const { gateway } = useTransport();
  return useRead(previewInfoKey(tenant, scopeKeyPart(scope), frame), asked, () =>
    readPreviewInfo(gateway, tenant, scope, choice),
  );
}
