import type { ThemePreviewInfo } from '@odudu/contracts/admin';
import { readPreviewInfo } from '#/features/branding/adapter/theme';
import { scopeKeyPart, type PreviewChoice, type ThemeScope } from '#/features/branding/service';
import { previewInfoKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/service/read';
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
