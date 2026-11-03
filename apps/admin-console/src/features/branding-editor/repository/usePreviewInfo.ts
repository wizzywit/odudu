import type { ThemePreviewInfo } from '#/features/branding-editor/types/theme';
import { readPreviewInfo } from '#/features/branding-editor/adapter/themePreview';
import { type PreviewChoice } from '#/features/branding-editor/services/preview';
import { scopeKeyPart, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { previewInfoKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

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
